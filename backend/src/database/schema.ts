import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const slots = pgTable(
  'slots',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    start: timestamp('starts_at', { withTimezone: true }).notNull(),
    end: timestamp('ends_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('slots_start_id_idx').on(table.start, table.id),
    index('slots_provider_start_id_idx').on(
      table.provider,
      table.start,
      table.id,
    ),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: text('id').primaryKey(),
    slot_id: text('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'restrict' }),
    name: text('patient_name').notNull(),
    email: text('patient_email').notNull(),
    status: text('status', { enum: ['confirmed', 'cancelled'] })
      .notNull()
      .default('confirmed'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('bookings_one_confirmed_per_slot_idx')
      .on(table.slot_id)
      .where(sql`${table.status} = 'confirmed'`),
    index('bookings_email_created_id_idx').on(
      table.email,
      table.created_at,
      table.id,
    ),
    index('bookings_slot_id_idx').on(table.slot_id),
    check(
      'bookings_status_check',
      sql`${table.status} in ('confirmed', 'cancelled')`,
    ),
    check(
      'bookings_cancellation_check',
      sql`(${table.status} = 'confirmed' and ${table.cancelled_at} is null)
        or (${table.status} = 'cancelled' and ${table.cancelled_at} is not null)`,
    ),
    check(
      'bookings_email_normalized_check',
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

// Durable idempotency state; rate-limit request handling remains deferred.
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    client_scope: text('client_scope').notNull(),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    request_hash: text('request_hash').notNull(),
    response_status: smallint('response_status').notNull(),
    response_body: jsonb('response_body').notNull(),
    response_headers: jsonb('response_headers').notNull().default({}),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.client_scope, table.operation, table.key] }),
    check(
      'idempotency_hash_check',
      sql`${table.request_hash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'idempotency_status_check',
      sql`${table.response_status} between 100 and 599`,
    ),
    check(
      'idempotency_headers_check',
      sql`jsonb_typeof(${table.response_headers}) = 'object'`,
    ),
  ],
);

export const bookingAttempts = pgTable(
  'booking_attempts',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    email: text('email').notNull(),
    attempted_at: timestamp('attempted_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('booking_attempts_email_time_id_idx').on(
      table.email,
      table.attempted_at,
      table.id,
    ),
    index('booking_attempts_time_idx').on(table.attempted_at),
  ],
);
