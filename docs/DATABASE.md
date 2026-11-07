# Database — Levels 1–3 transactions and unchanged schema

Updated 7 November 2026. The Drizzle schema is backend/src/database/schema.ts. Initial generated migration: backend/drizzle/0000_stormy_killmonger.sql, with its committed metadata snapshot/journal. It creates four tables and the approved confirmed-slot partial unique index. The migration was applied to local PostgreSQL; actual checks are in TESTING.md. Idempotency/limiter tables are foundations only: no corresponding request processing exists yet.

## Connection, migration and local storage

DatabaseService supplies typed Drizzle/node-postgres with UTC sessions and startup connectivity check; DATABASE_URL is required. The pool closes on Nest shutdown. Connection credentials are environment-only; checked-in .env.example contains placeholders. Existing developer .env was not overwritten.

compose.yaml runs PostgreSQL 18 bound to 127.0.0.1:5433 by default, with a named volume mounted at /var/lib/postgresql (PostgreSQL 18 layout). It requires POSTGRES_PASSWORD and exposes optional POSTGRES_PORT. The local test run used generated, ignored backend/.env.level1-local credentials and a dedicated clinic_booking_test database, separate from clinic_booking.

Run db:generate to generate reviewed migration files, then db:migrate to apply them. Migration commands run from backend; runtime startup never creates tables. Drizzle's migration journal lives in drizzle.__drizzle_migrations. Test startup applies the same migration twice to check repeatability. No manual production schema edits or push-based schema synchronization.

## Implemented tables

### slots

| Column | PostgreSQL type | Actual constraint / public mapping |
| --- | --- | --- |
| id | text | Primary key; supplied Slot.id, including s1. |
| provider | text | NOT NULL; Slot.provider, exact-case comparison. |
| starts_at | timestamptz | NOT NULL; Slot.start. |
| ends_at | timestamptz | NOT NULL; Slot.end. |

No future-only, nonblank-provider, provider/start uniqueness or end-after-start constraint is added. Reset rejects duplicate IDs and malformed object/string/date-time fields with 400 before destructive writes; past slots and empty inventories are valid. Unknown properties are ignored. PostgreSQL cannot store a NUL character in text, so basic string validation rejects it with 400 rather than a database exception.

Drizzle maps start/end to Date values and the API serializes UTC ISO timestamps at JavaScript millisecond precision. PostgreSQL stores instants in timestamptz. Level 4 cursor construction must preserve database created_at precision rather than truncate it through Date; history is not implemented yet.

### bookings

| Column | PostgreSQL type | Actual constraint / public mapping |
| --- | --- | --- |
| id | text | Primary key; crypto.randomUUID() string generated per creation. |
| slot_id | text | NOT NULL FK to slots.id, ON DELETE RESTRICT; Booking.slot_id. |
| patient_name | text | NOT NULL; Booking.name; currently trimmed by service. |
| patient_email | text | NOT NULL; CHECK equal to lower(btrim(value)); Booking.email. |
| status | text | NOT NULL, default confirmed; CHECK confirmed/cancelled. |
| created_at | timestamptz | NOT NULL, default now(); Booking.created_at. |
| cancelled_at | timestamptz | Nullable internal audit field; excluded from API. |

Cancellation consistency CHECK: confirmed implies NULL cancelled_at; cancelled implies non-NULL cancelled_at. New bookings create confirmed records; Level 3 cancellation atomically changes status/cancelled_at without deleting or reactivating a record. No patient/email uniqueness or separate patient/provider account tables exist. Level 2 DTO validation now rejects missing/non-string/blank values and invalid emails before writes; normalized name/email storage remains unchanged. Started-slot rejection uses the PostgreSQL wall clock after shared reset-lock acquisition. No schema migration was needed: time-based eligibility is a request decision rather than a persistent CHECK, and the existing types, email normalization check and partial unique index remain intact. Arbitrary path strings return missing-booking 404, not UUID-cast errors.

### idempotency_records — schema only

| Column | PostgreSQL type | Constraint / purpose |
| --- | --- | --- |
| client_scope | text | NOT NULL; stable internal namespace, not an API secret. |
| operation | text | NOT NULL; operation scope. |
| key | text | NOT NULL; header identity. |
| request_hash | text | NOT NULL; CHECK 64 lowercase hexadecimal characters. |
| response_status | smallint | NOT NULL; CHECK 100–599. |
| response_body | jsonb | NOT NULL; original response values. |
| response_headers | jsonb | NOT NULL, default {}; CHECK JSON object. |
| created_at | timestamptz | NOT NULL, default now(). |

Composite primary key (client_scope, operation, key). No booking FK, pending lease or expiry. Approved future policy: canonical parsed JSON preserves submitted strings; same-key replay/mismatch precedes rate admission; retain success and deterministic domain-error responses until reset, excluding transient infrastructure failures and 429. Reset already deletes these records atomically. The current booking handler does not inspect or populate this table.

