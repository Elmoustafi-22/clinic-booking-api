# Architecture

Updated 9 November 2026. Backend Levels 1–5 and the Next.js frontend are implemented and locally verified; hosted deployment remains unverified. The [API contract](API.md) separates official Koya requirements from approved implementation policies.

## Components

| Component                               | Responsibility                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| AppController                           | Exposes exactly the six required Nest operations and delegates HTTP input/status handling to services.   |
| ApiKeyGuard / ApiKeyMiddleware          | Validates the private startup credential and authenticates before JSON parsing and validation.           |
| ResetService                            | Validates the complete replacement inventory, then atomically clears all four tables and installs slots. |
| SlotsService                            | Exact provider filtering, start/ID ordering and availability derived from confirmed bookings.            |
| BookingsService / BookingValidationPipe | Validation, normalization, booking insertion, lookup and conditional cancellation.                       |
| IdempotencyService                      | Canonical request identity, key synchronization, replay and atomic response snapshots.                   |
| BookingHistoryService / BookingCursor   | Email-based seek pagination and signed full-precision cursors.                                           |
| BookingRateLimitService                 | Independently committed PostgreSQL admission events and whole-second Retry-After.                        |
| DatabaseModule / DatabaseClock          | Drizzle pools, UTC sessions, database clock expressions, initialization and shutdown.                    |
| Next.js BFF                             | Fixed patient-operation proxy with server-only credentials and sanitized upstream errors.                |

Controllers remain thin. No extra Nest root, health, Swagger UI or version-prefix route exists. No process-local state is a booking or rate-limit correctness guarantee.

## Authentication and errors

Nest disables its default body parser so middleware can authenticate before JSON/urlencoded parsing. A global guard enforces the same key check. Missing, empty, incorrect or repeated X-API-Key headers return 401 with exactly {error: string}. API_KEY is validated at initialization and compared using fixed-size digests.

Shared input checks reject NUL before PostgreSQL text binding, including lookup, cancellation and provider filtering. Valid identifiers retain exact case/whitespace/punctuation; no UUID restriction is added. ApiErrorFilter sanitizes unexpected exceptions. Both pools use fixed-message idle-error logging; no credentials or exception objects are logged by those handlers.

## Booking and cancellation

Booking uses READ COMMITTED transactions:

1. Acquire shared reset coordination.
2. Commit email admission independently.
3. Validate the body; trim name/email, validate email and store it lowercase. Preserve slot_id exactly.
4. Lock the slot FOR UPDATE; absence is 404.
5. In a separate statement after the lock wait, compare starts_at to the PostgreSQL wall clock. A started/equal-now slot is 400.
6. Check confirmed occupancy, insert and commit. Occupancy is 409.

The partial unique index on slot_id WHERE status='confirmed' independently prevents double-booking. Only SQLSTATE 23505 for table bookings and the named bookings_one_confirmed_per_slot_idx becomes 409; unrelated integrity failures remain sanitized infrastructure errors.

Cancellation acquires shared reset protection, reads immutable slot_id without a booking lock, locks that slot, then updates only the matching confirmed booking. Status/cancelled_at change; ID, patient fields and creation time remain. Missing ID is 404; no conditional-update result is 409. Concurrent cancellations have one winner. Cancellation after start is allowed. Rebooking inserts a new ID; cancelled records are retained.

## Idempotency

Keys are scoped to the stable internal namespace clinic-api and POST /bookings, not to patient email or the current API secret. Header identity and canonical parsed JSON are SHA-256 hashed separately. Canonicalization recursively sorts object keys while retaining array order, types, submitted strings and unknown properties. No arbitrary key-length restriction is introduced.

Keyed processing acquires shared reset protection, then a transaction-scoped key lock and reads the stored result under READ COMMITTED. Matching bodies replay the original status/JSON; mismatches return 422 before admission.

New keys commit admission first, then run validation/booking in a nested transaction (savepoint). Deterministic 400/404/409 errors roll back the savepoint before their snapshots are stored. Successful booking and response snapshot commit in the same outer transaction. Response-store failure therefore cannot leave a committed successful booking without its result. Infrastructure failures and 429 are not cached; admission remains counted after later failure.

