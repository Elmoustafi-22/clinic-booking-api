# Backend architecture — Levels 1–3

Updated 7 November 2026. Backend foundation and Levels 1–3 are implemented; Levels 4–5 and the Next.js proxy are not implemented. Actual verification results are recorded in TESTING.md. API.md separates the official contract from owner-approved policies and current runtime coverage.

## Authority and approved stack

Official Koya OpenAPI > official PDF > PRD > architecture > implementation. The complete official contract was reviewed before implementation; official files remain unchanged. See API.md for provenance and exact fields/statuses.

Approved stack: NestJS/TypeScript, PostgreSQL/Drizzle, Next.js with server-side API proxy, database partial unique confirmed-slot index, database-backed idempotency and PostgreSQL-backed rate limiting. PRD now records Next.js; no functional requirements were changed.

## Implemented components

- AppController exposes only POST /reset, GET /slots, POST /bookings and GET /bookings/:id and DELETE /bookings/:id, delegating to ResetService, SlotsService and BookingsService. The scaffold GET / and Hello World service/tests were removed. GET /bookings/ in the task list is interpreted as the official Level 1 ID lookup, not the Level 4 history route.
- DatabaseModule provides DatabaseService: a typed Drizzle instance over a node-postgres pool, startup connection check, UTC sessions and graceful pool shutdown. DATABASE_URL is mandatory. Runtime does not mutate schema automatically; db:migrate is a separate command.
- ResetService validates the entire supplied inventory, then replaces all four fixture tables in one transaction. It returns 200 with {}. Duplicate IDs or invalid payloads return 400 without changing any state. It accepts past slots, empty arrays, arbitrary string IDs and additional properties without adding an interval-duration rule.
- SlotsService uses one correlated NOT EXISTS query to compute available from confirmed bookings. Listing includes all slots, ordered by start then ID for deterministic ties. Optional provider equality is case-sensitive and untrimmed, using query parameters rather than string-built SQL.
- BookingsService creates a generated UUID string, stores a confirmed booking and returns exactly id, slot_id, name, email, status and created_at. Stored names/emails are trimmed and emails lowercased to satisfy project persistence rules. CreateBookingDto and BookingValidationPipe enforce required nonblank strings, trim name/email before email validation, and preserve slot_id exactly. The service stores lowercase email and checks start against PostgreSQL wall clock before insertion. No arbitrary name-length or UUID rule is introduced. Missing slots and booking IDs return JSON 404.
- ApiErrorFilter preserves the common {error: string} shape, including routing/parser errors. Unexpected infrastructure exceptions return generic 500 JSON without database details, credentials or sensitive request contents.

## Current transaction boundaries

Reset takes an exclusive transaction advisory lock (namespace 410401), deletes idempotency records, rate attempts, bookings and slots, inserts validated inventory in batches, then commits before returning {}. A database failure during insertion rolls back all deletions. Batches avoid PostgreSQL's parameter limit; the HTTP body limit remains Nest/Express's existing default.

Booking takes the shared reset lock, locks the target slot row FOR UPDATE, checks database time in a separate statement after lock acquisition, checks for an existing confirmed booking and inserts a new confirmed record. It commits before returning 201; missing slot is 404, started slot 400 and occupied slot 409. This prevents reset from deleting a slot between the check and insert. Reads use a single database statement/snapshot. No application availability flag or in-memory database exists.

The initial migration has a partial UNIQUE index on bookings(slot_id) WHERE status = 'confirmed'. Its installed definition was verified valid and unique before implementation and left unchanged. Slot row locking coordinates booking/cancellation, while the index independently prohibits duplicate confirmed rows. The exact expected uniqueness violation maps to 409 after rollback; unrelated database errors retain generic 500 handling.

Both mutation transactions explicitly select READ COMMITTED; fresh statement snapshots plus explicit database constraints/locks provide the approved simple design. No Redis, queue, account/provider-management subsystem or generic repository layer is required.

## Approved implementation policies — future levels unless noted

These resolve unspecified Koya behaviour; they are owner decisions, not additions to the official source.