### booking_attempts — schema only

| Column | PostgreSQL type | Constraint / purpose |
| --- | --- | --- |
| id | bigint generated always as identity | Primary key; internal event/tie identity. |
| email | text | NOT NULL; future normalized bucket. |
| attempted_at | timestamptz | NOT NULL; future database clock instant after email lock. |

No slot/booking FK: failed business attempts must survive without a booking. Approved future rolling 60-second policy counts admitted attempts, including failed validation/business attempts when a usable bucket exists. Denied 429 requests insert no event; missing/unusable email creates no shared bucket. Idempotency replay/422 precedes admission. No limiter records are written by current HTTP handlers; reset clears them.

## Actual indexes

| Index | Role |
| --- | --- |
| Primary keys, including scoped idempotency composite key | Unique identity and lookup. |
| bookings_one_confirmed_per_slot_idx: UNIQUE slot_id WHERE status = 'confirmed' | Database protection against duplicate confirmed bookings from the initial migration. |
| slots_start_id_idx (starts_at, id) | Chronological inventory. |
| slots_provider_start_id_idx (provider, starts_at, id) | Exact provider filtering plus ordering. |
| bookings_email_created_id_idx (patient_email, created_at, id) | Future history seek pagination for both statuses. |
| bookings_slot_id_idx (slot_id) | Complete slot history and FK access, including cancelled records. |
| booking_attempts_email_time_id_idx (email, attempted_at, id) | Future rolling count/oldest-admitted-event expiry. |
| booking_attempts_time_idx (attempted_at) | Future expired-event cleanup. |

No additional indexes duplicate primary keys. No stored available flag, clock-dependent index predicate or CHECK involving now(). The existing unique partial index was inspected in pg_index: indisunique=true, indisvalid=true and predicate (status = 'confirmed'::text), with slot_id as its B-tree key. It was not recreated. Level 3 directly verifies rejection of a duplicate confirmed insert and acceptance of multiple cancelled rows, plus controlled 409 handling and simultaneous HTTP requests.

## Current transactions and lifecycle

- Reset: exclusive transaction advisory lock 410401 -> delete idempotency_records -> booking_attempts -> bookings -> slots -> insert validated replacement inventory in 1000-row batches -> commit. Failure rolls back all four-table deletions and insertions. No sequence restart is required; attempts are internal IDs only.
- Booking: shared reset lock -> slot FOR UPDATE (404 if absent) -> separate database-wall-clock eligibility statement (400 if started) -> confirmed occupancy check (409) -> insert -> commit. The index is the final independent guarantee; matching index errors are converted to 409 outside the rolled-back transaction.
- Reads: single-statement snapshots; availability is a correlated NOT EXISTS confirmed booking, not a cached value.
- Cancellation: shared reset lock -> read immutable booking.slot_id without a booking lock (404 if absent) -> same slot FOR UPDATE -> UPDATE booking WHERE id matches AND status = confirmed -> set cancelled status/internal timestamp and RETURNING the six public fields -> commit. No returned row means 409. Original fields/created_at remain unchanged. Reset remains the approved destructive exception.

Later levels add idempotency/key and email transaction locks, response caching and rolling-window admission with separate commits for attempts. Follow ARCHITECTURE.md for approved policies and orchestration constraints. Never use session locks on pooled connections, manual production schema changes or an in-memory correctness fallback.

## Verification boundary

The integration suite uses actual Docker PostgreSQL 18.6, applies the committed migration, verifies index installation, and tests atomic reset rollback/state preservation plus request/restart persistence. It fails rather than skips if TEST_DATABASE_URL is absent/unusable and requires an explicit database name ending _test. Tests replace fixture data in that database; never point them at development or production inventory. Level 3 concurrency, cancellation, database-error fallback and lock-wait tests now run on the actual database. Idempotency and limiter acceptance tests remain deferred.

Level 2 left schema.ts and all migration files unchanged. DatabaseClock exposes only a PostgreSQL clock expression for start-time validation and a deterministic boundary-test seam, not a new database function/table. Full Level 1–3 results are in TESTING.md.

Level 3 also leaves schema.ts, all migration SQL and migration metadata unchanged. Booking/cancellation explicitly select READ COMMITTED with the same reset -> slot -> booking lock order, so only a single slot is locked per mutation and the time/occupancy statements see committed state after waiting. FK and status/cancellation CHECKs remain active. Cancelled records can accumulate per slot and rebooking always inserts a new ID. Actual unique errors are recognized only by SQLSTATE 23505 plus the confirmed-slot index/table identity; unrelated integrity errors are not business conflicts.

Fault-injection triggers and explicit lock-holding clients exist only in the integration suite's dedicated test database and are cleaned up in finally. They are not migrations, runtime database functions, application session locks or production schema changes.
