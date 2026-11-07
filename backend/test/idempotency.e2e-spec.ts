import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types';
import { authenticated, makeApp, testUrl } from './support';

interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
}
const slot = {
  id: 's1',
  provider: 'Dr Ade',
  start: '2099-12-10T09:00:00Z',
  end: '2099-12-10T09:30:00Z',
};
const body = { slot_id: 's1', name: 'Ada Obi', email: 'ada@example.com' };
function expectError(r: Response, status: number) {
  expect(r.status).toBe(status);
  expect(r.body).toEqual({ error: expect.any(String) as unknown });
}

describe('Level 4 — durable idempotency', () => {
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
      .expect(200);
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });
  const post = (key: string, input: unknown = body, target = app) =>
    authenticated(target)
      .post('/bookings')
      .set('Idempotency-Key', key)
      .send(input as object);
  async function counts() {
    return (
      await pool.query<{ bookings: number; records: number }>(`select
      (select count(*)::int from bookings) as bookings,
      (select count(*)::int from idempotency_records) as records`)
    ).rows[0];
  }

  it('replays the original status, ID and complete JSON without internal metadata', async () => {
    const first = await post('replay').expect(201);
    await post('replay').expect(201, first.body as Booking);
    expect(Object.keys(first.body as Booking).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'name',
      'slot_id',
      'status',
    ]);
    expect(await counts()).toEqual({ bookings: 1, records: 1 });
    const rows = await pool.query<{
      response_status: number;
      response_body: unknown;
    }>('select response_status, response_body from idempotency_records');
    expect(rows.rows).toEqual([
      { response_status: 201, response_body: first.body as unknown },
    ]);
  });
  it('canonicalizes object property order recursively without changing array order or string values', async () => {
    const input = {
      ...body,
      extra: { z: [1, { b: 'two', a: true }], a: null },
    };
    const first = await post('canonical', input).expect(201);
    await post('canonical', {
      extra: { a: null, z: [1, { a: true, b: 'two' }] },
      email: body.email,
      name: body.name,
      slot_id: body.slot_id,
    }).expect(201, first.body as Booking);
    await post('canonical', {
      ...input,
      extra: { a: null, z: [{ a: true, b: 'two' }, 1] },
    }).expect(422);
  });
  it.each([
    ['name whitespace', { ...body, name: ' Ada Obi ' }],
    ['email case', { ...body, email: 'ADA@EXAMPLE.COM' }],
    ['email whitespace', { ...body, email: ' ada@example.com ' }],
    ['slot', { ...body, slot_id: 's2' }],
    ['extra field', { ...body, extra: true }],
    ['invalid changed body', {}],
  ])(
    'returns 422 for %s and preserves the original record',
    async (_label, input) => {
      const first = await post('mismatch').expect(201);
      expectError(await post('mismatch', input).expect(422), 422);
      await post('mismatch').expect(201, first.body as Booking);
      expect(await counts()).toEqual({ bookings: 1, records: 1 });
    },
  );
  it('keeps numeric JSON values distinct from strings in extra fields', async () => {
    await post('types', { ...body, extra: 1 }).expect(201);
    await post('types', { ...body, extra: '1' }).expect(422);
  });
  it('includes special own JSON keys in canonical identity without prototype pollution', async () => {
    const raw =
      '{"slot_id":"s1","name":"Ada Obi","email":"ada@example.com","__proto__":{"value":1}}';
    await authenticated(app)
      .post('/bookings')
      .set('Idempotency-Key', 'special')
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(201);
    await post('special').expect(422);
    expect(({} as Record<string, unknown>).value).toBeUndefined();
  });
  it('preserves independent booking creation when no header is present', async () => {
    const a = await authenticated(app).post('/bookings').send(body).expect(201);
    const b = await authenticated(app)
      .post('/bookings')
      .send({ ...body, slot_id: 's2' })
      .expect(201);
    expect((a.body as Booking).id).not.toBe((b.body as Booking).id);
    expect(await counts()).toEqual({ bookings: 2, records: 0 });
  });
  it('serializes sixteen simultaneous identical retries', async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, () => post('concurrent')),
    );
    results.forEach((r) => {
      expect(r.status).toBe(201);
      expect(r.body).toEqual(results[0].body);
    });
    expect(await counts()).toEqual({ bookings: 1, records: 1 });
  });
  it('serializes matching retries across two independent Nest instances', async () => {
    const second = await makeApp();
    await second.listen(0, '127.0.0.1');
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_unused, i) =>
          post('replica', body, i % 2 ? second : app),
        ),
      );
      results.forEach((r) => {
        expect(r.status).toBe(201);
        expect(r.body).toEqual(results[0].body);
      });
      expect(await counts()).toEqual({ bookings: 1, records: 1 });
    } finally {
      await second.close();
    }
  });
  it('chooses one original body under simultaneous changed-body retries', async () => {
    const inputs = Array.from({ length: 12 }, (_unused, i) => ({
      ...body,
      slot_id: i % 2 ? 's2' : 's1',
    }));
    const results = await Promise.all(
      inputs.map((input) => post('mixed', input)),
    );
    const winner = results.find((r) => r.status === 201)!;
    expect(winner).toBeDefined();
    results.forEach((r, i) => {
      if (inputs[i].slot_id === (winner.body as Booking).slot_id) {
        expect(r.status).toBe(201);
        expect(r.body).toEqual(winner.body);
      } else expectError(r, 422);
    });
    expect(await counts()).toEqual({ bookings: 1, records: 1 });
  });
  it('keeps different keys subject to the same confirmed-slot invariant', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_unused, i) =>
        post('different-' + i, { ...body, email: `different${i}@example.com` }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    results.filter((r) => r.status !== 201).forEach((r) => expectError(r, 409));
    expect(await counts()).toEqual({ bookings: 1, records: 12 });
  });
  it('replays the original confirmed response after cancellation without recreating the booking', async () => {
    const first = await post('cancel').expect(201);
    const original = first.body as Booking;
    await authenticated(app)
      .delete('/bookings/' + original.id)
      .expect(200);
    await post('cancel').expect(201, original);
    await authenticated(app)
      .get('/bookings/' + original.id)
      .expect(200, { ...original, status: 'cancelled' });
    expect(await counts()).toEqual({ bookings: 1, records: 1 });
  });
  it('persists original responses across an application restart', async () => {
    const first = await post('restart').expect(201);
    await app.close();
    app = await makeApp();
    await app.listen(0, '127.0.0.1');
    await post('restart').expect(201, first.body as Booking);
    expect(await counts()).toEqual({ bookings: 1, records: 1 });
  });
  it('retains a deterministic 404 even after the slot becomes available', async () => {
    const input = { ...body, slot_id: 'later' };
    const first = await post('missing', input).expect(404);
    await pool.query(
      `insert into slots (id, provider, starts_at, ends_at) values ('later','Dr', $1, $2)`,
      [slot.start, slot.end],
    );
    await post('missing', input).expect(404, first.body as object);
    await post('new-key', input).expect(201);
    expect(await counts()).toEqual({ bookings: 1, records: 2 });
  });
  it('retains a deterministic occupied-slot 409 after cancellation', async () => {
    const created = await authenticated(app)
      .post('/bookings')
      .send(body)
      .expect(201);
    const first = await post('occupied').expect(409);
    await authenticated(app)
      .delete('/bookings/' + (created.body as Booking).id)
      .expect(200);
    await post('occupied').expect(409, first.body as object);
    await post('free').expect(201);
  });
  it('retains a deterministic started-slot 400 after its start is changed', async () => {
    await pool.query(
      "update slots set starts_at=clock_timestamp()-interval '1 second' where id='s1'",
    );
    const first = await post('past').expect(400);
    await pool.query("update slots set starts_at=$1 where id='s1'", [
      slot.start,
    ]);
    await post('past').expect(400, first.body as object);
    await post('future').expect(201);
  });
  it('retains deterministic validation errors after canonical parsed-body matching', async () => {
    const input = { email: 'bad', slot_id: 's1' };
    const first = await post('invalid', input).expect(400);
    await post('invalid', { slot_id: 's1', email: 'bad' }).expect(
      400,
      first.body as object,
    );
    expect(await counts()).toEqual({ bookings: 0, records: 1 });
  });
  it('rolls back a successful booking if storing its response fails and allows retry', async () => {
    await pool.query(`create function level4_store_fault() returns trigger language plpgsql as 'begin raise exception ''test storage failure''; end';
      create trigger level4_store_fault before insert on idempotency_records for each row execute function level4_store_fault()`);
    try {
      expectError(await post('rollback').expect(500), 500);
      expect(await counts()).toEqual({ bookings: 0, records: 0 });
    } finally {
      await pool.query(
        'drop trigger level4_store_fault on idempotency_records; drop function level4_store_fault()',
      );
    }
    await post('rollback').expect(201);
    expect(await counts()).toEqual({ bookings: 1, records: 1 });
  });
  it('does not cache transient booking failures', async () => {
    await pool.query(`create function level4_booking_fault() returns trigger language plpgsql as 'begin raise exception ''test transient failure''; end';
      create trigger level4_booking_fault before insert on bookings for each row execute function level4_booking_fault()`);
    try {
      expectError(await post('transient').expect(500), 500);
      expect(await counts()).toEqual({ bookings: 0, records: 0 });
    } finally {
      await pool.query(
        'drop trigger level4_booking_fault on bookings; drop function level4_booking_fault()',
      );
    }
    await post('transient').expect(201);
  });
  it('recovers an actual uniqueness failure to a savepoint before committing/replaying its 409', async () => {
    await pool.query(`create function level4_index_fault() returns trigger language plpgsql as $f$ begin
      if NEW.id <> 'competing' then insert into bookings (id,slot_id,patient_name,patient_email)
      values ('competing',NEW.slot_id,NEW.patient_name,NEW.patient_email); end if; return NEW; end $f$;
      create trigger level4_index_fault before insert on bookings for each row execute function level4_index_fault()`);
    try {
      expectError(await post('index-error').expect(409), 409);
      expect(await counts()).toEqual({ bookings: 0, records: 1 });
    } finally {
      await pool.query(
        'drop trigger level4_index_fault on bookings; drop function level4_index_fault()',
      );
    }
    await post('index-error').expect(409);
    await post('index-new').expect(201);
  });
  it('reset clears old responses and allows key reuse with a new booking ID/body', async () => {
    const first = await post('reset-key').expect(201);
    await authenticated(app)
      .post('/reset')
      .send({ slots: [slot, { ...slot, id: 's2' }] })
      .expect(200);
    expect(await counts()).toEqual({ bookings: 0, records: 0 });
    const second = await post('reset-key', { ...body, slot_id: 's2' }).expect(
      201,
    );
    expect((second.body as Booking).id).not.toBe((first.body as Booking).id);
  });
  it('authentication precedes replay, mismatch and validation and does not write metadata', async () => {
    const first = await post('auth').expect(201);
    for (const input of [body, {}])
      expectError(
        await request(app.getHttpServer())
          .post('/bookings')
          .set('Idempotency-Key', 'auth')
          .send(input)
          .expect(401),
        401,
      );
    expect(await counts()).toEqual({ bookings: 1, records: 1 });
    await post('auth').expect(201, first.body as Booking);
  });
  it('accepts a present empty string key without inventing a header-length restriction', async () => {
    const first = await post('').expect(201);
    await post('').expect(201, first.body as Booking);
  });

  it('supports long header keys without exceeding PostgreSQL index entry size', async () => {
    const key = randomBytes(2000).toString('hex');
    const first = await post(key).expect(201);
    await post(key).expect(201, first.body as Booking);
    const stored = await pool.query<{ key: string }>(
      'select key from idempotency_records',
    );
    expect(stored.rows[0].key).toMatch(/^[a-f0-9]{64}$/);
  });
});