| Policy | Approved behaviour | Implementation state |
| --- | --- | --- |
| Reset | 200 {}; invalid payload/duplicate IDs 400 with no mutation; atomically clear all four tables before replacement | Implemented and integration-tested. |
| Idempotency precedence | Resolve matching replay or changed-body 422 before rate admission | Deferred to Levels 4–5. |
| Body equivalence | Canonical parsed JSON, ordered object keys, preserve submitted string values | Deferred to Level 4; do not normalize before hashing. |
| Idempotency retention | Keep until reset; retain successes and deterministic domain errors; exclude transient infrastructure failures and 429 | Schema/reset lifecycle implemented; response caching deferred. |
| Rate window | PostgreSQL rolling 60 seconds; count admitted attempts including failed validation/business attempts when a usable email bucket exists | Schema only; Level 5 service deferred. |
| Denied/missing-email attempts | 429 attempts do not extend the window; missing/unusable email gets ordinary validation error and no shared bucket | Validation implemented; Level 5 admission deferred. |
| History errors | Missing email or malformed/foreign cursor returns 400 | Deferred to Level 4. |
| Started and occupied slot | Return started-slot 400 before checking occupancy | Implemented under the slot lock. |
| Cancelled history/cancellation | Include cancelled bookings; allow cancellation after start | Cancellation/individual lookup implemented; Level 4 history deferred. |

## Future idempotency and limiter orchestration

Acquire transaction-scoped advisory locks on a stable internal client/operation/key identity before checking its database record; composite primary key is the backstop. Fingerprint canonical parsed JSON with SHA-256, preserving strings and all submitted fields. Compare the full scoped identity, not the lock hash. Matching records return the stored response/status/booking ID; differing bodies return 422. These paths bypass admission and consume no additional rate event.

For a new key (or no key), run the independently committed limiter admission before remaining field/business validation, after extracting a usable normalized-email bucket. Serialize each email with a transaction lock; read database wall clock after waiting, count admitted events newer than now minus 60 seconds, and insert an event only if fewer than five exist. Otherwise return 429 without inserting/caching it. Retry-After is max(1, ceil(seconds until the oldest admitted event in the current window expires)). Business failure/rollback must not refund the committed admission. Do not let a generic global validation pipe bypass counting failures with usable emails.

For future orchestration, keep the outer booking transaction's shared reset lock and optional key lock held while a separate pooled connection commits the short limiter transaction, then finish the booking/result transaction. An identical in-flight retry therefore waits for the result before deciding admission. The inner limiter transaction must not reacquire reset coordination when the outer transaction already holds it: a queued exclusive reset could otherwise block the inner connection while waiting for the outer one. This requires at least two available pool connections and bounded admission concurrency to prevent pool starvation. It is a proposed future implementation detail to verify, not code present in Levels 1–3. Never use session locks on pooled connections or release a key lock before admission and assume a second lookup alone prevents extra quota consumption.

Atomically persist successful booking and its original response, and use savepoints when caching a deterministic error after a failed SQL statement. No persisted pending state is needed for the booking/result transaction itself. Crash before commit rolls back both; commit followed by lost response is recovered with the same key. A replay after cancellation returns the creation snapshot, not newly fetched cancelled state. Uncertain commits must be resolved by the original key. Records have no expiry before reset.

## Implemented concurrency/cancellation and future history

Level 3 acquires the slot row lock before evaluating database wall clock in a separate statement. This prevents a time expression evaluated before lock acquisition from admitting a slot that starts during the wait. Occupancy is checked only after start eligibility. Missing slot 404, started 400, occupied 409; only the named unique index maps to a slot conflict. Preserve the database invariant independently of application prechecks.

Cancellation uses a conditional confirmed-to-cancelled UPDATE and internal cancelled_at, returning the six-field Booking; missing 404, repeated 409. It preserves ID/email/created_at and frees the slot; a new booking creates a new record. No past-start restriction.

History includes both statuses, case-insensitive normalized-email filter, immutable (created_at, id) ascending, limit default 10/range 1–50. Proposed opaque cursor carries the exact timestamp/ID tuple and email context; malformed/foreign cursors or missing email return 400. Fetch limit + 1 and emit next_cursor or null. Preserve database timestamp precision. This is a live listing, not a frozen snapshot; concurrent commits can fall behind an already traversed cursor.

Reset must coordinate all future mutation transactions with its exclusive/shared protocol. Holding outer reset coordination across admission and booking prevents reset from intervening between those steps; the independently committed attempt still survives a business rollback. If that orchestration is changed later, explicitly handle reset between transactions rather than replaying obsolete responses. Independent rate/business commits do not become one atomic database transaction.

## Frontend and deployment boundary

Next.js server-side proxy will add X-API-Key; browser code must never receive it. Do not add backend response fields for UI convenience or allow arbitrary upstream proxy requests. The frontend is untouched in this task. Docker PostgreSQL is configured locally; Render/Neon/Vercel hosting remains planned, not deployed.

