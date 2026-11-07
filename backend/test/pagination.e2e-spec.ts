import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types';
import { authenticated, makeApp, testUrl } from './support';
import { BookingCursor } from '../src/bookings/booking-cursor';
interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
}
interface Page {
  bookings: Booking[];
  next_cursor: string | null;
}
const email = 'ada@example.com';
function error(r: Response) {
  expect(r.status).toBe(400);
  expect(r.body).toEqual({ error: expect.any(String) as unknown });
}

describe('Level 4 — cursor history on real PostgreSQL', () => {
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
    await authenticated(app).post('/reset').send({ slots: [] }).expect(200);
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });
  async function seed(
    count: number,
    who = email,
    prefix = 'ada',
    cancelled = false,
  ) {
    await pool.query(
      `insert into slots (id,provider,starts_at,ends_at)
      select $2 || '-slot-' || i, 'Dr Ade', '2099-01-01T09:00:00Z'::timestamptz, '2099-01-01T09:30:00Z'::timestamptz
      from generate_series(1,$1::int) i`,
      [count, prefix],
    );
    await pool.query(
      `insert into bookings (id,slot_id,patient_name,patient_email,status,created_at,cancelled_at)
      select $3 || '-booking-' || lpad(i::text,3,'0'), $3 || '-slot-' || i, 'Ada Obi', $2,
      case when $4::boolean and i % 2 = 0 then 'cancelled' else 'confirmed' end,
      '2030-01-01T00:00:00Z'::timestamptz + i * interval '1 second',
      case when $4::boolean and i % 2 = 0 then clock_timestamp() else null end
      from generate_series(1,$1::int) i`,
      [count, who, prefix, cancelled],
    );
  }
  async function page(
    query: Record<string, unknown>,
    target = app,
  ): Promise<Page> {
    const result = await authenticated(target)
      .get('/bookings')
      .query(query)
      .expect(200);
    expect(Object.keys(result.body as Page).sort()).toEqual([
      'bookings',
      'next_cursor',
    ]);
    const body = result.body as Page;
    body.bookings.forEach((b) =>
      expect(Object.keys(b).sort()).toEqual([
        'created_at',
        'email',
        'id',
        'name',
        'slot_id',
        'status',
      ]),
    );
    return body;
  }
  async function traverse(limit: number) {
    const result: Booking[] = [];
    let cursor: string | null = null;
    let visits = 0;
    do {
      const current = await page({
        email,
        limit,
        ...(cursor ? { cursor } : {}),
      });
      result.push(...current.bookings);
      cursor = current.next_cursor;
      if (++visits > 100) throw new Error('History cursor did not advance');
    } while (cursor);
    return result;
  }
  it.each([undefined, '', '   '])(
    'requires a nonblank email (case %#)',
    async (value) => {
      error(
        await authenticated(app)
          .get('/bookings')
          .query(value === undefined ? {} : { email: value })
          .expect(400),
      );
    },
  );
  it('rejects repeated email parameters rather than coercing them', async () => {
    error(
      await authenticated(app)
        .get('/bookings')
        .query({ email: [email, 'other@example.com'] })
        .expect(400),
    );
  });
  it('returns the exact empty-history envelope', async () => {
    expect(await page({ email })).toEqual({ bookings: [], next_cursor: null });
  });
  it('does not invent a GET email-syntax restriction', async () => {
    expect(await page({ email: 'not-an-email' })).toEqual({
      bookings: [],
      next_cursor: null,
    });
  });
  it('defaults to ten and returns a null final-page cursor', async () => {
    await seed(13);
    const first = await page({ email });
    expect(first.bookings).toHaveLength(10);
    expect(typeof first.next_cursor).toBe('string');
    const last = await page({ email, cursor: first.next_cursor });
    expect(last.bookings).toHaveLength(3);
    expect(last.next_cursor).toBeNull();
    expect(
      new Set([...first.bookings, ...last.bookings].map((b) => b.id)).size,
    ).toBe(13);
  });
  it.each([1, 50])('accepts the inclusive valid limit %i', async (limit) => {
    await seed(51);
    const first = await page({ email, limit });
    expect(first.bookings).toHaveLength(limit);
    expect(first.next_cursor).not.toBeNull();
  });
  it.each([
    '0',
    '-1',
    '51',
    '1.5',
    '1.0',
    'abc',
    '',
    '1e1',
    'NaN',
    'Infinity',
    ' 1',
    '999999999999999999999',
  ])('rejects invalid limit %s', async (limit) => {
    error(
      await authenticated(app)
        .get('/bookings')
        .query({ email, limit })
        .expect(400),
    );
  });
  it('rejects repeated limit parameters', async () => {
    error(
      await authenticated(app)
        .get('/bookings')
        .query({ email, limit: ['1', '2'] })
        .expect(400),
    );
  });
  it('traverses an unchanged dataset in order without duplicates or skips', async () => {
    await seed(23);
    const all = await traverse(4);
    const expected = await pool.query<{ id: string }>(
      'select id from bookings where patient_email=$1 order by created_at,id',
      [email],
    );
    expect(all.map((b) => b.id)).toEqual(expected.rows.map((b) => b.id));
    expect(new Set(all.map((b) => b.id)).size).toBe(23);
  });
  it('matches case-insensitively and excludes another email', async () => {
    await seed(3);
    await seed(2, 'other@example.com', 'other');
    const lower = await page({ email });
    const upper = await page({ email: ' ADA@EXAMPLE.COM ' });
    expect(upper).toEqual(lower);
    expect(upper.bookings).toHaveLength(3);
  });
  it('includes confirmed and cancelled records without internal audit fields', async () => {
    await seed(4, email, 'ada', true);
    const history = await page({ email });
    expect(history.bookings.map((b) => b.status)).toEqual([
      'confirmed',
      'cancelled',
      'confirmed',
      'cancelled',
    ]);
    const id = history.bookings[0].id;
    await authenticated(app)
      .delete('/bookings/' + id)
      .expect(200);
    expect((await page({ email })).bookings[0].status).toBe('cancelled');
  });
  it('orders equal timestamps with the stable booking ID tie-breaker', async () => {
    await seed(7);
    await pool.query(
      "update bookings set created_at='2030-01-01T00:00:00.123456Z'::timestamptz",
    );
    const all = await traverse(2);
    expect(all.map((b) => b.id)).toEqual(
      Array.from(
        { length: 7 },
        (_unused, i) => 'ada-booking-' + String(i + 1).padStart(3, '0'),
      ),
    );
  });
  it('preserves microsecond positions even when visible timestamps share one millisecond', async () => {
    await seed(3);
    await pool.query(`update bookings set created_at = case id
      when 'ada-booking-001' then '2030-01-01T00:00:00.000003Z'::timestamptz
      when 'ada-booking-002' then '2030-01-01T00:00:00.000001Z'::timestamptz
      else '2030-01-01T00:00:00.000002Z'::timestamptz end`);
    expect((await traverse(1)).map((b) => b.id)).toEqual([
      'ada-booking-002',
      'ada-booking-003',
      'ada-booking-001',
    ]);
  });
  it.each(['not-a-cursor', '', 'a.b', '...', 'e30=.abc', '@@@@'])(
    'rejects malformed cursor %s',
    async (cursor) => {
      error(
        await authenticated(app)
          .get('/bookings')
          .query({ email, cursor })
          .expect(400),
      );
    },
  );
  it('rejects repeated cursors', async () => {
    error(
      await authenticated(app)
        .get('/bookings')
        .query({ email, cursor: ['a', 'b'] })
        .expect(400),
    );
  });
  it('rejects a cursor belonging to a different email', async () => {
    await seed(2);
    const first = await page({ email, limit: 1 });
    error(
      await authenticated(app)
        .get('/bookings')
        .query({ email: 'other@example.com', cursor: first.next_cursor })
        .expect(400),
    );
  });
  it('rejects tampering with either cursor payload or signature', async () => {
    await seed(2);
    const first = await page({ email, limit: 1 });
    const [payload, signature] = first.next_cursor!.split('.');
    for (const cursor of [
      payload + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1),
      payload.slice(0, -1) + 'A.' + signature,
    ]) {
      error(
        await authenticated(app)
          .get('/bookings')
          .query({ email, cursor })
          .expect(400),
      );
    }
  });
  it('binds the cursor to canonical email but permits case changes and page-size changes', async () => {
    await seed(4);
    const first = await page({ email, limit: 1 });
    const last = await page({
      email: 'ADA@EXAMPLE.COM',
      limit: 50,
      cursor: first.next_cursor,
    });
    expect(last.bookings).toHaveLength(3);
    expect(last.next_cursor).toBeNull();
  });
  it('supports a continuation generated by another Nest instance', async () => {
    await seed(4);
    const first = await page({ email, limit: 2 });
    const second = await makeApp();
    await second.listen(0, '127.0.0.1');
    try {
      const next = await page(
        { email, limit: 2, cursor: first.next_cursor },
        second,
      );
      expect(next.bookings.map((b) => b.id)).toEqual([
        'ada-booking-003',
        'ada-booking-004',
      ]);
      expect(next.next_cursor).toBeNull();
    } finally {
      await second.close();
    }
  });
  it('does not need the cursor row to remain present', async () => {
    await seed(3);
    const first = await page({ email, limit: 1 });
    await pool.query('delete from bookings where id=$1', [
      first.bookings[0].id,
    ]);
    const next = await page({ email, limit: 2, cursor: first.next_cursor });
    expect(next.bookings.map((b) => b.id)).toEqual([
      'ada-booking-002',
      'ada-booking-003',
    ]);
    expect(next.next_cursor).toBeNull();
  });
  it.each([
    ['impossible calendar date', '2030-02-31T00:00:00.000000Z', 'id'],
    ['invalid PostgreSQL text ID', '2030-01-01T00:00:00.000000Z', 'bad\0id'],
  ])(
    'rejects a signed cursor with %s before querying PostgreSQL',
    async (_label, time, id) => {
      const cursor = app.get(BookingCursor).encode(email, time, id);
      error(
        await authenticated(app)
          .get('/bookings')
          .query({ email, cursor })
          .expect(400),
      );
    },
  );

  it('authenticates before missing email or malformed cursor validation', async () => {
    const response = await request(app.getHttpServer())
      .get('/bookings')
      .query({ cursor: 'bad' })
      .expect(401);
    expect(response.body).toEqual({ error: expect.any(String) as unknown });
  });
});
