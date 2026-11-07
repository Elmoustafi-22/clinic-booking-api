import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';
import type { App } from 'supertest/types';
import type { Response } from 'supertest';
import { authenticated, makeApp, testUrl } from './support';

interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
}
const slot = {
  id: 's1',
  provider: 'Dr Ade',
  start: '2099-12-10T09:00:00Z',
  end: '2099-12-10T09:30:00Z',
};
const patient = { slot_id: slot.id, name: 'Ada Obi', email: 'ada@example.com' };
const conflict = { error: 'slot already booked' };

function expectError(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.body).toEqual({ error: expect.any(String) as unknown });
}
async function waitUntil(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((done) => {
      setTimeout(done, 10);
    });
  }
  throw new Error('Timed out waiting for PostgreSQL test coordination');
}

describe('Level 3 — real PostgreSQL and simultaneous HTTP requests', () => {
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
      .send({ slots: [slot, { ...slot, id: 's2' }] })
      .expect(200, {});
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function create(email = patient.email, slotId = slot.id) {
    const response = await authenticated(app)
      .post('/bookings')
      .send({ ...patient, email, slot_id: slotId })
      .expect(201);
    return response.body as Booking;
  }
  async function counts() {
    const result = await pool.query<{
      confirmed: number;
      cancelled: number;
      total: number;
    }>(
      `select
      count(*) filter (where status = 'confirmed')::int as confirmed,
      count(*) filter (where status = 'cancelled')::int as cancelled,
      count(*)::int as total from bookings where slot_id = $1`,
      [slot.id],
    );
    return result.rows[0];
  }
  async function available() {
    const result = await authenticated(app).get('/slots').expect(200);
    return (
      result.body as { slots: { id: string; available: boolean }[] }
    ).slots.find((s) => s.id === slot.id)?.available;
  }
  async function installInsertTrigger(body: string) {
    await pool.query(`create function level3_insert_fault() returns trigger language plpgsql as $fault$
      begin ${body} return NEW; end $fault$;
      create trigger level3_insert_fault before insert on bookings for each row execute function level3_insert_fault()`);
  }
  async function removeInsertTrigger() {
    await pool.query(
      'drop trigger level3_insert_fault on bookings; drop function level3_insert_fault()',
    );
  }

  it('verifies the existing index is valid, unique and limited to confirmed rows', async () => {
    const result = await pool.query<{
      indisunique: boolean;
      indisvalid: boolean;
      definition: string;
      predicate: string;
    }>(`select i.indisunique, i.indisvalid,
      pg_get_indexdef(i.indexrelid) as definition, pg_get_expr(i.indpred, i.indrelid) as predicate
      from pg_index i where i.indexrelid = 'public.bookings_one_confirmed_per_slot_idx'::regclass`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].indisunique).toBe(true);
    expect(result.rows[0].indisvalid).toBe(true);
    expect(result.rows[0].definition).toMatch(/USING btree \(slot_id\)/);
    expect(result.rows[0].predicate).toBe("(status = 'confirmed'::text)");
  });
  it('rejects a direct second confirmed insert at the database index', async () => {
    await create();
    await expect(
      pool.query(
        `insert into bookings (id, slot_id, patient_name, patient_email)
      values ('direct-conflict', $1, 'Direct', 'direct@example.com')`,
        [slot.id],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'bookings_one_confirmed_per_slot_idx',
      table: 'bookings',
    });
    expect(await counts()).toEqual({ confirmed: 1, cancelled: 0, total: 1 });
  });
  it('allows multiple cancelled records alongside one confirmed booking for the same slot', async () => {
    await pool.query(
      `insert into bookings (id, slot_id, patient_name, patient_email, status, cancelled_at)
      values ('cancelled-1', $1, 'One', 'one@example.com', 'cancelled', clock_timestamp()),
      ('cancelled-2', $1, 'Two', 'two@example.com', 'cancelled', clock_timestamp())`,
      [slot.id],
    );
    await create();
    expect(await counts()).toEqual({ confirmed: 1, cancelled: 2, total: 3 });
  });
  it('returns exactly one 201 and fifteen 409 responses to sixteen simultaneous bookings', async () => {
    const responses = await Promise.all(
      Array.from({ length: 16 }, (_unused, i) =>
        authenticated(app)
          .post('/bookings')
          .send({ ...patient, email: `patient${i}@example.com` }),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = responses.filter((r) => r.status !== 201);
    expect(losers).toHaveLength(15);
    losers.forEach((r) => {
      expectError(r, 409);
      expect(r.body).toEqual(conflict);
    });
    expect(await counts()).toEqual({ confirmed: 1, cancelled: 0, total: 1 });
    expect(await available()).toBe(false);
  });
  it('arbitrates simultaneous booking requests across two independent Nest instances/pools', async () => {
    const second = await makeApp();
    await second.listen(0, '127.0.0.1');
    try {
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_unused, i) =>
          authenticated(i % 2 ? second : app)
            .post('/bookings')
            .send({ ...patient, email: `replica${i}@example.com` }),
        ),
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      responses
        .filter((r) => r.status !== 201)
        .forEach((r) => expectError(r, 409));
      expect(await counts()).toEqual({ confirmed: 1, cancelled: 0, total: 1 });
    } finally {
      await second.close();
    }
  });
  it('returns 409 for a sequential occupied-slot retry without altering the original booking', async () => {
    const original = await create();
    const response = await authenticated(app)
      .post('/bookings')
      .send(patient)
      .expect(409, conflict);
    expectError(response, 409);
    await authenticated(app)
      .get('/bookings/' + original.id)
      .expect(200, original);
    expect(await counts()).toEqual({ confirmed: 1, cancelled: 0, total: 1 });
  });
  it('cancels with the exact six-field response, preserves data, frees the slot and keeps the old record on rebooking', async () => {
    const original = await create();
    const before = await pool.query<{ created_at: string }>(
      'select created_at::text from bookings where id = $1',
      [original.id],
    );
    const cancelled = { ...original, status: 'cancelled' };
    await authenticated(app)
      .delete('/bookings/' + original.id)
      .expect(200, cancelled);
    await authenticated(app)
      .get('/bookings/' + original.id)
      .expect(200, cancelled);
    expect(await available()).toBe(true);
    const after = await pool.query<{
      created_at: string;
      cancelled_at: string | null;
    }>(
      'select created_at::text, cancelled_at::text from bookings where id = $1',
      [original.id],
    );
    expect(after.rows[0].created_at).toBe(before.rows[0].created_at);
    expect(after.rows[0].cancelled_at).not.toBeNull();
    const replacement = await create('replacement@example.com');
    expect(replacement.id).not.toBe(original.id);
    await authenticated(app)
      .get('/bookings/' + original.id)
      .expect(200, cancelled);
    expect(await counts()).toEqual({ confirmed: 1, cancelled: 1, total: 2 });
    expect(await available()).toBe(false);
    // Cancelling the old ID again must not cancel the new booking.
    await authenticated(app)
      .delete('/bookings/' + original.id)
      .expect(409);
    await authenticated(app)
      .get('/bookings/' + replacement.id)
      .expect(200, replacement);
  });
  it('returns JSON 404 for a nonexistent arbitrary cancellation ID', async () => {
    expectError(
      await authenticated(app)
        .delete('/bookings/not-a-uuid')
        .expect(404, { error: 'booking not found' }),
      404,
    );
  });
  it('rejects repeated cancellation with 409 without changing the cancellation timestamp', async () => {
    const original = await create();
    await authenticated(app)
      .delete('/bookings/' + original.id)
      .expect(200);
    const before = await pool.query<{ value: string }>(
      'select cancelled_at::text as value from bookings where id = $1',
      [original.id],
    );
    expectError(
      await authenticated(app)
        .delete('/bookings/' + original.id)
        .expect(409, { error: 'booking already cancelled' }),
      409,
    );
    const after = await pool.query<{ value: string }>(
      'select cancelled_at::text as value from bookings where id = $1',
      [original.id],
    );
    expect(after.rows).toEqual(before.rows);
  });
  it('allows cancellation after the appointment start', async () => {
    const original = await create();
    await pool.query(
      "update slots set starts_at = clock_timestamp() - interval '1 second' where id = $1",
      [slot.id],
    );
    await authenticated(app)
      .delete('/bookings/' + original.id)
      .expect(200, { ...original, status: 'cancelled' });
    expect(await available()).toBe(true);
    await authenticated(app)
      .post('/bookings')
      .send(patient)
      .expect(400, { error: 'slot has already started' });
  });
  it('allows exactly one of twelve simultaneous cancellations to succeed', async () => {
    const original = await create();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        authenticated(app).delete('/bookings/' + original.id),
      ),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    responses
      .filter((r) => r.status !== 200)
      .forEach((r) => expectError(r, 409));
    expect(await counts()).toEqual({ confirmed: 0, cancelled: 1, total: 1 });
    expect(await available()).toBe(true);
  });
  it.each(Array.from({ length: 8 }, (_unused, i) => i))(
    'keeps simultaneous cancellation/rebooking consistent (round %i)',
    async () => {
      const original = await create();
      const [cancellation, ...attempts] = await Promise.all([
        authenticated(app).delete('/bookings/' + original.id),
        ...Array.from({ length: 8 }, (_unused, i) =>
          authenticated(app)
            .post('/bookings')
            .send({ ...patient, email: `race${i}@example.com` }),
        ),
      ]);
      expect(cancellation.status).toBe(200);
      expect(cancellation.body).toEqual({ ...original, status: 'cancelled' });
      const winners = attempts.filter((r) => r.status === 201);
      expect(winners.length).toBeLessThanOrEqual(1);
      attempts
        .filter((r) => r.status !== 201)
        .forEach((r) => expectError(r, 409));
      expect(await counts()).toEqual({
        confirmed: winners.length,
        cancelled: 1,
        total: 1 + winners.length,
      });
      expect(await available()).toBe(winners.length === 0);
      await authenticated(app)
        .get('/bookings/' + original.id)
        .expect(200, { ...original, status: 'cancelled' });
      if (!winners.length) await create('after-race@example.com');
      expect((await counts()).confirmed).toBe(1);
      const incoherent = await pool.query<{
        count: number;
      }>(`select count(*)::int as count from bookings where
      (status = 'confirmed' and cancelled_at is not null) or (status = 'cancelled' and cancelled_at is null)`);
      expect(incoherent.rows[0].count).toBe(0);
    },
  );
  it('maps an actual expected index violation to 409 after rolling back the entire transaction', async () => {
    // Inject a competing row at insert time to exercise the database-error fallback,
    // which normal cooperating requests avoid through the slot lock/precheck.
    await installInsertTrigger(`if NEW.id <> 'index-fixture' then
      insert into bookings (id, slot_id, patient_name, patient_email)
      values ('index-fixture', NEW.slot_id, NEW.patient_name, NEW.patient_email); end if;`);
    try {
      await expect(
        pool.query(
          `insert into bookings (id, slot_id, patient_name, patient_email)
        values ('index-probe', $1, 'Probe', 'probe@example.com')`,
          [slot.id],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'bookings_one_confirmed_per_slot_idx',
      });
      expectError(
        await authenticated(app)
          .post('/bookings')
          .send(patient)
          .expect(409, conflict),
        409,
      );
      expect(await counts()).toEqual({ confirmed: 0, cancelled: 0, total: 0 });
    } finally {
      await removeInsertTrigger();
    }
    await create(); // also proves the failed transaction released its locks/connection.
  });
  it.each(['primary-key', 'check', 'foreign-key'])(
    'does not misclassify an unrelated %s database error as 409',
    async (fault) => {
      await pool.query(
        `insert into bookings (id, slot_id, patient_name, patient_email, status, cancelled_at)
      values ('unrelated-pk', $1, 'Fixture', 'fixture@example.com', 'cancelled', clock_timestamp())`,
        [slot.id],
      );
      const statement =
        fault === 'primary-key'
          ? "if NEW.id <> 'unrelated-pk' then insert into bookings (id, slot_id, patient_name, patient_email, status, cancelled_at) values ('unrelated-pk', NEW.slot_id, NEW.patient_name, NEW.patient_email, 'cancelled', clock_timestamp()); end if;"
          : fault === 'check'
            ? "NEW.patient_email := 'UPPER@EXAMPLE.COM';"
            : "NEW.slot_id := 'missing-slot';";
      await installInsertTrigger(statement);
      try {
        const expected =
          fault === 'primary-key'
            ? { code: '23505', constraint: 'bookings_pkey' }
            : fault === 'check'
              ? { code: '23514', constraint: 'bookings_email_normalized_check' }
              : { code: '23503', constraint: 'bookings_slot_id_slots_id_fk' };
        await expect(
          pool.query(
            `insert into bookings (id, slot_id, patient_name, patient_email)
          values ('unrelated-probe', $1, 'Probe', 'probe@example.com')`,
            [slot.id],
          ),
        ).rejects.toMatchObject(expected);
        const response = await authenticated(app)
          .post('/bookings')
          .send(patient)
          .expect(500, { error: 'internal server error' });
        expectError(response, 500);
        expect(await counts()).toEqual({
          confirmed: 0,
          cancelled: 1,
          total: 1,
        });
      } finally {
        await removeInsertTrigger();
      }
      await create();
    },
  );
  it('rolls back a failed cancellation and permits a subsequent healthy cancellation', async () => {
    const original = await create();
    await pool.query(`create function level3_cancel_fault() returns trigger language plpgsql as
      'begin NEW.cancelled_at := null; return NEW; end';
      create trigger level3_cancel_fault before update on bookings for each row execute function level3_cancel_fault()`);
    try {
      expectError(
        await authenticated(app)
          .delete('/bookings/' + original.id)
          .expect(500, { error: 'internal server error' }),
        500,
      );
      await authenticated(app)
        .get('/bookings/' + original.id)
        .expect(200, original);
      expect(await available()).toBe(false);
    } finally {
      await pool.query(
        'drop trigger level3_cancel_fault on bookings; drop function level3_cancel_fault()',
      );
    }
    await authenticated(app)
      .delete('/bookings/' + original.id)
      .expect(200, { ...original, status: 'cancelled' });
  });
  it('checks the actual database wall clock after waiting for a slot row lock', async () => {
    const locker = await pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await pool.query(
        "update slots set starts_at = clock_timestamp() + interval '2 seconds' where id = $1",
        [slot.id],
      );
      await locker.query('begin');
      await locker.query('select id from slots where id = $1 for update', [
        slot.id,
      ]);
      const pid = (
        await locker.query<{ pid: number }>('select pg_backend_pid() as pid')
      ).rows[0].pid;
      pending = authenticated(app)
        .post('/bookings')
        .send(patient)
        .timeout(15000)
        .then((r) => r);
      await waitUntil(
        async () =>
          (
            await pool.query<{ blocked: boolean }>(
              `select exists(
        select 1 from pg_stat_activity where datname = current_database() and pg_blocking_pids(pid) @> ARRAY[$1::int]
      ) as blocked`,
              [pid],
            )
          ).rows[0].blocked,
      );
      await waitUntil(
        async () =>
          (
            await pool.query<{ started: boolean }>(
              'select starts_at <= clock_timestamp() as started from slots where id = $1',
              [slot.id],
            )
          ).rows[0].started,
      );
      await locker.query('commit');
      const response = await pending;
      expectError(response, 400);
      expect(response.body).toEqual({ error: 'slot has already started' });
      expect((await counts()).total).toBe(0);
    } finally {
      await locker.query('rollback');
      locker.release();
      await pending?.catch(() => undefined);
    }
  });
  it('does not lock an unrelated slot while one booking waits', async () => {
    const locker: PoolClient = await pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await locker.query('begin');
      await locker.query('select id from slots where id = $1 for update', [
        slot.id,
      ]);
      const pid = (
        await locker.query<{ pid: number }>('select pg_backend_pid() as pid')
      ).rows[0].pid;
      pending = authenticated(app)
        .post('/bookings')
        .send(patient)
        .timeout(15000)
        .then((r) => r);
      await waitUntil(
        async () =>
          (
            await pool.query<{ blocked: boolean }>(
              `select exists(
        select 1 from pg_stat_activity where datname = current_database() and pg_blocking_pids(pid) @> ARRAY[$1::int]
      ) as blocked`,
              [pid],
            )
          ).rows[0].blocked,
      );
      await authenticated(app)
        .post('/bookings')
        .send({ ...patient, slot_id: 's2' })
        .timeout(5000)
        .expect(201);
      await locker.query('commit');
      expect((await pending).status).toBe(201);
    } finally {
      await locker.query('rollback');
      locker.release();
      await pending?.catch(() => undefined);
    }
  });
  it('coordinates reset, cancellation and booking without orphaned or duplicate confirmed rows', async () => {
    const original = await create();
    const [reset, cancellation, attempt] = await Promise.all([
      authenticated(app)
        .post('/reset')
        .send({ slots: [slot] }),
      authenticated(app).delete('/bookings/' + original.id),
      authenticated(app)
        .post('/bookings')
        .send({ ...patient, email: 'reset-race@example.com' }),
    ]);
    expect(reset.status).toBe(200);
    expect([200, 404]).toContain(cancellation.status);
    expect([201, 409]).toContain(attempt.status);
    expect((await counts()).confirmed).toBeLessThanOrEqual(1);
    const orphans = await pool.query<{ count: number }>(
      'select count(*)::int as count from bookings b left join slots s on s.id = b.slot_id where s.id is null',
    );
    expect(orphans.rows[0].count).toBe(0);
  });
});