Level 2 API-key authentication and booking validation are implemented. API_KEY is read only on the server and validated before startup can succeed; missing/blank, surrounding whitespace and control characters are configuration errors. The configured value is never logged or returned. Levels 4–5 and hosted deployment remain unimplemented.

## Verification and remaining work

Real PostgreSQL integration tests cover all Level 1 routes, exact shapes/statuses, availability, provider filtering, reset rejection/preservation, four-table clearing, injected database-failure rollback and persistence across requests/application restart. Level 3 additionally tests direct constraint enforcement, simultaneous requests across independent pools, cancellation/rebooking races, transaction rollback, narrow database-error handling and real lock-wait time boundaries. TESTING.md records failures encountered and final actual results.

Current authorization ends after Level 3 build/tests and documentation. Stop here; Level 4 requires an explicit later request. Remaining work is Level 4 idempotency/history, Level 5 limiter, then frontend/deployment; each level must pass before the next. No higher level is marked verified here.

## Level 2 request pipeline and time boundary

ApiKeyGuard is registered globally through APP_GUARD with useExisting so the guard and middleware share one configured instance. It stores a SHA-256 digest and compares equal-length digests with timingSafeEqual; no raw key value is logged or returned. Header names follow HTTP case-insensitivity; repeated key headers are rejected. Key rotation requires application restart.

Nest guards execute before pipes but after the default body parser. main.ts and the integration factory therefore disable automatic parsers with bodyParser: false. AppModule registers ApiKeyMiddleware before Express JSON/urlencoded parsing, using the guard's exact check for the six official method/path combinations. The history path is also authenticated before its Level 4 handler exists: a correct key reaches routing 404. Cancellation now uses its official Level 3 handler. No stub controller, additional endpoint or history behaviour was introduced. Future application factories must preserve this parser ordering.

The booking-only pipe uses class-transformer/plainToInstance and class-validator, without implicit type coercion, arbitrary length limits or forbidden-extra-property rules. Trim transformations apply only to name/email and only when their submitted values are strings. slot_id is tested for a non-whitespace character but is never trimmed/lowercased. Validation errors are descriptive strings in the existing Error envelope, without target objects or submitted values. The original parsed request object is not mutated; future idempotency must fingerprint it before transformations, and Level 5 orchestration must admit bucketable failures before invoking full DTO validation. No limiter/idempotency is added now.

DatabaseClock supplies the SQL clock_timestamp() expression, evaluated in PostgreSQL after shared reset-lock acquisition. The slot projection computes starts_at <= clock_timestamp() at database precision; equality is rejected. An injectable SQL-expression seam permits deterministic exact-boundary tests without mocking database reads or inserts. Level 3 reuses this clock provider after acquiring the slot lock; no schema or migration change was necessary.

## Level 3 lock order, rollback and deadlock review

Both mutation paths acquire locks in the same order: shared transaction advisory reset lock -> target slot FOR UPDATE -> booking inspection/insert or conditional booking update. Cancellation first reads only immutable slot_id without locking the booking row; the shared reset lock excludes deletion/replacement while this reference is used. It must not lock a booking before its slot. The atomic UPDATE uses id AND status = confirmed and sets only status/cancelled_at; zero returned rows means already cancelled (409), since a missing ID was resolved under reset coordination first. There is no start restriction on cancellation.

Reset acquires its exclusive reset lock before any table write, so it waits for mutation transactions to finish and cannot form a slot/reset lock-order cycle. Each application transaction locks at most one slot, and unrelated slots proceed independently. All row/advisory locks are transaction scoped; there is no session lock, process mutex or in-memory correctness state. Commit/rollback releases them before the service promise resolves. Cancellation and booking serialize on the slot, so race outcomes follow actual lock acquisition rather than an assumed request arrival order.

The unique-index fallback unwraps one DrizzleQueryError and requires a real pg.DatabaseError with SQLSTATE 23505, table bookings and constraint bookings_one_confirmed_per_slot_idx. Catching occurs outside the awaited transaction after Drizzle rolls it back. Primary-key, foreign-key, CHECK and unrelated failures are rethrown to the existing sanitized 500 filter; no query continues inside an aborted transaction. Level 4 may need savepoints to retain deterministic errors, but no response caching was added here.

Review and integration tests found no lock-order cycle in the implemented booking/cancel/reset paths. External SQL clients can still hold locks or introduce a different order; production lock/statement timeouts and handling of infrastructure deadlocks remain deployment policy, not an invented 409 response or an unbounded application retry. The database invariant remains protected even if a transaction fails. See TESTING.md for finite concurrency evidence and its limits.
