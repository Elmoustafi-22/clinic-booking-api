# PostgreSQL / Drizzle database design — specification reconciled

Design only, reviewed 6 November 2026. No schema declarations, migrations or database changes have been implemented. API.md contains the complete authoritative contract; ARCHITECTURE.md describes transaction flows and unresolved behaviour. PostgreSQL/Drizzle, the confirmed-slot partial unique index, and database-backed limiter/idempotency are owner-approved. Other details below are proposed implementation choices unless explicitly marked as specification requirements.

## Changes from the initial proposal

- **Specification correction:** slots.id and bookings.slot_id must be text, accepting caller-supplied identifiers such as s1. Slot IDs are not generated/validated as UUIDs.
- **Specification correction:** persist both start and end, mapped from required API Slot.start/Slot.end.
- **Response mapping fixed:** internal patient_name/patient_email map to name/email. Booking exposes only id, slot_id, name, email, status, created_at. cancelled_at is internal. Slot exposes id, provider, start, end; listing derives available.
- **Unwarranted constraints removed:** no provider/start unique key, nonblank provider/slot-ID rule, future-only reset rule or end-after-start check is imposed by the specification. Empty reset arrays and past slots are accepted. Invalid/duplicate-slot policy requires clarification before adopting extra checks/statuses.

## Modelling and time

Four proposed tables: slots, bookings, idempotency_records and booking_attempts. No patient/provider accounts, provider-management table or separate availability flag is needed. Booking patient details are immutable snapshots except for the cancellation state transition.

Use PostgreSQL timestamptz for instants, with UTC application/session output; source date-time fields accept instants rather than an exact Z/fractional-second spelling. Do not use timestamp without time zone or depend on the host's local timezone. Preserve exact created_at precision in cursors (or choose and consistently enforce a supported precision); JavaScript Date millisecond conversion must not truncate a microsecond cursor boundary.

Generated booking IDs may be UUID strings as an implementation choice. Store them as text so route matching accepts any string and returns missing-booking 404 without a UUID cast error or invented UUID-only validation. Slot IDs are preserved exactly, not trimmed or lowercased. Do not normalize provider names for exact-match queries.

## Table definitions and Drizzle mapping

### slots

| Column | PostgreSQL type | Constraint / role |
| --- | --- | --- |
| id | text | Primary key; caller-supplied API id. |
| provider | text | NOT NULL; API provider. No added nonblank or uniqueness rule. |
| starts_at | timestamptz | NOT NULL; API start. Past instants accepted on reset. |
| ends_at | timestamptz | NOT NULL; API end. No end-after-start CHECK until input policy is settled. |

Map using Drizzle pgTable, text, timestamp with withTimezone: true, primaryKey and indexes. A relational primary key requires unique slot IDs, but the official reset contract does not say whether duplicate input IDs should be rejected or consolidated, or with which status. Validate an agreed duplicate policy before destructive reset; never expose an unhandled constraint exception as official behaviour.

### bookings

| Column | PostgreSQL type | Constraint / role |
| --- | --- | --- |
| id | text | Primary key; generated unique booking ID, proposed UUID string. |
| slot_id | text | NOT NULL FK to slots.id, ON DELETE RESTRICT. |
| patient_name | text | NOT NULL, trimmed/nonblank CHECK; API name. |
| patient_email | text | NOT NULL, trimmed/lowercase/nonblank CHECK; API email. |
| status | text | NOT NULL, default confirmed; CHECK in ('confirmed', 'cancelled'). |
| created_at | timestamptz | NOT NULL, database default; immutable API created_at and pagination order. |
| cancelled_at | timestamptz | Nullable internal audit timestamp; not an API field. |

Use Drizzle references, check, index and uniqueIndex with a SQL predicate. Text plus CHECK is simpler than a PostgreSQL enum migration for these two statuses. Full valid-email checking belongs in input validation, not a speculative SQL email regex. Keep trim/lowercase rules compatible across TypeScript and database collation, especially for non-ASCII input; the official source defines no email grammar. No unique email or unique (email, slot_id) rule: a person can have multiple bookings, and cancellation permits a new booking of that slot.

### idempotency_records

| Column | PostgreSQL type | Constraint / role |
| --- | --- | --- |
| client_scope | text | NOT NULL stable internal namespace, never the API-key secret. |
| operation | text | NOT NULL; POST /bookings namespace. |
| key | text | NOT NULL; header identity. Empty-key/size policy is not specified. |
| request_hash | text | NOT NULL; proposed SHA-256 hexadecimal digest, CHECK 64 lowercase hex characters. |
| response_status | smallint | NOT NULL; CHECK 100–599; only approved final outcomes stored. |
| response_body | jsonb | NOT NULL; original JSON response snapshot. |
| response_headers | jsonb | NOT NULL default empty object, CHECK object; relevant replay headers only. |
| created_at | timestamptz | NOT NULL database default. |

Composite primary key (client_scope, operation, key). No required booking FK, because a stored error may have no booking and cancellation must not erase the original response. A transaction advisory lock coordinates simultaneous keys; full identity, not the lock hash, determines the matching record. No persisted pending state is proposed.

