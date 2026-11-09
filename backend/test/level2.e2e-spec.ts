import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { authenticated, makeApp, testApiKey, testUrl } from './support';

const slot = {
  id: 's1',
  provider: 'Dr Ade',
  start: '2099-12-10T09:00:00Z',
  end: '2099-12-10T09:30:00Z',
};
const booking = { slot_id: slot.id, name: 'Ada Obi', email: 'ada@example.com' };
interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
}

function expectError(response: Response) {
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.body).toEqual({ error: expect.any(String) as unknown });
  const body = response.body as { error: string };
  expect(body.error.length).toBeGreaterThan(0);
  expect(body.error).not.toContain(testApiKey);
}

describe('Level 2 — real PostgreSQL integration', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl });
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(__dirname, '../drizzle'),
    });
    app = await makeApp();
  });
  beforeEach(async () => {
    await authenticated(app)
      .post('/reset')
      .send({ slots: [slot] })
      .expect(200, {});
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const routes = [
    {
      method: 'post' as const,
      path: '/reset',
      success: 200,
      body: { slots: [slot] },
    },
    { method: 'get' as const, path: '/slots', success: 200 },
    { method: 'post' as const, path: '/bookings', success: 201, body: booking },
    { method: 'get' as const, path: '/bookings/unknown', success: 404 },
    {
      method: 'get' as const,
      path: '/bookings?email=ada@example.com',
      success: 200,
    },
    { method: 'delete' as const, path: '/bookings/unknown', success: 404 },
  ];
  const invalidTextRoutes = [
    { method: 'get' as const, path: '/bookings/%00' },
    { method: 'delete' as const, path: '/bookings/%00' },
    { method: 'get' as const, path: '/slots?provider=%00' },
  ];
  it('recovers from a real idle PostgreSQL disconnect with a sanitized log', async () => {
    const database = app.get(DatabaseService);
    const result = await database.db.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    // Observe the real pool event, without substituting the pool or database.
    const primaryPool = (database as unknown as { pool: Pool }).pool;
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    let timeout: NodeJS.Timeout | undefined;
    let listener: () => void = () => undefined;
    const disconnected = new Promise<void>((resolve, reject) => {
      listener = resolve;
      primaryPool.once('error', listener);
      timeout = setTimeout(
        () => reject(new Error('idle disconnect event was not observed')),
        5000,
      );
    });
    try {
      await pool.query('select pg_terminate_backend($1)', [result.rows[0].pid]);
      await disconnected;
      expect(logged).toHaveBeenCalledWith('database connection failed');
      expect(logged.mock.calls).toEqual([['database connection failed']]);
      await authenticated(app).get('/slots').expect(200);
    } finally {
      clearTimeout(timeout);
      primaryPool.off('error', listener);
      logged.mockRestore();
    }
  });
  for (const route of invalidTextRoutes) {
    it(
      'rejects NUL before SQL: ' + route.method + ' ' + route.path,
      async () => {
        const response = await authenticated(app)
          [route.method](route.path)
          .expect(400);
        expectError(response);
        expect(response.body).toEqual({
          error: route.path.startsWith('/slots')
            ? 'provider must be a string'
            : 'id must be a string',
        });
        expect(
          (await pool.query('select count(*)::int as count from slots')).rows,
        ).toEqual([{ count: 1 }]);
        await authenticated(app).get('/slots').expect(200);
      },
    );
    it.each(['missing', 'incorrect'])(
      '%s key precedes invalid text: ' + route.method + ' ' + route.path,
      async (kind) => {
        const call = request(app.getHttpServer())[route.method](route.path);
        if (kind === 'incorrect')
          call.set('X-API-Key', randomBytes(32).toString('hex'));
        expectError(await call.expect(401));
      },
    );
  }
  it('preserves arbitrary valid stored booking IDs for lookup and cancellation', async () => {
    const created = await authenticated(app)
      .post('/bookings')
      .send(booking)
      .expect(201);
    const original = created.body as Booking;
    const id = ' Mixed/Case?% café . ';
    await pool.query('update bookings set id = $1 where id = $2', [
      id,
      original.id,
    ]);
    const path = '/bookings/' + encodeURIComponent(id);
    const found = await authenticated(app).get(path).expect(200);
    expect(found.body).toEqual({ ...original, id });
    const cancelled = await authenticated(app).delete(path).expect(200);
    expect(cancelled.body).toEqual({ ...original, id, status: 'cancelled' });
    expectError(
      await authenticated(app)
        .get('/bookings/' + encodeURIComponent(id + 'x'))
        .expect(404),
    );
  });
  it('preserves exact arbitrary valid provider text without trimming or case folding', async () => {
    const provider = ' Dr/Case?% café . ';
    await authenticated(app)
      .post('/reset')
      .send({ slots: [{ ...slot, provider }] })
      .expect(200);
    const exact = await authenticated(app)
      .get('/slots')
      .query({ provider })
      .expect(200);
    expect((exact.body as { slots: unknown[] }).slots).toHaveLength(1);
    await authenticated(app)
      .get('/slots')
      .query({ provider: provider.trim() })
      .expect(200, { slots: [] });
  });
  for (const route of routes) {
    it.each(['missing', 'empty', 'incorrect', 'whitespace'])(
      '%s API key rejects ' + route.method.toUpperCase() + ' ' + route.path,
      async (kind) => {
        const call = request(app.getHttpServer())[route.method](route.path);
        if (kind !== 'missing')
          call.set(
            'X-API-Key',
            kind === 'incorrect'
              ? randomBytes(32).toString('hex')
              : kind === 'empty'
                ? ''
                : '   ',
          );
        if (route.body) call.send(route.body);
        const response = await call.expect(401);
        expectError(response);
      },
    );
    it(
      'accepts the correct key for ' +
        route.method.toUpperCase() +
        ' ' +
        route.path,
      async () => {
        const call = request(app.getHttpServer())
          [route.method](route.path)
          .set('X-API-Key', testApiKey);
        if (route.body) call.send(route.body);
        const response = await call.expect(route.success);
        if (route.success === 404) expectError(response);
      },
    );
  }

  it('authenticates before booking DTO validation', async () => {
    expectError(
      await request(app.getHttpServer())
        .post('/bookings')
        .send({ email: 'bad' })
        .expect(401),
    );
    expectError(
      await authenticated(app)
        .post('/bookings')
        .send({ email: 'bad' })
        .expect(400),
    );
  });
  it('authenticates before reset validation and preserves inventory', async () => {
    expectError(
      await request(app.getHttpServer())
        .post('/reset')
        .send({ slots: null })
        .expect(401),
    );
    const result = await pool.query<{ id: string }>('select id from slots');
    expect(result.rows).toEqual([{ id: slot.id }]);
  });
  it.each(['/bookings', '/reset'])(
    'authenticates before malformed JSON parsing at %s',
    async (path) => {
      expectError(
        await request(app.getHttpServer())
          .post(path)
          .set('Content-Type', 'application/json')
          .send('{')
          .expect(401),
      );
      expectError(
        await authenticated(app)
          .post(path)
          .set('Content-Type', 'application/json')
          .send('{')
          .expect(400),
      );
    },
  );
  it('accepts case-insensitive HTTP header names and Express-compatible path casing/trailing slash', async () => {
    await request(app.getHttpServer())
      .get('/SLOTS/')
      .set('x-api-key', testApiKey)
      .expect(200);
    expectError(await request(app.getHttpServer()).get('/SLOTS/').expect(401));
  });
  it('rejects repeated key headers', async () => {
    expectError(
      await request(app.getHttpServer())
        .get('/slots')
        .set({ 'X-API-Key': [testApiKey, testApiKey] })
        .expect(401),
    );
  });

  const badFields: [string, unknown][] = [
    ['empty', ''],
    ['whitespace', ' \t\n '],
    ['null', null],
    ['number', 42],
    ['boolean', false],
    ['object', {}],
    ['array', ['value']],
  ];
  for (const field of ['slot_id', 'name', 'email']) {
    it('rejects missing ' + field, async () => {
      const input: Record<string, unknown> = { ...booking };
      delete input[field];
      expectError(
        await authenticated(app).post('/bookings').send(input).expect(400),
      );
      const result = await pool.query<{ count: string }>(
        'select count(*) from bookings',
      );
      expect(result.rows[0].count).toBe('0');
    });
    it.each(badFields)(
      'rejects ' + field + ' that is %s',
      async (_label, value) => {
        expectError(
          await authenticated(app)
            .post('/bookings')
            .send({ ...booking, [field]: value })
            .expect(400),
        );
        const result = await pool.query<{ count: string }>(
          'select count(*) from bookings',
        );
        expect(result.rows[0].count).toBe('0');
      },
    );
  }
  it.each([
    'not-an-email',
    'ada@',
    '@example.com',
    'ada example@example.com',
    'ada@@example.com',
    'Ada <ada@example.com>',
  ])('rejects invalid email %s', async (email) => {
    expectError(
      await authenticated(app)
        .post('/bookings')
        .send({ ...booking, email })
        .expect(400),
    );
  });
  it('rejects a non-object booking body', async () => {
    expectError(
      await authenticated(app).post('/bookings').send([]).expect(400),
    );
  });
  it('trims before validation, lowercases stored email, and preserves success/lookup schemas', async () => {
    const response = await authenticated(app)
      .post('/bookings')
      .send({
        ...booking,
        name: ' \tAda Obi\n ',
        email: ' \tADA@EXAMPLE.COM\n ',
      })
      .expect(201);
    const created = response.body as Booking;
    expect(Object.keys(created).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'name',
      'slot_id',
      'status',
    ]);
    expect(created.name).toBe('Ada Obi');
    expect(created.email).toBe('ada@example.com');
    await authenticated(app)
      .get('/bookings/' + created.id)
      .expect(200, created);
    const result = await pool.query<{ name: string; email: string }>(
      'select patient_name as name, patient_email as email from bookings where id = $1',
      [created.id],
    );
    expect(result.rows).toEqual([
      { name: 'Ada Obi', email: 'ada@example.com' },
    ]);
  });
  it('does not impose an arbitrary name length or reject unspecified extra properties', async () => {
    const name = 'A'.repeat(1000);
    const response = await authenticated(app)
      .post('/bookings')
      .send({ ...booking, name, extra: 'allowed' })
      .expect(201);
    expect((response.body as Booking).name).toBe(name);
    expect(Object.keys(response.body as Booking)).not.toContain('extra');
  });
  it('preserves arbitrary string slot IDs including case and surrounding spaces', async () => {
    const id = ' Mixed-Case/clinic slot ';
    await authenticated(app)
      .post('/reset')
      .send({ slots: [{ ...slot, id }] })
      .expect(200);
    const response = await authenticated(app)
      .post('/bookings')
      .send({ ...booking, slot_id: id })
      .expect(201);
    expect((response.body as Booking).slot_id).toBe(id);
  });
  it.each(['S1', 's1 ', 'absent'])(
    'does not normalize a requested slot ID: %s',
    async (id) => {
      expectError(
        await authenticated(app)
          .post('/bookings')
          .send({ ...booking, slot_id: id })
          .expect(404),
      );
    },
  );
  it('rejects a past slot with 400 without inserting a booking', async () => {
    await pool.query(
      "update slots set starts_at = clock_timestamp() - interval '1 second'",
    );
    const response = await authenticated(app)
      .post('/bookings')
      .send(booking)
      .expect(400);
    expectError(response);
    expect(response.body).toEqual({ error: 'slot has already started' });
    const count = await pool.query<{ count: string }>(
      'select count(*) from bookings',
    );
    expect(count.rows[0].count).toBe('0');
  });
  it('rejects a started slot before encountering an existing confirmed booking', async () => {
    await pool.query(
      "update slots set starts_at = clock_timestamp() - interval '1 second'",
    );
    await pool.query(
      "insert into bookings (id, slot_id, patient_name, patient_email) values ('fixture', $1, $2, $3)",
      [slot.id, booking.name, booking.email],
    );
    await authenticated(app)
      .post('/bookings')
      .send(booking)
      .expect(400, { error: 'slot has already started' });
  });
  it('rejects exactly-now at the database comparison boundary', async () => {
    const time = '2035-06-01T09:00:00.000Z';
    // Control only the clock expression; all selects/inserts still execute on PostgreSQL.
    const fixed = await makeApp(sql`${time}::timestamptz`);
    try {
      await authenticated(fixed)
        .post('/reset')
        .send({ slots: [{ ...slot, start: time }] })
        .expect(200);
      expectError(
        await authenticated(fixed).post('/bookings').send(booking).expect(400),
      );
    } finally {
      await fixed.close();
    }
  });
  it('allows a start strictly after the same controlled database instant', async () => {
    const time = '2035-06-01T09:00:00.000Z';
    const fixed = await makeApp(sql`${time}::timestamptz`);
    try {
      await authenticated(fixed)
        .post('/reset')
        .send({ slots: [{ ...slot, start: '2035-06-01T09:00:00.001Z' }] })
        .expect(200);
      await authenticated(fixed).post('/bookings').send(booking).expect(201);
    } finally {
      await fixed.close();
    }
  });

  it.each([1, 80])(
    'rejects an incorrect API key generated from %i bytes',
    async (size) => {
      expectError(
        await request(app.getHttpServer())
          .get('/slots')
          .set('X-API-Key', randomBytes(size).toString('hex'))
          .expect(401),
      );
    },
  );

  it.each([undefined, '', '   ', '\ninvalid', 'invalid\tkey'])(
    'fails startup on missing/invalid API_KEY configuration (case %#)',
    async (value) => {
      if (value === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = value;
      try {
        await expect(
          Test.createTestingModule({ imports: [AppModule] }).compile(),
        ).rejects.toThrow(/API_KEY/);
      } finally {
        process.env.API_KEY = testApiKey;
      }
    },
  );
});
