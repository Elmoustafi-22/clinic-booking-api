import { config } from 'dotenv';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

interface Slot {
  id: string;
  provider: string;
  start: string;
  end: string;
}
interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
}
interface SlotsPage {
  slots: (Slot & { available: boolean })[];
}

// Never fall back to DATABASE_URL: these tests reset every fixture table.
config({ path: ['.env.test', '.env.level1-local', '.env'], quiet: true });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) {
  throw new Error(
    'TEST_DATABASE_URL must explicitly name a dedicated database ending in _test',
  );
}
process.env.DATABASE_URL = testUrl;

const inventory: Slot[] = [
  {
    id: 's2',
    provider: 'Dr Ade',
    start: '2099-12-10T10:00:00Z',
    end: '2099-12-10T10:30:00Z',
  },
  {
    id: 's1',
    provider: 'Dr Ade',
    start: '2099-12-10T09:00:00Z',
    end: '2099-12-10T09:30:00Z',
  },
  {
    id: 'other',
    provider: 'Dr Ada',
    start: '2099-12-10T08:00:00Z',
    end: '2099-12-10T08:30:00Z',
  },
  {
    id: 'past',
    provider: 'Dr Past',
    start: '2020-01-01T09:00:00Z',
    end: '2020-01-01T09:30:00Z',
  },
];
const newBooking = { slot_id: 's1', name: 'Ada Obi', email: 'ada@example.com' };

async function makeApp() {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication<INestApplication<App>>();
  await app.init();
  return app;
}