Fingerprint equivalence (parsed/raw/normalized body), error caching, retention and reset lifecycle remain unresolved. JSONB preserves JSON values rather than byte order; use serialized text if byte-exact replay is later required. The source explicitly requires same response/status/booking ID but does not require identical HTTP serialization bytes. Do not persist credentials, cookies, connection headers or volatile Date headers. Responses contain patient data and must be protected accordingly.

### booking_attempts

| Column | PostgreSQL type | Constraint / role |
| --- | --- | --- |
| id | bigint generated always as identity | Primary key, internal event identity/tie ordering. |
| email | text | NOT NULL, canonical email bucket; compatible normalization CHECK after bucket policy is settled. |
| attempted_at | timestamptz | NOT NULL; database wall clock read after acquiring email transaction lock. |

No booking/slot FK: failed attempts must remain counted even without a booking. No unique email rule: each event is an attempt. Per-email advisory lock, not a SELECT count alone, makes count-and-insert atomic across replicas. Which requests are recorded (including 429, invalid emails and idempotent replays) depends on unresolved API policy. The event-table rolling window is proposed, not an official fixed/rolling-minute mandate. If a fixed window is selected, revise the model before implementing rather than keeping mismatched documentation.

## Constraints and indexes

| Object | Role |
| --- | --- |
| Primary keys on slots, bookings, booking_attempts | Identity and lookup. |
| Idempotency composite primary key | One durable result per scoped key. |
| bookings.slot_id FK to slots.id, RESTRICT | No orphan bookings; reset explicitly deletes bookings first. |
| Partial UNIQUE bookings(slot_id) WHERE status = 'confirmed' | Owner-approved mandatory invariant: no two confirmed bookings per slot; cancelled history allowed. |
| Booking status CHECK | Only confirmed or cancelled. |
| CHECK (status = 'confirmed' AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL) | Coherent internal cancellation state. |
| Booking trimmed/nonblank name and canonical email CHECKs | Reinforce validated booking persistence; no extra wire-level size limits. |
| slots(starts_at, id) | Chronological listing, deterministic proposed tie break. |
| slots(provider, starts_at, id) | Exact provider filter with chronological order. |
| bookings(patient_email, created_at, id) | Case-normalized seek history for both statuses. |
| bookings(slot_id) | Complete slot history and FK operations, including cancelled rows. |
| booking_attempts(email, attempted_at, id) | Proposed rolling-window count and expiry lookup. |
| booking_attempts(attempted_at) | Optional bounded global expired-event cleanup. |

Primary keys already index booking IDs and scoped idempotency keys; do not duplicate those indexes. No database check/index predicate involving current time: slots become past without a row update. The booked-slot invariant is independent of start time. PostgreSQL [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html) documents partial unique indexes and immutable index expressions. Declare the approved partial index through Drizzle and inspect generated migration SQL for its exact confirmed predicate.

## Transaction and lifecycle design

- **Booking:** shared reset lock -> optional idempotency-key transaction lock -> slot FOR UPDATE -> database wall-clock start check -> confirmed insert -> original response record -> commit. A savepoint permits a named uniqueness error to become a stored 409 response without continuing an aborted transaction. Pipeline admission precedence remains unresolved.
- **Cancellation:** shared reset lock -> conditional UPDATE where status = confirmed with cancelled_at -> commit. Keep original id, slot, patient data and created_at; return the six-field Booking with cancelled status. Repeated cancellation 409; missing ID 404.
- **Limiter:** independent short transaction with shared reset lock -> per-email lock -> current clock/count/attempt event -> commit. Business rollback cannot refund the attempt. Do not hold the email lock across booking work or count internal retry loops twice.
- **Reset:** exclusive reset coordination lock -> approved auxiliary-state deletion -> delete bookings -> delete slots -> insert all supplied slots -> commit. Validate the agreed reset policy before deletion. Reset is the explicit exception to cancellation-history preservation. Idempotency/rate-state clearing remains a decision, not a specified side effect.
- **Reads:** one-statement consistent snapshots for slots/availability and history/continuation where possible. Multi-query responses need transaction coordination around reset.
- **Cleanup:** prune only expired attempt events after the selected window plus a safety margin. No idempotency expiry or automatic booking deletion is proposed until lifecycle rules are approved.

Use stable, domain-separated transaction advisory-lock hashes and the same active transaction connection. Hash collisions may serialize independent operations but must not merge identities. Never use pooled session-level locks. Shared/exclusive reset coordination does not make the separate limiter and booking transactions one atomic HTTP request; see ARCHITECTURE.md for the reset-between-transactions boundary.

## Migration and verification plan

After a separately authorized implementation task: add Drizzle declarations and reviewed migrations, driver/tooling and local Docker PostgreSQL configuration. Verify migration SQL and apply to a disposable database first. No manual production schema edits.

Real PostgreSQL checks must cover text fixture IDs/end timestamps, direct duplicate-confirmed insertion failure, cancelled-slot rebooking, FK and status checks, atomic rollback/reset, full-precision pagination and relevant query plans. API tests must verify serialization excludes internal columns and accepts non-UUID path IDs for normal 404 lookup. Exercise concurrent requests on separate connections, failure-count persistence and commit-loss retry recovery. All five levels remain gated by their acceptance tests.

No database, migration, application test or build was run in this documentation task.
