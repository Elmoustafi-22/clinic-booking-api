# Backend architecture — Level 1

Updated 6 November 2026. Backend foundation and Level 1 are implemented; Levels 2–5 and the Next.js proxy are not implemented. Actual verification results are recorded in TESTING.md. API.md separates the official contract from owner-approved policies and current runtime coverage.

## Authority and approved stack

Official Koya OpenAPI > official PDF > PRD > architecture > implementation. The complete official contract was reviewed before implementation; official files remain unchanged. See API.md for provenance and exact fields/statuses.

Approved stack: NestJS/TypeScript, PostgreSQL/Drizzle, Next.js with server-side API proxy, database partial unique confirmed-slot index, database-backed idempotency and PostgreSQL-backed rate limiting. PRD now records Next.js; no functional requirements were changed.

## Implemented components

- AppController exposes only POST /reset, GET /slots, POST /bookings and GET /bookings/:id, delegating to ResetService, SlotsService and BookingsService. The scaffold GET / and Hello World service/tests were removed. GET /bookings/ in the task list is interpreted as the official Level 1 ID lookup, not the Level 4 history route.
- DatabaseModule provides DatabaseService: a typed Drizzle instance over a node-postgres pool, startup connection check, UTC sessions and graceful pool shutdown. DATABASE_URL is mandatory. Runtime does not mutate schema automatically; db:migrate is a separate command.
- ResetService validates the entire supplied inventory, then replaces all four fixture tables in one transaction. It returns 200 with {}. Duplicate IDs or invalid payloads return 400 without changing any state. It accepts past slots, empty arrays, arbitrary string IDs and additional properties without adding an interval-duration rule.
- SlotsService uses one correlated NOT EXISTS query to compute available from confirmed bookings. Listing includes all slots, ordered by start then ID for deterministic ties. Optional provider equality is case-sensitive and untrimmed, using query parameters rather than string-built SQL.
- BookingsService creates a generated UUID string, stores a confirmed booking and returns exactly id, slot_id, name, email, status and created_at. Stored names/emails are trimmed and emails lowercased to satisfy project persistence rules. Minimal object/string checks protect database writes; Level 2's full required/nonempty/email/past-slot validation is deferred. Missing slots and booking IDs return JSON 404.
- ApiErrorFilter preserves the common {error: string} shape, including routing/parser errors. Unexpected infrastructure exceptions return generic 500 JSON without database details, credentials or sensitive request contents.

## Level 1 transaction boundaries

Reset takes an exclusive transaction advisory lock (namespace 410401), deletes idempotency records, rate attempts, bookings and slots, inserts validated inventory in batches, then commits before returning {}. A database failure during insertion rolls back all deletions. Batches avoid PostgreSQL's parameter limit; the HTTP body limit remains Nest/Express's existing default.

Booking takes the shared mode of the reset lock, checks that the slot exists, inserts the booking in a transaction and commits before returning 201. This prevents reset from deleting a slot between the check and insert. Reads use a single database statement/snapshot. No application availability flag or in-memory database exists.

The initial migration has a partial UNIQUE index on bookings(slot_id) WHERE status = 'confirmed'. It prevents two confirmed rows at database level now. Slot row locking, deliberate duplicate-to-409 mapping, cancellation and concurrent-request acceptance tests are Level 3 work. Until then a duplicate insert produces generic 500, with the database invariant intact; this is a known staged-implementation limitation, not full contract compliance.

READ COMMITTED plus explicit database constraints/locks is the approved simple design. No Redis, queue, account/provider-management subsystem or generic repository layer is required.

## Approved implementation policies — future levels unless noted

These resolve unspecified Koya behaviour; they are owner decisions, not additions to the official source.

| Policy | Approved behaviour | Implementation state |
| --- | --- | --- |
| Reset | 200 {}; invalid payload/duplicate IDs 400 with no mutation; atomically clear all four tables before replacement | Implemented and integration-tested. |
| Idempotency precedence | Resolve matching replay or changed-body 422 before rate admission | Deferred to Levels 4–5. |
| Body equivalence | Canonical parsed JSON, ordered object keys, preserve submitted string values | Deferred to Level 4; do not normalize before hashing. |
| Idempotency retention | Keep until reset; retain successes and deterministic domain errors; exclude transient infrastructure failures and 429 | Schema/reset lifecycle implemented; response caching deferred. |
| Rate window | PostgreSQL rolling 60 seconds; count admitted attempts including failed validation/business attempts when a usable email bucket exists | Schema only; Level 5 service deferred. |
| Denied/missing-email attempts | 429 attempts do not extend the window; missing/unusable email gets ordinary validation error and no shared bucket | Deferred to Levels 2/5. |
| History errors | Missing email or malformed/foreign cursor returns 400 | Deferred to Level 4. |
| Started and occupied slot | Return started-slot 400 before checking occupancy | Deferred to Levels 2/3. |
| Cancelled history/cancellation | Include cancelled bookings; allow cancellation after start | Deferred to Levels 3/4. |