describe('Level 1 — real PostgreSQL integration', () => {
  let app: INestApplication<App>;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl });
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(__dirname, '../drizzle'),
    });
    // Applying the same committed migration twice must be harmless.
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(__dirname, '../drizzle'),
    });
    app = await makeApp();
  });

  beforeEach(async () => {
    await request(app.getHttpServer())
      .post('/reset')
      .send({ slots: inventory })
      .expect(200, {});
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function snapshot() {
    const result = await pool.query<{
      state: unknown;
    }>(`select jsonb_build_object(
      'slots', (select jsonb_agg(s order by s.id) from slots s),
      'bookings', (select jsonb_agg(b order by b.id) from bookings b),
      'idempotency', (select jsonb_agg(i order by i.key) from idempotency_records i),
      'attempts', (select jsonb_agg(a order by a.id) from booking_attempts a)
    ) as state`);
    return result.rows[0].state;
  }

  async function seedAuxiliaryState() {
    await pool.query(`insert into idempotency_records
      (client_scope, operation, key, request_hash, response_status, response_body)
      values ('fixture', 'POST /bookings', 'key', repeat('a', 64), 201, '{}')`);
    await pool.query(
      `insert into booking_attempts (email, attempted_at) values ('ada@example.com', now())`,
    );
  }

  it('lists every slot in chronological order with required fields and true availability', async () => {
    const response = await request(app.getHttpServer())
      .get('/slots')
      .expect(200)
      .expect('Content-Type', /json/);
    const body = response.body as SlotsPage;
    expect(Object.keys(body)).toEqual(['slots']);
    expect(body.slots.map((s) => s.id)).toEqual(['past', 'other', 's1', 's2']);
    for (const slot of body.slots) {
      expect(Object.keys(slot).sort()).toEqual([
        'available',
        'end',
        'id',
        'provider',
        'start',
      ]);
      expect(slot.available).toBe(true);
      const fixture = inventory.find((s) => s.id === slot.id)!;
      expect(Date.parse(slot.start)).toBe(Date.parse(fixture.start));
      expect(Date.parse(slot.end)).toBe(Date.parse(fixture.end));
    }
  });

  it('filters by exact provider name and retains start ordering', async () => {
    const response = await request(app.getHttpServer())
      .get('/slots')
      .query({ provider: 'Dr Ade' })
      .expect(200);
    expect((response.body as SlotsPage).slots.map((s) => s.id)).toEqual([
      's1',
      's2',
    ]);
  });

  it.each(['dr ade', 'Dr Ade ', 'unknown', "Dr Ade' OR 1=1 --"])(
    'does not broaden or normalize the provider filter: %s',
    async (provider) => {
      await request(app.getHttpServer())
        .get('/slots')
        .query({ provider })
        .expect(200, { slots: [] });
    },
  );

  it('accepts offset timestamps and returns equivalent UTC instants', async () => {
    await request(app.getHttpServer())
      .post('/reset')
      .send({
        slots: [
          {
            id: 'offset',
            provider: 'Dr Ade',
            start: '2099-12-10T10:00:00+01:00',
            end: '2099-12-10T10:30:00+01:00',
          },
        ],
      })
      .expect(200, {});
    const response = await request(app.getHttpServer())
      .get('/slots')
      .expect(200);
    expect((response.body as SlotsPage).slots[0].start).toBe(
      '2099-12-10T09:00:00.000Z',
    );
  });

  it('creates an unwrapped six-field confirmed booking and retrieves it unchanged', async () => {
    const response = await request(app.getHttpServer())
      .post('/bookings')
      .send(newBooking)
      .expect(201);
    const booking = response.body as Booking;
    expect(Object.keys(booking).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'name',
      'slot_id',
      'status',
    ]);
    expect(booking).toEqual({
      ...newBooking,
      id: expect.any(String) as unknown,
      status: 'confirmed',
      created_at: expect.any(String) as unknown,
    });
    expect(booking.id.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(booking.created_at))).toBe(true);
    await request(app.getHttpServer())
      .get(`/bookings/${booking.id}`)
      .expect(200, booking);
    const listing = await request(app.getHttpServer())
      .get('/slots')
      .expect(200);
    const slots = (listing.body as SlotsPage).slots;
    expect(slots.find((s) => s.id === 's1')?.available).toBe(false);
    expect(slots.filter((s) => s.id !== 's1').every((s) => s.available)).toBe(
      true,
    );
  });

  it('stores canonical patient details without changing the six-field response contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/bookings')
      .send({
        ...newBooking,
        name: '  Ada Obi  ',
        email: '  ADA@EXAMPLE.COM  ',
      })
      .expect(201);
    const booking = response.body as Booking;
    expect(booking.name).toBe('Ada Obi');
    expect(booking.email).toBe('ada@example.com');
    await request(app.getHttpServer())
      .get(`/bookings/${booking.id}`)
      .expect(200, booking);
  });

  it('does not impose unspecified nonblank-slot or interval-order restrictions on reset', async () => {
    await request(app.getHttpServer())
      .post('/reset')
      .send({
        slots: [
          {
            ...inventory[0],
            id: '',
            provider: '',
            start: inventory[0].end,
            end: inventory[0].start,
            extra: 'ignored',
          },
        ],
      })
      .expect(200, {});
    const response = await request(app.getHttpServer())
      .get('/slots')
      .expect(200);
    expect((response.body as SlotsPage).slots).toHaveLength(1);
    expect((response.body as SlotsPage).slots[0].id).toBe('');
  });

  it('keeps separate bookings distinct across successive requests', async () => {
    const first = await request(app.getHttpServer())
      .post('/bookings')
      .send(newBooking)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/bookings')
      .send({ ...newBooking, slot_id: 's2' })
      .expect(201);
    const a = first.body as Booking;
    const b = second.body as Booking;
    expect(a.id).not.toBe(b.id);
    await request(app.getHttpServer()).get(`/bookings/${a.id}`).expect(200, a);
    await request(app.getHttpServer()).get(`/bookings/${b.id}`).expect(200, b);
  });

  it('persists bookings and availability across an application restart with a new connection pool', async () => {
    const response = await request(app.getHttpServer())
      .post('/bookings')
      .send(newBooking)
      .expect(201);
    const booking = response.body as Booking;
    await app.close();
    app = await makeApp();
    await request(app.getHttpServer())
      .get(`/bookings/${booking.id}`)
      .expect(200, booking);
    const listing = await request(app.getHttpServer())
      .get('/slots')
      .expect(200);
    expect(
      (listing.body as SlotsPage).slots.find((s) => s.id === 's1')?.available,
    ).toBe(false);
    const stored = await pool.query<{ id: string }>(
      'select id from bookings where id = $1',
      [booking.id],
    );
    expect(stored.rows).toEqual([{ id: booking.id }]);
  });

  it('returns JSON 404 for an unknown non-UUID booking ID', async () => {
    await request(app.getHttpServer())
      .get('/bookings/does-not-exist')
      .expect(404, { error: 'booking not found' });
  });

  it('does not create a booking for a nonexistent slot', async () => {
    await request(app.getHttpServer())
      .post('/bookings')
      .send({ ...newBooking, slot_id: 'absent' })
      .expect(404, { error: 'slot not found' });
    const count = await pool.query<{ count: string }>(
      'select count(*) from bookings',
    );
    expect(count.rows[0].count).toBe('0');
  });

  it('clears all four fixture tables and replaces the inventory on reset', async () => {
    const created = await request(app.getHttpServer())
      .post('/bookings')
      .send(newBooking)
      .expect(201);
    await seedAuxiliaryState();
    await request(app.getHttpServer())
      .post('/reset')
      .send({ slots: [inventory[3]] })
      .expect(200, {});
    const booking = created.body as Booking;
    await request(app.getHttpServer())
      .get(`/bookings/${booking.id}`)
      .expect(404);
    const listing = await request(app.getHttpServer())
      .get('/slots')
      .expect(200);
    expect((listing.body as SlotsPage).slots.map((s) => s.id)).toEqual([
      'past',
    ]);
    const counts = await pool.query<{
      bookings: string;
      records: string;
      attempts: string;
    }>(`select
      (select count(*) from bookings) as bookings,
      (select count(*) from idempotency_records) as records,
      (select count(*) from booking_attempts) as attempts`);
    expect(counts.rows[0]).toEqual({
      bookings: '0',
      records: '0',
      attempts: '0',
    });
  });

  it('accepts an empty inventory and returns an empty listing', async () => {
    await request(app.getHttpServer())
      .post('/reset')
      .send({ slots: [] })
      .expect(200, {});
    await request(app.getHttpServer()).get('/slots').expect(200, { slots: [] });
  });

  const invalidResetBodies: [string, unknown][] = [
    ['missing slots', {}],
    ['non-array slots', { slots: {} }],
    ['null slot', { slots: [null] }],
    [
      'missing end',
      { slots: [{ id: 'bad', provider: 'Dr', start: '2099-01-01T00:00:00Z' }] },
    ],
    ['wrong id type', { slots: [{ ...inventory[0], id: 123 }] }],
    ['wrong provider type', { slots: [{ ...inventory[0], provider: null }] }],
    ['invalid start', { slots: [{ ...inventory[0], start: 'not-a-date' }] }],
    [
      'impossible calendar date',
      { slots: [{ ...inventory[0], start: '2099-02-31T10:00:00Z' }] },
    ],
    [
      'missing timezone',
      { slots: [{ ...inventory[0], start: '2099-01-01T10:00:00' }] },
    ],
    ['invalid end', { slots: [{ ...inventory[0], end: 'nope' }] }],
    [
      'duplicate IDs',
      { slots: [inventory[0], { ...inventory[1], id: inventory[0].id }] },
    ],
    [
      'invalid later item',
      { slots: [inventory[0], { ...inventory[1], end: 123 }] },
    ],
  ];
  it.each(invalidResetBodies)(
    'rejects %s with 400 and preserves all existing state',
    async (_label, body) => {
      await request(app.getHttpServer())
        .post('/bookings')
        .send(newBooking)
        .expect(201);
      await seedAuxiliaryState();
      const before = await snapshot();
      const response = await request(app.getHttpServer())
        .post('/reset')
        .send(body as object)
        .expect(400);
      expect(response.body).toEqual({ error: expect.any(String) as unknown });
      expect(await snapshot()).toEqual(before);
    },
  );

  it('rejects malformed reset JSON without deleting existing state', async () => {
    const before = await snapshot();
    const response = await request(app.getHttpServer())
      .post('/reset')
      .set('Content-Type', 'application/json')
      .send('{"slots":')
      .expect(400);
    expect(response.body).toEqual({ error: expect.any(String) as unknown });
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back every reset deletion if PostgreSQL fails during replacement', async () => {
    await request(app.getHttpServer())
      .post('/bookings')
      .send(newBooking)
      .expect(201);
    await seedAuxiliaryState();
    const before = await snapshot();
    await pool.query(`create function fail_fixture_insert() returns trigger language plpgsql as
      'begin raise exception ''fixture insertion failure''; end';
      create trigger fail_fixture before insert on slots for each row execute function fail_fixture_insert()`);
    try {
      await request(app.getHttpServer())
        .post('/reset')
        .send({ slots: [inventory[0]] })
        .expect(500, { error: 'internal server error' });
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(
        'drop trigger fail_fixture on slots; drop function fail_fixture_insert()',
      );
    }
  });

  it('installs the partial unique confirmed-slot index in the initial migration', async () => {
    const index = await pool.query<{
      indexdef: string;
    }>(`select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'bookings_one_confirmed_per_slot_idx'`);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(index.rows[0].indexdef).toMatch(/WHERE .*status.*confirmed/);
  });

  it('does not expose the scaffold root, history or cancellation routes', async () => {
    for (const path of ['/', '/bookings']) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      expect(response.body).toEqual({ error: expect.any(String) as unknown });
    }
    const response = await request(app.getHttpServer())
      .delete('/bookings/absent')
      .expect(404);
    expect(response.body).toEqual({ error: expect.any(String) as unknown });
  });
});
