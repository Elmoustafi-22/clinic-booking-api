import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types';
import { authenticated, makeApp, testUrl } from './support';

const inventory = Array.from({ length: 32 }, (_, i) => ({
  id: `s${i}`,
  provider: 'Dr Ade',
  start: '2099-12-10T09:00:00Z',
  end: '2099-12-10T09:30:00Z',
}));
const body = { slot_id: 's0', name: 'Ada Obi', email: 'ada@example.com' };
const identity = (email = body.email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
function denied(r: Response) {
  expect(r.status).toBe(429);
  expect(r.body).toEqual({ error: expect.any(String) as unknown });
  expect(r.headers['retry-after']).toMatch(/^[1-9]\d*$/);
}

describe('Level 5 — PostgreSQL rolling admission', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl });
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(__dirname, '../drizzle'),
    });
    app = await makeApp();
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await authenticated(app)
      .post('/reset')
      .send({ slots: inventory })
      .expect(200);
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });
  const post = (i = 0, email = body.email, target = app, key?: string) => {
    const r = authenticated(target).post('/bookings');
    if (key !== undefined) r.set('Idempotency-Key', key);
    return r.send({ ...body, slot_id: `s${i}`, email });
  };
  async function counts() {
    return (
      await pool.query<{ attempts: number; bookings: number; records: number }>(
        `select (select count(*)::int from booking_attempts) attempts, (select count(*)::int from bookings) bookings, (select count(*)::int from idempotency_records) records`,
      )
    ).rows[0];
  }
  const fill = async (target = app) => {
    for (let i = 0; i < 5; i++) await post(i, body.email, target).expect(201);
  };
  const events = async () =>
    (
      await pool.query(
        'select id::text, email, attempted_at::text from booking_attempts order by id',
      )
    ).rows as unknown[];
  async function clockApp(time: string) {
    const other = await makeApp(sql`${time}::timestamptz`);
    await other.listen(0, '127.0.0.1');
    return other;
  }

  it('admits five, denies the sixth with Retry-After and leaves all state unchanged on denial', async () => {
    await fill();
    const snapshot = await events();
    for (let i = 0; i < 3; i++) denied(await post(6));
    expect(await events()).toEqual(snapshot);
    expect(await counts()).toEqual({ attempts: 5, bookings: 5, records: 0 });
  });
  it('gives different normalized emails independent budgets', async () => {
    await fill();
    for (let i = 5; i < 10; i++) await post(i, 'bob@example.com').expect(201);
    denied(await post(10));
    denied(await post(11, 'bob@example.com'));
    expect(await counts()).toEqual({ attempts: 10, bookings: 10, records: 0 });
  });
  it('shares a bucket across email case and outer whitespace', async () => {
    for (let i = 0; i < 5; i++)
      await post(i, i % 2 ? ' ADA@Example.COM ' : body.email).expect(201);
    denied(await post(6, ' Ada@EXAMPLE.com '));
    expect(
      (await pool.query('select distinct email from booking_attempts')).rows,
    ).toEqual([{ email: identity() }]);
  });
  it.each([
    ['invalid name', { name: '   ' }, 400],
    ['missing slot_id', { slot_id: undefined }, 400],
    ['nonexistent slot', { slot_id: 'missing' }, 404],
    ['invalid email syntax', { email: 'not-an-email' }, 400],
    ['oversized invalid email', { email: 'x'.repeat(10000) }, 400],
    ['NUL email', { email: 'bad\u0000email' }, 400],
  ])('counts admitted %s errors', async (_label, changes, status) => {
    for (let i = 0; i < 5; i++)
      await authenticated(app)
        .post('/bookings')
        .send({ ...body, ...(changes as object) })
        .expect(status);
    denied(
      await authenticated(app)
        .post('/bookings')
        .send({ ...body, ...(changes as object) }),
    );
    expect(await counts()).toEqual({ attempts: 5, bookings: 0, records: 0 });
  });
  it.each(['occupied', 'started'])('counts %s slot errors', async (kind) => {
    if (kind === 'occupied') await post(0, 'other@example.com').expect(201);
    else
      await pool.query(
        "update slots set starts_at = clock_timestamp() - interval '1 hour' where id = 's0'",
      );
    for (let i = 0; i < 5; i++)
      await post().expect(kind === 'occupied' ? 409 : 400);
    denied(await post());
    expect(
      (
        await pool.query(
          'select count(*)::int n from booking_attempts where email=$1',
          [identity()],
        )
      ).rows,
    ).toEqual([{ n: 5 }]);
  });
  it.each([undefined, '', ' \t ', null, 12, false, {}, []])(
    'does not create a bucket for unusable email %j',
    async (email) => {
      for (let i = 0; i < 6; i++)
        await authenticated(app)
          .post('/bookings')
          .send({ ...body, email })
          .expect(400);
      expect((await counts()).attempts).toBe(0);
      await post().expect(201);
    },
  );
  it('authenticates before any admission or body validation', async () => {
    for (let i = 0; i < 6; i++)
      await request(app.getHttpServer())
        .post('/bookings')
        .send({ ...body, name: null })
        .expect(401);
    expect((await counts()).attempts).toBe(0);
    await post().expect(201);
  });
  it('records database wall-clock timestamps', async () => {
    const before = (
      await pool.query<{ t: string }>('select clock_timestamp()::text t')
    ).rows[0].t;
    await post().expect(201);
    const result = await pool.query<{ correct: boolean }>(
      'select attempted_at >= $1::timestamptz and attempted_at <= clock_timestamp() correct from booking_attempts',
      [before],
    );
    expect(result.rows).toEqual([{ correct: true }]);
  });
  it('expires old attempts without deleting historical rows', async () => {
    await fill();
    await pool.query(
      "update booking_attempts set attempted_at = clock_timestamp() - interval '61 seconds'",
    );
    await post(6).expect(201);
    expect((await counts()).attempts).toBe(6);
  });
  it('uses a rolling window across a calendar minute boundary', async () => {
    const first = await clockApp('2035-01-01T09:00:59Z');
    try {
      await fill(first);
    } finally {
      await first.close();
    }
    const next = await clockApp('2035-01-01T09:01:01Z');
    try {
      const r = await post(6, body.email, next);
      denied(r);
      expect(r.headers['retry-after']).toBe('58');
    } finally {
      await next.close();
    }
  });
  it('expires exactly at 60 seconds and rounds fractional Retry-After upward without extending the window', async () => {
    const first = await clockApp('2035-01-01T09:00:00Z');
    try {
      await fill(first);
    } finally {
      await first.close();
    }
    const snapshot = await events();
    const edge = await clockApp('2035-01-01T09:00:59.999999Z');
    try {
      const r = await post(6, body.email, edge);
      denied(r);
      expect(r.headers['retry-after']).toBe('1');
    } finally {
      await edge.close();
    }
    expect(await events()).toEqual(snapshot);
    const expired = await clockApp('2035-01-01T09:01:00Z');
    try {
      await post(6, body.email, expired).expect(201);
    } finally {
      await expired.close();
    }
  });
  it.each([false, true])(
    'admits exactly five of 24 simultaneous requests (two instances: %s)',
    async (two) => {
      const other = two ? await makeApp() : app;
      if (two) await other.listen(0, '127.0.0.1');
      try {
        const results = await Promise.all(
          Array.from({ length: 24 }, (_, i) =>
            post(i, body.email, i % 2 ? other : app),
          ),
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(5);
        results.filter((r) => r.status !== 201).forEach(denied);
        expect(await counts()).toEqual({
          attempts: 5,
          bookings: 5,
          records: 0,
        });
      } finally {
        if (two) await other.close();
      }
    },
  );
  it('replays and detects mismatches ahead of an exhausted budget', async () => {
    const first = await post(0, body.email, app, 'key').expect(201);
    for (let i = 1; i < 5; i++) await post(i).expect(201);
    denied(await post(6));
    await post(0, body.email, app, 'key').expect(201, first.body as object);
    await post(7, body.email, app, 'key').expect(422);
    expect(await counts()).toEqual({ attempts: 5, bookings: 5, records: 1 });
  });
  it('concurrent identical keyed requests across instances consume only one attempt', async () => {
    const other = await makeApp();
    await other.listen(0, '127.0.0.1');
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          post(0, body.email, i % 2 ? other : app, 'shared'),
        ),
      );
      results.forEach((r) => {
        expect(r.status).toBe(201);
        expect(r.body).toEqual(results[0].body as object);
      });
      expect(await counts()).toEqual({ attempts: 1, bookings: 1, records: 1 });
    } finally {
      await other.close();
    }
  });
  it('new keys consume attempts, while a denied key is reusable after expiry', async () => {
    for (let i = 0; i < 5; i++)
      await post(i, body.email, app, `k${i}`).expect(201);
    denied(await post(6, body.email, app, 'denied'));
    expect((await counts()).records).toBe(5);
    await pool.query(
      "update booking_attempts set attempted_at = clock_timestamp() - interval '61 seconds'",
    );
    const r = await post(6, body.email, app, 'denied').expect(201);
    await post(6, body.email, app, 'denied').expect(201, r.body as object);
    expect(await counts()).toEqual({ attempts: 6, bookings: 6, records: 6 });
  });
  it('caches admitted validation errors without charging matching retries', async () => {
    for (let i = 0; i < 8; i++)
      await authenticated(app)
        .post('/bookings')
        .set('Idempotency-Key', 'invalid')
        .send({ ...body, name: '' })
        .expect(400);
    expect(await counts()).toEqual({ attempts: 1, bookings: 0, records: 1 });
  });
  it.each(['bookings', 'idempotency_records', 'booking_attempts'])(
    'fails safely on %s insert failure',
    async (table) => {
      await pool.query(
        `create function level5_fail() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$`,
      );
      await pool.query(
        `create trigger level5_failure before insert on ${table} for each row execute function level5_fail()`,
      );
      try {
        await post(0, body.email, app, 'fault').expect(500, {
          error: 'internal server error',
        });
        expect(await counts()).toEqual({
          attempts: table === 'booking_attempts' ? 0 : 1,
          bookings: 0,
          records: 0,
        });
      } finally {
        await pool.query(`drop trigger level5_failure on ${table}`);
        await pool.query('drop function level5_fail()');
      }
      await post(0, body.email, app, 'fault').expect(201);
      expect(await counts()).toEqual({
        attempts: table === 'booking_attempts' ? 1 : 2,
        bookings: 1,
        records: 1,
      });
    },
  );
  it('waits for admission COMMIT and fails closed if deferred constraints fail', async () => {
    await pool.query(
      `create function level5_commit_fail() returns trigger language plpgsql as $$ begin raise exception 'commit failure'; end $$`,
    );
    await pool.query(
      'create constraint trigger level5_commit_failure after insert on booking_attempts deferrable initially deferred for each row execute function level5_commit_fail()',
    );
    try {
      await post(0, body.email, app, 'commit').expect(500);
      expect(await counts()).toEqual({ attempts: 0, bookings: 0, records: 0 });
    } finally {
      await pool.query(
        'drop trigger level5_commit_failure on booking_attempts',
      );
      await pool.query('drop function level5_commit_fail()');
    }
    await post().expect(201);
  });
  it('counts uncached canonicalization failures with a usable email', async () => {
    const raw = JSON.stringify(body).slice(0, -1) + ',"extra":1e400}';
    for (let i = 0; i < 5; i++)
      await authenticated(app)
        .post('/bookings')
        .set('Idempotency-Key', 'nonfinite')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(400);
    denied(
      await authenticated(app)
        .post('/bookings')
        .set('Idempotency-Key', 'nonfinite')
        .set('Content-Type', 'application/json')
        .send(raw),
    );
    expect(await counts()).toEqual({ attempts: 5, bookings: 0, records: 0 });
  });
  it('reset clears admission state and permits fresh attempts', async () => {
    await fill();
    denied(await post(6));
    await authenticated(app)
      .post('/reset')
      .send({ slots: inventory })
      .expect(200);
    expect(await counts()).toEqual({ attempts: 0, bookings: 0, records: 0 });
    await post().expect(201);
  });
  it('a failed booking transaction still consumes one of the five available admissions', async () => {
    await pool.query(
      `create function level5_booking_fail() returns trigger language plpgsql as $$ begin raise exception 'booking rollback'; end $$`,
    );
    await pool.query(
      'create trigger level5_booking_failure before insert on bookings for each row execute function level5_booking_fail()',
    );
    try {
      await post().expect(500);
    } finally {
      await pool.query('drop trigger level5_booking_failure on bookings');
      await pool.query('drop function level5_booking_fail()');
    }
    for (let i = 0; i < 4; i++) await post(i).expect(201);
    denied(await post(5));
    expect(await counts()).toEqual({ attempts: 5, bookings: 4, records: 0 });
  });
  it('fails closed when the admission clock query fails', async () => {
    await pool.query(
      `create function level5_clock_fail() returns timestamptz language plpgsql as $$ begin raise exception 'clock read failure'; end $$`,
    );
    const failing = await makeApp(sql`level5_clock_fail()`);
    await failing.listen(0, '127.0.0.1');
    try {
      await post(0, body.email, failing, 'clock').expect(500, {
        error: 'internal server error',
      });
      expect(await counts()).toEqual({ attempts: 0, bookings: 0, records: 0 });
    } finally {
      await failing.close();
      await pool.query('drop function level5_clock_fail()');
    }
    await post().expect(201);
  });
  it('restores limiter, booking and idempotency state when reset inventory installation fails', async () => {
    await post(0, body.email, app, 'before-reset').expect(201);
    const snapshot = await events();
    await pool.query(
      `create function level5_reset_fail() returns trigger language plpgsql as $$ begin raise exception 'reset rollback'; end $$`,
    );
    await pool.query(
      'create trigger level5_reset_failure before insert on slots for each row execute function level5_reset_fail()',
    );
    try {
      await authenticated(app)
        .post('/reset')
        .send({ slots: inventory })
        .expect(500);
      expect(await events()).toEqual(snapshot);
      expect(await counts()).toEqual({ attempts: 1, bookings: 1, records: 1 });
    } finally {
      await pool.query('drop trigger level5_reset_failure on slots');
      await pool.query('drop function level5_reset_fail()');
    }
    await post(0, body.email, app, 'before-reset').expect(201);
    expect((await counts()).attempts).toBe(1);
  });
  it('invalid reset leaves admission state intact', async () => {
    await fill();
    const before = await events();
    await authenticated(app)
      .post('/reset')
      .send({ slots: [inventory[0], inventory[0]] })
      .expect(400);
    expect(await events()).toEqual(before);
    denied(await post(6));
  });

  async function gated(reset: boolean) {
    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select pg_advisory_xact_lock(98765001)');
    await pool.query(
      `create function level5_gate() returns trigger language plpgsql as $$ begin if new.email = '${identity()}' then perform pg_advisory_xact_lock(98765001); end if; return new; end $$`,
    );
    await pool.query(
      'create trigger level5_gate_trigger before insert on booking_attempts for each row execute function level5_gate()',
    );
    const pending = post(0).then((r) => r);
    let resetting: Promise<Response> | undefined;
    try {
      const deadline = Date.now() + 3000;
      while (true) {
        const blocked = await pool.query<{ n: number }>(
          "select count(*)::int n from pg_stat_activity where application_name='clinic-rate-limit' and cardinality(pg_blocking_pids(pid)) > 0",
        );
        if (blocked.rows[0].n > 0) break;
        if (Date.now() > deadline)
          throw new Error('admission never reached test gate');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (reset) {
        resetting = authenticated(app)
          .post('/reset')
          .send({ slots: inventory })
          .then((r) => r);
        const deadline = Date.now() + 3000;
        while (true) {
          const waiting = await pool.query<{ n: number }>(
            "select count(*)::int n from pg_locks where locktype='advisory' and objid=410401 and not granted",
          );
          if (waiting.rows[0].n > 0) break;
          if (Date.now() > deadline)
            throw new Error('reset did not wait for booking');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } else await post(1, 'bob@example.com').expect(201);
      await gate.query('commit');
      expect((await pending).status).toBe(201);
      if (resetting) {
        expect((await resetting).status).toBe(200);
        expect(await counts()).toEqual({
          attempts: 0,
          bookings: 0,
          records: 0,
        });
      } else
        expect(await counts()).toEqual({
          attempts: 2,
          bookings: 2,
          records: 0,
        });
    } finally {
      await gate.query('rollback');
      gate.release();
      await pending.catch(() => undefined);
      await resetting?.catch(() => undefined);
      await pool.query('drop trigger level5_gate_trigger on booking_attempts');
      await pool.query('drop function level5_gate()');
    }
  }
  it('a blocked email does not block admission for an independent email', async () => {
    await gated(false);
  });
  it('a queued reset cannot deadlock nested admission and clears the completed booking and attempt together', async () => {
    await gated(true);
  });
});
