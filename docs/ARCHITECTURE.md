# Architecture — official-contract review, design only

Reviewed 6 November 2026. No application features, schema code or migrations are implemented by this task. This revision supersedes the initial PRD-only proposal. Full wire contracts and source fingerprints are in API.md.

## Authority and approved decisions

Source priority: official [Koya OpenAPI](https://koyaacademy.com/assessment-api/openapi.json) > local nine-page PDF > PRD > this design > implementation. Both official sources have now been read completely. Their operation behaviour agrees; the PDF's generic DELETE example is misleading, not a cancellation rule. See API.md for exact schema omissions and material gaps.

**Owner-approved technology decisions:** NestJS/TypeScript; PostgreSQL/Drizzle; Next.js with server-side API proxy; PostgreSQL partial unique index for confirmed bookings; PostgreSQL-backed rate limiting; database-backed idempotency. These technologies are implementation decisions, not requirements imposed by the OpenAPI specification. Detailed algorithms below remain proposed where the specification is silent.

## Endpoint and level mapping

All six operations require X-API-Key; missing/wrong keys return 401 with `{"error":"<message>"}`. All error responses use that envelope. No backend route prefix or additional public route is authorized.

| Level | Operation | Definitive contract |
| --- | --- | --- |
| 1 | POST /reset | Required {slots: Slot[]}; supplied IDs and start/end date-times; replace inventory and delete every booking, accepting past slots. 200; success body unspecified. |
| 1 | GET /slots | {slots: SlotWithAvailability[]}, earliest start first; exact optional provider filter; include every slot. 200. |
| 1–5 | POST /bookings | Required slot_id/name/email; trim name/email, lowercase stored email. Direct Booking on 201; 400 missing/empty/invalid fields or started slot; 404 missing slot; 409 occupied slot; optional idempotency key with 422 mismatch; 429 on sixth per-email attempt with integer Retry-After. |
| 1 | GET /bookings/{id} | Direct Booking on 200; missing ID 404. |
| 3 | DELETE /bookings/{id} | Direct cancelled Booking on 200; missing ID 404; already cancelled 409. Free slot and preserve record. |
| 4 | GET /bookings | Required email, case-insensitive match; oldest first; limit default 10, integer 1–50, invalid limit 400; optional cursor; {bookings: Booking[], next_cursor: string or null}, null on last page. 200. |

Slot fields are id/provider/start/end. SlotWithAvailability adds available. Booking fields are id/slot_id/name/email/status/created_at. No nested slot or internal cancellation timestamp is part of Booking. IDs are strings: reset must accept `s1`; generated booking IDs may be UUID strings but path inputs must not be rejected merely for not being UUIDs.

## Components and boundaries

- Thin NestJS controllers perform HTTP mapping and delegate to SlotsService, BookingsService and ResetService. DTO validation and a common error mapper preserve exact Koya envelopes/statuses; do not expose NestJS default error bodies.
- DatabaseModule provides a PostgreSQL pool and Drizzle transaction access. Reviewed, committed migrations own schema changes. No process-local state supplies correctness guarantees.
- API-key guard runs before protected handlers. Keep the server secret in environment configuration, fail startup if absent, compare safely and never log it.
- IdempotencyService serializes keys and persists original response snapshots; RateLimitService serializes normalized email buckets and persists attempts. PostgreSQL supports shared state across API replicas without Redis or a queue.
- Derive slot availability with a NOT EXISTS confirmed-booking query in the listing SQL. No independently mutable booked flag. A past unbooked slot can still be available by this definition; POST separately rejects started slots.
- Next.js server-side proxy adds the key; browser code never receives it. Only intended patient operations are forwarded, not arbitrary upstream requests or reset. Booking confirmation UI can combine Booking.slot_id with slot inventory; do not add embedded appointment fields to backend responses for UI convenience.

READ COMMITTED transactions, explicit locks, atomic writes and constraints are sufficient for the proposed design. Docker PostgreSQL locally and Render/Neon/Vercel hosting remain PRD deployment choices, not OpenAPI mandates. Hosting is not changed or performed in this task.

## Reconciliation with PRD and earlier proposal

| Topic | PRD / earlier proposal | Official answer / resolution |
| --- | --- | --- |
| Frontend | PRD says Vite; AGENTS.md/scaffold say Next.js | OpenAPI is stack-agnostic. Owner now explicitly approves Next.js with server-side proxy; this resolves the design conflict. PRD's Vite entry remains stale; no PRD edit was requested. |
| Reset fixture | PRD says replace slots; prior design requested a seed contract | Caller supplies {slots: Slot[]}; no fixed seed. Past slots and empty arrays are permitted. |
| Slot IDs and end times | Earlier proposal used UUID slot IDs and deferred end times | Arbitrary string IDs required, including s1; end is mandatory. DATABASE.md now uses text slot IDs and stores both instants. |
| Availability | PRD describes UI indicators but omits exact JSON | GET /slots returns available boolean on every slot; false for a confirmed booking. |
| Booking JSON/statuses | PRD omits shapes and several codes | Direct six-field Booking; API.md fixes exact bodies/statuses. Creation 201, validation/started 400, occupied 409. |
| Cancellation | PRD omits success/missing status/body | 200 cancelled Booking; 404 missing; 409 repeated. No past-cancellation restriction or deletion. Generated confirmed example does not override operation semantics. |
| Pagination | PRD says cursors without parameter/envelope | Query cursor, response next_cursor, null on last page; required email; invalid limit 400. |
| Errors | PRD asks for meaningful errors | Exact error property containing a string; example message text is not mandatory. |
| Authentication, concurrency, idempotency, limiting | PRD describes all five levels | Substantively aligned. Official prose still leaves idempotency/limiter interactions unresolved. |
| Persistence, migrations, UI and HTTPS | PRD/AGENTS.md requirements | Additional project requirements; not contradicted by OpenAPI and not claimed to originate there. |

No PRD requirement was silently rewritten. Follow the official API contract where the PRD is incomplete; follow the owner's approved Next.js choice where its technology table is stale. The PRD's implementation-ready label does not eliminate the ambiguities documented below.

## Concurrent booking and cancellation

**Approved database invariant:** partial UNIQUE index on bookings(slot_id) WHERE status = 'confirmed'. It permits many cancelled records and prevents two confirmed bookings even if an application availability check is bypassed. See PostgreSQL [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html).

Proposed booking transaction, after admission under the as-yet-unresolved limiter/replay policy:

1. Acquire shared reset coordination lock, then transaction-scoped idempotency-key lock if supplied.
2. Resolve an existing key: replay its response or return 422 on a changed body.
3. Lock the target slot with FOR UPDATE; return 404 if missing. Check start against database wall clock after waiting; start at/before that instant returns 400. This comparison is made at the booking write decision, not HTTP response delivery.
4. Insert the confirmed booking; the named partial unique constraint is the final conflict arbiter. Return 409 for that constraint only, not for every integrity error.
5. Persist the response snapshot with the booking and commit before sending 201. Use a savepoint around a potentially failing statement if its resulting error must be stored in the outer transaction.

Two requests for one slot serialize on its row; the second cannot commit another confirmed booking. READ COMMITTED's fresh statement view plus the unique index handles a concurrent cancellation. Cancellation uses a conditional UPDATE where status is confirmed, setting cancelled status/time and returning the Booking. No row updated means distinguish 404 from 409. Two cancellations cannot both succeed. Rebooking inserts a new record, never reactivates a cancelled one. No past-slot cancellation restriction is introduced.

400 versus 409 for a slot that is both started and occupied is not ordered by the specification. The step order above is a proposal, not an official precedence guarantee.

## Database-backed idempotency

**Specification:** same key/body returns the same response/status/booking ID; different body with same key returns 422. No second booking.

**Proposed mechanism:** scope by stable internal client namespace and POST /bookings, never by storing the API secret. Transaction advisory lock derived from that identity serializes in-flight requests; a composite primary key enforces record uniqueness. Lock hashes may collide and serialize unrelated keys, but full stored identity always determines equality. Use transaction locks on the same pool connection, not session-level locks.

A deterministic SHA-256 fingerprint of parsed JSON, with object keys sorted and submitted string values preserved, is proposed. JSON formatting/key order would be ignored, but name/email case or whitespace changes would count as changed bodies. Store normalized booking values separately. Raw-byte versus parsed versus normalized equivalence is not defined by the source and remains a correctness decision. Unknown fields must not be silently removed before hashing if they are part of body identity; OpenAPI does not forbid them.

Store HTTP status, JSON response and only relevant replay headers in the same transaction as the booking. An identical retry after cancellation returns the original creation snapshot, not a fresh cancelled response. No committed pending record or lease is needed. Crash before commit rolls back both records; lost response after commit is recovered by retry. Uncertain commits must be resolved with the same key against a fresh connection, not another key and a blind insert.

Propose retaining successful responses and deterministic domain-error responses; transient database errors roll back. Which validation/429 failures are cached, key length/scope, and retention/reset semantics are not specified. No expiry is proposed until its effect on safe retries is agreed. No precise failure-cache policy is approved by the technology choice alone.

## PostgreSQL-backed rate limiting

**Specification:** five POST /bookings attempts per email per minute; failures count; sixth gets 429 and whole-second Retry-After; independent emails.

**Proposed mechanism:** rolling 60-second window, normalized-email event table, per-email transaction advisory lock. In a short transaction acquire shared reset lock then email lock, read database wall clock after waiting, count recent attempts, append the event and decide admission atomically. Run the limiter transaction separately from the booking transaction so 400/404/409 business failures and rollbacks do not erase consumed quota. A generic validation pipe must not reject a valid-email request with another invalid field before its attempt is counted.

Fixed versus rolling windows, denied-attempt counting and invalid/missing-email buckets are not settled by OpenAPI. If all bucketable attempts including 429 count, deny when at least five earlier events are in the last 60 seconds, and compute Retry-After from expiry of the fifth most recent event including the current one, rounded up to whole seconds (minimum 1). Continued attempts can prolong blocking. If 429 attempts do not count, record/count admitted events and use the oldest of the five. Neither policy is represented as a specification requirement.

Missing/invalid email and malformed JSON cannot be assigned a valid normalized-email bucket. Proposed handling is normal auth/validation failure without a fabricated global bucket; this needs clarification under “failed attempts.” Normalize emails consistently; do not share unrelated email buckets. Fail closed on limiter storage failure rather than falling back to process-local permission. Infrastructure error statuses/messages require an implementation policy, always with the Error envelope.

**Unresolved pipeline conflict:** limiter-first can return 429 instead of the required original idempotency response or 422; replay-first can exempt repeated requests from the five-attempt rule. Do not implement a definitive precedence from the source's silence. The prior design's limiter-first sequence is now explicitly withheld pending resolution. Tests must encode the agreed combined behaviour, not merely test features separately.

## Pagination, reset and lock protocol

**Proposed pagination:** immutable (created_at, id) ascending; opaque cursor containing the full-precision tuple and associated normalized email; seek with strict tuple >; fetch limit + 1, return limit with next_cursor or null. No lookup dependency on the cursor row surviving. Cancellation does not change ordering fields. Return both statuses. Do not add UUID-only route validation, silently clamp invalid limits, or return a numeric offset cursor as if mandated by OpenAPI. Malformed/foreign/stale cursor errors and required-email error codes remain unspecified.

Timestamp tie-breaking and opaque encoding are implementation decisions. A live listing is proposed, not a snapshot: concurrent inserts/commits can appear later or fall behind an already traversed cursor; a composite tuple alone does not promise snapshot completeness across requests. Exact snapshot semantics are not required by the source.

**Proposed reset:** validate the submitted dataset before destructive writes; transactionally delete bookings, replace slots and clear only the approved auxiliary state. No future-only check, automatic seed, slot-duration assumption or provider/start uniqueness rule. Duplicate-ID/error policy remains open. Shared reset advisory lock on mutation/limiter transactions; exclusive reset lock around reset serializes destructive fixture replacement. Reads use one SQL statement/snapshot; multi-query responses require suitable shared reset coordination.

Lock order: reset coordination -> optional idempotency identity -> slot row. Limiter email locks occur in their own transaction after shared reset coordination and are released before business work. Use bounded lock/transaction timeouts and bounded deadlock retries; never count one server-side business transaction retry as a new HTTP attempt. Reset can occur between limiter admission and booking; the booking then evaluates the new inventory. If reset clears attempt state, its limiter event can disappear at that boundary. Whole-request atomicity across the two transactions is not promised.

## Failure cases and verification plan

| Scenario | Protection / required acceptance evidence |
| --- | --- |
| Many distinct requests for one slot | One confirmed booking and 409 losers; direct SQL duplicate insert fails partial index. Test below rate ceiling/with independent emails so limiter does not mask this. |
| Cancel/rebook, repeated cancellation | Conditional update, unique index, retained history; exactly one concurrent cancellation succeeds. |
| Simultaneous matching/changed idempotency bodies | Key lock and unique record; one execution, identical response or 422 according to approved precedence. |
| Commit succeeds, HTTP response lost | Booking and original response survive together; retry returns original ID. |
| PostgreSQL statement failure | Savepoint or transaction rollback, never further queries in an aborted transaction. |
| Six parallel attempts including invalid booking fields/missing or occupied slots | At most five admitted; failures persist in limiter; independent emails unaffected. |
| Retry meets rate limit, multiple errors apply | Explicit combined tests after precedence is resolved. |
| Time advances while locks wait | Database wall clock after wait; test start and 60-second boundaries. |
| Reset during booking/replay/cancellation | Atomic replacement and approved auxiliary-state policy; no orphan booking or partial inventory. |
| Pagination ties and cancellation | Full-precision cursor; no duplicate traversal of stable rows, null final cursor, both statuses. |
| Restart / multiple API replicas / database outage | Shared durable state, no false success or in-memory limiter bypass. |
| Contract examples versus runtime | Exact fields/envelopes/statuses, arbitrary slot IDs, reset past slots/empty array; cancelled DELETE response. |
| Browser and logs | No API key or sensitive bodies leaked; server-only proxy. |

## Implementation order — no implementation authorized yet

1. Resolve material API.md ambiguities and adopt explicit policies for unspecified inputs. Approved stack choices do not settle these behaviours.
2. On a separate requested task, establish NestJS/Drizzle/PostgreSQL configuration and initial migrations with the confirmed-slot invariant, then Level 1 reset/list/create/lookup and contract tests. Pass Level 1 before advancing.
3. Level 2 API-key guard, exact Error mapping, normalization and validation; pass earlier-level regressions and Level 2 tests before proceeding. No external exposure before authentication.
4. Level 3 concurrency and cancellation with real PostgreSQL concurrent tests; pass Levels 1–3.
5. Level 4 durable idempotency and cursor history, including simultaneous/replayed/cancelled cases; pass Levels 1–4.
6. Level 5 limiter with agreed ordering; verify failed attempts, independent emails, window boundaries and combined retry cases; pass all levels.
7. Next.js patient flows/server-side proxy, integration tests, then HTTPS deployment/persistence checks in separately requested tasks. Update affected docs and record actual results with each implementation task.

Material decisions still pending are catalogued in API.md. No test suite, build, migration, server or database has been run in this documentation review.