Records persist until reset. Replay returns the original response even after cancellation; lookup returns current state. JSON values/status are replayed, not byte-exact HTTP framing or transport Date headers. There is no pending lease or background worker.

## Lock order and reset

| Operation         | Order                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| New keyed booking | Shared reset → key → independent email admission → savepoint/validation → slot → booking/result |
| Unkeyed booking   | Shared reset → independent admission → validation → slot → booking                              |
| Cancellation      | Shared reset → slot → booking                                                                   |
| Reset             | Exclusive reset → clear results/attempts/bookings/slots → install inventory                     |

Reset uses one-bigint transaction advisory key 410401. Key synchronization uses two-integer namespace 410402; email admission uses 410403. Short digest collisions can serialize unrelated identities but do not change full-digest record identity.

Admission never reacquires its parent's reset/key protection: a queued exclusive reset could otherwise deadlock parent and child. No operation acquires key/reset protection after row locks. Locks release on commit/rollback; no session locks are held across pooled transactions.

## Rolling admission

Any nonblank string email defines a trimmed/lowercase hashed bucket, even if its syntax is invalid. Missing/blank/non-string values create no shared bucket. PostgreSQL time is sampled after acquiring the email lock. At most five admissions fall in (now - 60 seconds, now]; failed validation/business attempts count.

The sixth returns 429 and a positive whole-second ceiling until the oldest active admission expires. Denials do not extend the window. Replay/mismatch takes precedence. Admission uses a separate max-4 pool while parent transactions retain primary clients; the primary pool defaults to 10. Budget 14 connections per replica plus operational headroom.

Admission errors fail closed. Events remain until reset; expired events are ignored, not automatically removed. Timeouts and hosted sizing are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

## Cursor pagination

History normalizes its required email for matching, includes both statuses and orders by (created_at, id). One statement seeks strictly beyond the decoded tuple and fetches limit + 1; default limit is 10, range 1–50.

Cursors contain version, email context, full PostgreSQL microsecond UTC timestamp and ID, with a domain-separated HMAC-SHA-256 signature derived from API_KEY. Validate encoding/signature/context/date/ID before SQL. Cursor timestamps never round-trip through JavaScript Date; public timestamp serialization remains compatible.

All replicas need the same API_KEY. Rotation invalidates old cursors. Tokens are signed, not encrypted; pagination is a live listing rather than a frozen snapshot. A boundary row need not still exist. Restart traversal after reset.

## Patient frontend and BFF

Pages are /, /book?slot_id=, /find-booking and /history. Query-based slot selection preserves literal dot-segment IDs. Client state remains feature-local; appointment details are joined from slots without adding Booking fields.

Only GET /api/slots, GET/POST /api/bookings and GET/DELETE /api/bookings/[id] are exposed. The server-only helper injects API_KEY, allows known queries, encodes IDs, refuses redirects and arbitrary targets, and does not forward caller cookies/credentials. There is no reset proxy. Mutations reject foreign Origin/cross-site metadata using the public Host.

Responses are no-store. Domain JSON/status and positive integer Retry-After are preserved; internal errors are sanitized. The upstream deadline is 15 seconds. UI intent keys survive unchanged retries in the current page, rotate after edits and are lost on reload/navigation. No mutation is retried automatically.

Responsive controls, visible focus, skip navigation, reduced motion and a Radix cancellation dialog support usability. They do not constitute formal accessibility certification. The application key is integration authentication, not patient identity verification.

## Verification and operating limits

See [TESTING.md](TESTING.md) for executed results and [DATABASE.md](DATABASE.md) for schema/index details. Tests cover real concurrent HTTP requests, multiple independent Nest instances, rollback faults and restart persistence. Finite tests do not establish hosted load/failover guarantees.

Startup checks database connectivity before listening; migrations run separately. Pools close on shutdown and handle idle disconnects. Hosted TLS, readiness monitoring, backups, logs, retention policy and patient-data access remain release considerations in [DEPLOYMENT.md](DEPLOYMENT.md).