## Future idempotency and limiter orchestration

Acquire transaction-scoped advisory locks on a stable internal client/operation/key identity before checking its database record; composite primary key is the backstop. Fingerprint canonical parsed JSON with SHA-256, preserving strings and all submitted fields. Compare the full scoped identity, not the lock hash. Matching records return the stored response/status/booking ID; differing bodies return 422. These paths bypass admission and consume no additional rate event.

For a new key (or no key), run the independently committed limiter admission before remaining field/business validation, after extracting a usable normalized-email bucket. Serialize each email with a transaction lock; read database wall clock after waiting, count admitted events newer than now minus 60 seconds, and insert an event only if fewer than five exist. Otherwise return 429 without inserting/caching it. Retry-After is max(1, ceil(seconds until the oldest admitted event in the current window expires)). Business failure/rollback must not refund the committed admission. Do not let a generic global validation pipe bypass counting failures with usable emails.

For future orchestration, keep the outer booking transaction's shared reset lock and optional key lock held while a separate pooled connection commits the short limiter transaction, then finish the booking/result transaction. An identical in-flight retry therefore waits for the result before deciding admission. The inner limiter transaction must not reacquire reset coordination when the outer transaction already holds it: a queued exclusive reset could otherwise block the inner connection while waiting for the outer one. This requires at least two available pool connections and bounded admission concurrency to prevent pool starvation. It is a proposed future implementation detail to verify, not code present in Level 1. Never use session locks on pooled connections or release a key lock before admission and assume a second lookup alone prevents extra quota consumption.

Atomically persist successful booking and its original response, and use savepoints when caching a deterministic error after a failed SQL statement. No persisted pending state is needed for the booking/result transaction itself. Crash before commit rolls back both; commit followed by lost response is recovered with the same key. A replay after cancellation returns the creation snapshot, not newly fetched cancelled state. Uncertain commits must be resolved by the original key. Records have no expiry before reset.

## Future concurrency, cancellation and history

Level 2 checks the slot against database wall clock at the write decision. Level 3 slot row locking repeats that check after waiting before checking confirmed occupancy. Missing slot 404, started 400, occupied 409; only the named unique index maps to a slot conflict. Preserve the database invariant independently of application prechecks.

Cancellation uses a conditional confirmed-to-cancelled UPDATE and internal cancelled_at, returning the six-field Booking; missing 404, repeated 409. It preserves ID/email/created_at and frees the slot; a new booking creates a new record. No past-start restriction.

History includes both statuses, case-insensitive normalized-email filter, immutable (created_at, id) ascending, limit default 10/range 1–50. Proposed opaque cursor carries the exact timestamp/ID tuple and email context; malformed/foreign cursors or missing email return 400. Fetch limit + 1 and emit next_cursor or null. Preserve database timestamp precision. This is a live listing, not a frozen snapshot; concurrent commits can fall behind an already traversed cursor.

Reset must coordinate all future mutation transactions with its exclusive/shared protocol. Holding outer reset coordination across admission and booking prevents reset from intervening between those steps; the independently committed attempt still survives a business rollback. If that orchestration is changed later, explicitly handle reset between transactions rather than replaying obsolete responses. Independent rate/business commits do not become one atomic database transaction.

## Frontend and deployment boundary

Next.js server-side proxy will add X-API-Key; browser code must never receive it. Do not add backend response fields for UI convenience or allow arbitrary upstream proxy requests. The frontend is untouched in this task. Docker PostgreSQL is configured locally; Render/Neon/Vercel hosting remains planned, not deployed.

Per explicit Level 1 scope there is no API-key guard yet. The running server is not assessment-ready for Level 2 or ready for external deployment. Level 2 authentication and validation require a separate requested task.

## Verification and remaining work

Real PostgreSQL integration tests cover all Level 1 routes, exact shapes/statuses, availability, provider filtering, reset rejection/preservation, four-table clearing, injected database-failure rollback and persistence across requests/application restart. Only index installation is checked now; higher-level concurrency is deferred as requested. TESTING.md records failures encountered and final actual results.

Next authorized boundary: stop after Level 1 build/tests and documentation. On a later explicit request, implement Level 2 and pass Levels 1–2 before Level 3. Continue with Level 3 cancellation/concurrency, Level 4 idempotency/history, Level 5 limiter, then frontend/deployment; each level must pass before the next. No higher level is marked verified here.
