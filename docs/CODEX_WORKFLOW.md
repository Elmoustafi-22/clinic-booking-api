# Work log

## 7 November 2026 — Level 5 PostgreSQL rolling rate limiting

Status: **255/255 PostgreSQL integration tests passed, 6 suites**, including all 213 unchanged Level 1–4 cases and 42 new Level 5 cases. Jest reported 123.126 seconds. Production build, ESLint, formatting and Git whitespace checks passed. Stop after Level 5; no frontend, deployment or new public route was started.

### Preparation and decisions

Read root AGENTS.md, owner attachment, relevant API/architecture/database/testing documentation and the complete official OpenAPI source. Inspected booking/key/reset transactions and existing attempts/index schema. Preserved the already pending Level 4 documentation edits. Official PDF, migration SQL/metadata and package/lock files remain unchanged. No migration or dependency was necessary; schema.ts has a lifecycle-comment change only.

BookingRateLimitService uses the existing booking_attempts table. Its email column stores SHA-256 of trim/lowercase string identity, including invalid nonblank string emails, rather than arbitrary raw invalid text. Missing/blank/non-string email values create no shared bucket. PostgreSQL clock_timestamp after the per-email transaction advisory lock is authoritative, preserving full precision. Within READ COMMITTED, count (now-60 seconds, now], insert one event only below five, and commit independently before full DTO/slot work. Denial returns 429 error-only JSON plus positive ceil Retry-After, with no event mutation, booking write or result cache.

Parent lock order is shared reset -> optional idempotency key -> independent email admission -> validation/savepoint -> slot -> booking/result commit. Admission has only its email lock (two-integer namespace 410403); it never reacquires reset/key/slot or requests a primary connection. Shared reset stays held by the parent across the separate event commit. Thus reset cannot erase an event between admission and booking; queued reset cannot form a parent/child reset-lock cycle. Existing confirmed-slot partial unique index and cancellation protocol remain intact.

A separate max-4 admission pool avoids primary pool exhaustion from parents borrowing another client from their own pool. Primary max remains default 10; budget up to 14 connections per replica. Both pools have a bounded 30-second connection wait; admission has 15-second lock and 20-second statement timeouts. Admission/commit failures fail closed with sanitized 500. A later booking or response-write rollback cannot undo its committed attempt. No process-local counter/mutex, extra database function, background worker or retry fallback was added.

Replay and mismatch lookup occur before admission; new key ownership remains held across the admission commit, so simultaneous matching retries charge once. Admission is outside the cacheable-domain-error handler: 429 and infrastructure failures are uncached, while booking/result persistence retains existing atomicity. New unfingerprintable parsed JSON with usable email consumes admission then returns uncached 400; a changed existing-key body still returns 422 first. Authentication/parser errors remain earlier. Expected named slot-index mapping is scoped to booking INSERT, avoiding unrelated limiter failures being mislabeled 409.

### Actual results and problems

Final complete run: 255 passed / 0 failed / 6 suites in 123.126 seconds. Suite counts: 32 Level 1, 84 Level 2, 27 Level 3, 28 idempotency, 42 pagination and 42 rate limiting. No earlier test file was changed. New coverage includes 24 simultaneous requests in one/two apps with exactly five successful admissions, 20 keyed cross-instance retries charging once, error counting, clock/expiry precision, denied immutability, independent emails, booking/result/admission/deferred-commit/clock failure, failed-budget exhaustion and reset rollback/lock coordination. TESTING.md records commands and limitations.

Initial new-suite verification found one burst 500 (38/39); a targeted rerun passed but complete testing reproduced both bursts (250/252). Longer bounded connection/lock waits resolved the observed burst failures. The 39-case new suite then passed; three stronger fault/rollback cases were added before the final 255-case passing run. Initial build type inference required explicitly declaring NodePgDatabase on the new service. A Python launcher was unavailable; repository edits used installed Node/PowerShell tooling instead. No secret was printed or existing environment file overwritten.

Production build, ESLint src/test/drizzle.config.ts, Prettier source/test/config checks and Git whitespace checks passed with exit 0. Initial lint flagged a redundant assertion and method-binding issues in optional test diagnostics; removed the redundant spy without changing status/database-state assertions. No dependencies changed/audit rerun; existing findings remain the last measured security baseline.

After the test-diagnostic lint cleanup, both affected 24-request concurrency cases passed again (2/2; 40 unrelated cases skipped), 18.841 seconds. Final direct local ESLint and Prettier checks also exited 0; Git whitespace checks reported no errors for tracked or newly created files.

### Incremental files

Created: backend/src/bookings/booking-rate-limit.service.ts; backend/test/rate-limit.e2e-spec.ts.

Modified: backend/src/app.module.ts (provider), backend/src/bookings/bookings.service.ts (admission before validation, insert-scoped conflict mapping), backend/src/bookings/idempotency.service.ts (replay-first admission), backend/src/common/api-error.filter.ts (Retry-After), backend/src/database/database.service.ts (bounded burst acquisition wait), backend/src/database/schema.ts (comment only). Documentation: docs/API.md, ARCHITECTURE.md, DATABASE.md, TESTING.md, CODEX_WORKFLOW.md, DEPLOYMENT.md and backend/README.md. No files removed.

### Remaining risks and authorization boundary

No unresolved source ambiguity blocks this approved Level 5 policy. Events/results remain until reset and contain patient-related identities/snapshots; access control and retention need operational review. Hashes are identities, not encryption. All replicas require the same PostgreSQL writer and lock namespaces. Connection budgets, external lock holders, conservative ambiguous-commit counting, database-clock administration, hosted load/timeout sizing and primary transaction timeout policy remain deployment concerns. Previous dependency findings were not remediated. Frontend/proxy and deployment require separate authorization; no external assessment result is claimed.

## 7 November 2026 — Level 4 durable idempotency and cursor history

Status: **Levels 1–4 locally verified: 5 PostgreSQL integration suites, 213 passed, 0 failed.** Earlier suites retain 32/84/27 passing cases (143 total); Level 4 adds 28 idempotency and 42 pagination cases. Build, ESLint and formatting checks passed. Stop after Level 4; no Level 5/frontend implementation or external assessor result is claimed.

### Preparation and scope

- Read the attached Level 4 request, AGENTS.md, API/architecture/database/testing documentation, complete previously retrieved official OpenAPI and current controller/services/schema/test infrastructure. Checked Git status: the Level 3 baseline was clean at task start.
- Recorded schema, migration/metadata, dependency and official PDF fingerprints. Reused the existing idempotency table, composite key, history index, confirmed-slot partial unique index, reset coordination, PostgreSQL pool, DTO validation and Level 3 row-locking logic. Reviewed official Drizzle nested-transaction/savepoint and PostgreSQL locking/formatting guidance.

### Implementation decisions and transaction boundaries

- Added IdempotencyService with stable internal clinic-api / POST /bookings scope. Header identity is SHA-256 hex stored in the existing key column; this avoids large B-tree entry limits without introducing a public header-length rule. Request identity is a separate SHA-256 over canonical parsed JSON: recursively sorted object keys, array order/types and submitted strings preserved, including unknown/special own keys. JSON formatting/object order is ignored; storage normalization does not change request equivalence.
- A present empty key is supported because the official string header has no minLength. Malformed/absent JSON and unsupported/non-finite JSON values cannot be fingerprinted and remain uncached errors. No API secret/raw key is persisted in scoped-key identity fields.
- API authentication remains before parsing/idempotency/validation. Moved full keyed DTO processing behind stored-result lookup; no-header requests retain prior validation/creation. Controller delegates and applies the returned original HTTP status with passthrough response handling, without exposing internal wrappers or metadata.
- Keyed READ COMMITTED outer transaction: shared reset advisory lock -> two-integer transaction advisory key in namespace 410402 -> re-read scoped persisted state -> savepoint containing validation and existing slot-lock/start/occupancy/insertion -> store original response status/JSONB snapshot -> commit. Two-integer advisory keys are disjoint from the one-bigint reset keyspace. Lock hashes can serialize unrelated keys but full scoped digest identity determines record equality.
- Same key/fingerprint replays the stored response/booking ID; a changed body returns 422 before revalidation and preserves the original. Booking and successful result commit atomically; failed response storage rolls back the booking too. A nested savepoint rolls back actual SQL failure before deterministic error storage, retaining outer reset/key ownership. Cache 201 plus deterministic DTO/business 400/404/409; do not newly cache parser/auth, mismatch 422, transient/infrastructure failures or future 429. No pending row, expiry job, session lock or memory correctness mutex.
- Records survive restart and cancellation until reset. Replaying after cancellation returns the original confirmed JSON while lookup returns current cancelled state. The existing reset transaction already clears response records with inventory, preventing replay of an old stored record after reset. Error snapshots may legitimately exist without a booking; no new FK is appropriate.
- Added BookingHistoryService and BookingCursor for the existing GET /bookings route. Require nonblank string email, normalize case/outer whitespace without inventing GET email-syntax validation. Default limit 10; integer decimal digits 1–50; invalid/repeated parameters and malformed/foreign cursor return 400. Return both statuses in exactly the bookings/next_cursor envelope and six-field Booking shape.
- History seeks by immutable (created_at, id) ascending, fetches limit+1 and returns a continuation only if another row exists. PostgreSQL emits a separate full-six-digit UTC position string; cursor decoding passes it directly to timestamptz in the tuple predicate without JavaScript Date truncation. Public timestamp serialization is unchanged. Equal timestamps and sub-millisecond ordering are supported without offsets or a lookup of the boundary row.
- Opaque versioned base64url payload/signature includes normalized email, exact timestamp and ID. HMAC-SHA-256 uses a domain-separated key derived from existing server API_KEY; constant-time signature, canonical encoding, version, context, calendar and safe text-ID checks precede SQL. Replicas share verification with the same API_KEY. Tokens are integrity-protected rather than encrypted; key rotation invalidates old tokens while idempotency scope persists independently. Pagination is live, not a frozen snapshot across writes/reset.

### Verification, problems and actual results

- Initial complete run: **210 tests passed** (previous 143 + 27 idempotency + 40 pagination), 5 suites, 61.739 seconds. Initial lint found four unused variables after extracting common booking logic/projection; removed them before the final passing check. No rule suppression or functional-test failure occurred.
- Review addressed the physical index-size concern by storing fixed-size header-key identities and added strict decoded cursor date/text validation. Added a 4000-character random-key test plus two signed malformed-cursor cases. Final npm test -- --json --outputFile <temporary report>: **213 passed / 0 failed / 5 suites, 104.766 seconds**. Report confirms prior suites 32/84/27, idempotency 28 and pagination 42.
- Idempotency cases cover canonical body distinctions/reordering, original status/body/ID, absent/empty/long keys, concurrent identical/mixed bodies, two independent Nest instances/pools, different-key slot competition, cancellation/restart replay, deterministic error retention, transient failure, response-store rollback, actual uniqueness-savepoint recovery, reset clearing and authentication precedence.
- History cases cover email/query validation, default/boundary/invalid limits, empty/final pages, no gaps/duplicates on unchanged data, both statuses, case-insensitive matching, equal timestamps, reversed-ID microsecond positions, malformed/foreign/tampered/signed-invalid tokens, cross-instance continuation and deleted boundary rows.
- All 143 previous cases still pass. The two prior history-absence staging expectations were updated for the newly authorized route: missing email is now 400 (was routing 404), and authenticated valid-email history is 200 (was routing 404). No previous test case or other functional assertion was removed.
- Final production build, ESLint src/test/drizzle.config.ts and Prettier source/test/config checks exited 0. Final Git whitespace checks passed. Tests use actual listening localhost Nest servers, Promise.all HTTP concurrency and Docker PostgreSQL 18.6; no in-memory database or mocked query result. Temporary fault triggers are removed in finally; apps/pools close.
- No dependency installation or audit rerun. Migration artifacts, package manifests/lock and official PDF fingerprints remain unchanged. schema.ts has one lifecycle-comment update only; restoring that comment reproduces its baseline fingerprint, proving SQL definitions did not change. No DDL or new migration was necessary.

### Incremental file inventory

Created:

- backend/src/bookings/idempotency.service.ts
- backend/src/bookings/booking-history.service.ts
- backend/src/bookings/booking-cursor.ts
- backend/test/idempotency.e2e-spec.ts
- backend/test/pagination.e2e-spec.ts

Modified:

- backend/src/bookings/bookings.service.ts — shared transaction-aware insertion, keyed orchestration and service-invoked validation; cancellation preserved.
- backend/src/app.controller.ts and backend/src/app.module.ts — existing history route, optional header/original status mapping and provider wiring.
- backend/src/database/database.service.ts — compile-time transaction type export only.
- backend/src/database/schema.ts and backend/src/auth/api-key.middleware.ts — lifecycle comments only; schema/auth behaviour unchanged.
- backend/test/app.e2e-spec.ts and backend/test/level2.e2e-spec.ts — history staging expectations for the newly implemented route.
- docs/API.md, docs/ARCHITECTURE.md, docs/DATABASE.md, docs/TESTING.md and docs/CODEX_WORKFLOW.md.
- backend/README.md and docs/DEPLOYMENT.md — stage/cursor-key operational documentation.

No files removed. No new public endpoint, DDL/migration, dependency, secret/environment-variable, frontend, PRD or official specification change. Existing developer .env was not overwritten.

### Remaining risks and Level 5 prerequisites

No unresolved issue blocks the local Level 4 acceptance scope. Retention is unbounded until reset by approved policy; response snapshots contain patient data and require database protection. Cursor clients must restart traversal after key rotation/reset; live pagination does not guarantee a snapshot while data changes. External lock holders/production timeouts, hosted load/persistence, external Koya assessment and earlier dependency-audit findings remain separate work.

Level 5 needs independently committed PostgreSQL rolling-60-second admission for usable emails, after matching replay/422 and before full validation/business work. Denied 429 must neither add attempts nor be cached. Preserve outer reset/key ownership across admission without reacquiring reset inside an independently committed connection behind a waiting reset; reserve/bound pool capacity to avoid starvation. Adjust both current keyed and unkeyed validation paths deliberately for admitted-failure counting. No limiter, attempt writes or frontend work was implemented. Await explicit Level 5 authorization.

## 7 November 2026 — Level 3 concurrency safety and cancellation

Status: **Levels 1–3 locally verified: 3 PostgreSQL integration suites, 143 passed, 0 failed.** Level 1: 32/32; Level 2: 84/84; Level 3: 27/27. Production build, ESLint and formatting checks passed. Stop after Level 3; no Level 4/5 implementation or authorization is implied. This entry supersedes earlier Level 2-only status statements below.

### Preparation and baseline

- Read AGENTS.md and reviewed API.md, ARCHITECTURE.md, DATABASE.md, TESTING.md, the complete previously retrieved official Koya OpenAPI JSON, and current services/controller/authentication/test infrastructure. Reviewed PostgreSQL explicit-lock documentation and Drizzle SELECT/query-error interfaces.
- Initial Git status already contained the preceding Level 2 work. Preserved those pending changes; the file inventory below describes this task's incremental edits rather than claiming a clean HEAD baseline.
- Inspected the installed index directly through pg_index before changing code: bookings_one_confirmed_per_slot_idx is unique=true, valid=true, B-tree(slot_id), WHERE status = 'confirmed'. It was not recreated. Captured task-start fingerprints for schema.ts, every migration/metadata file, package manifests/lock and official PDF; all remained unchanged at final review.

### Concurrency and transaction decisions

- Booking explicitly uses READ COMMITTED, takes the existing shared transaction reset lock, then locks its slot FOR UPDATE. A separate SQL statement evaluates the database wall clock after any lock wait; missing slot remains 404, started/equal-now slot 400, then occupied future slot 409. Insert/commit follows only when eligible and unoccupied.
- The partial unique index remains the independent database guarantee even if a precheck is bypassed. Catching occurs outside the awaited Drizzle transaction, after rollback. Only a real pg.DatabaseError (optionally unwrapped from DrizzleQueryError) with SQLSTATE 23505, table bookings and constraint bookings_one_confirmed_per_slot_idx becomes ConflictException/409. Other unique constraints, CHECK, FK and infrastructure errors retain sanitized 500 handling. Never issue another query inside an aborted transaction.
- Cancellation uses the same shared-reset -> slot-row -> booking lock order. It first reads immutable slot_id without locking the booking; reset coordination excludes fixture deletion. Then it locks that slot and executes conditional UPDATE WHERE booking id AND status = confirmed, changing only status/cancelled_at and returning the exact six public fields. Missing ID is 404; an already-cancelled/concurrent loser is 409; successful commit returns 200. No start-time restriction, record deletion or reactivation.
- Reset obtains its exclusive reset lock before any table write. Both mutation paths lock only one slot and never acquire a booking lock before its slot; review found no cycle among implemented application paths. Locks release on commit/rollback before service completion. No application mutex, process-local correctness state, session-level lock or automatic retry loop was added.
- Explicit READ COMMITTED makes fresh-state checks independent of a server isolation default. External SQL clients using another lock order or indefinitely holding locks remain an operational risk; production timeout/deadlock policy is not silently mapped to an invented 409.

### Tests and actual verification

- Added a dedicated Level 3 integration suite against an actual listening localhost Nest server and Docker PostgreSQL 18.6, using simultaneous Promise.all HTTP requests with valid API keys and distinct emails. Also exercised two independent Nest instances/connection pools.
- Verified 16 same-slot attempts yield one 201/fifteen 409; 12 cross-instance attempts yield one winner; 12 concurrent cancellations yield one 200/eleven 409. Eight cancellation/rebooking races accept actual ordering-valid winners/losers while asserting final database counts, retained history, timestamp/status coherence and availability.
- Direct PostgreSQL tests reject a second confirmed insert while permitting multiple cancelled records. Cancellation tests cover exact response fields, original timestamp precision/data preservation, unknown/repeated IDs, post-start cancellation, cancelled lookup, availability and new-ID rebooking without reactivating old records.
- Temporary test triggers provoke real expected index, unrelated primary-key 23505, CHECK 23514 and FK 23503 errors; direct probes assert the actual constraint/code before checking HTTP 409 versus sanitized 500. Failed booking/cancellation transactions leave prior state intact and permit healthy retries after cleanup.
- Dedicated test clients hold a real slot row lock; pg_blocking_pids proves the HTTP request is blocked. Time crossing while blocked yields 400 after release; another slot remains bookable during the wait. A reset/cancel/book race yields only documented ordering-valid responses with no orphan or duplicate confirmed row.
- First full run passed 143 tests. Review strengthened direct error-identity probes and guarded the primary-key fixture against recursive trigger calls; the same 143 tests passed again. Final review explicitly pinned READ COMMITTED; final rerun passed **143/143 across 3 suites, 0 failed, 89.837 seconds**. No integration failure, unexpected concurrency 500 or deadlock was observed. Expected 500s occur only in deliberate fault-injection cases.
- Final npm run build, ESLint src/test/drizzle.config.ts and Prettier source/test/config checks each exited 0. Final git diff --check also passed. No dependency installation/change or new migration was required. Existing Level 2 security findings were not re-audited or claimed remediated.

### Incremental files changed

Created:

- backend/test/level3.e2e-spec.ts

Modified:

- backend/src/bookings/bookings.service.ts — row locks, fresh time/occupancy checks, narrow database-error mapping and cancellation.
- backend/src/app.controller.ts — thin official DELETE /bookings/:id handler.
- backend/src/auth/api-key.middleware.ts — comment updated; authentication behaviour unchanged.
- backend/test/app.e2e-spec.ts — corrected test name to describe the now-existing DELETE route's unknown-ID 404; assertions retained.
- docs/ARCHITECTURE.md, docs/DATABASE.md, docs/API.md, docs/TESTING.md and docs/CODEX_WORKFLOW.md — current semantics, transaction/lock review and actual results.
- backend/README.md and docs/DEPLOYMENT.md — stage boundary/cancellation availability corrected; no deployment configuration changed.

No files removed. No schema, index, migration history, dependency, secret, official specification, frontend, PRD or environment configuration change in Level 3. Test-only trigger/functions and lock-holding transactions are removed/released in finally; no such objects were installed in runtime/development schema as a feature.

### Remaining risks and next boundary

No unresolved issue blocks the local Level 3 acceptance scope. Finite concurrent tests are not an exhaustive proof of every external-client schedule; the PostgreSQL unique index supplies the independent invariant. External lock holders, production timeout/deadlock policy, hosted persistence/load testing and the external Koya assessor remain unverified. Previous dependency-audit findings remain outstanding. Await explicit Level 4 authorization for database-backed idempotency/history pagination; Level 5 limiter and frontend/deployment remain deferred.

## 6 November 2026 — Level 2 authentication and booking validation

Status: **Levels 1–2 locally verified: 2 real-PostgreSQL integration suites, 116 passed, 0 failed.** Level 1 retains all 32 passing tests; Level 2 adds 84. Production build, ESLint and formatting checks passed. Stop after Level 2; Level 3 has not been authorized or implemented. This entry supersedes the earlier Level 1-only implementation status below.

### Review and scope

- Read AGENTS.md, API.md, ARCHITECTURE.md, DATABASE.md and TESTING.md, plus all nine official PDF pages and the complete previously retrieved official OpenAPI JSON (version 1.0, fingerprint recorded in API.md). The live web reader could not retrieve the JSON URL; the prior retrieval and unchanged PDF supplied the authoritative contract. Official specification files were not edited.
- Inspected the existing module/controller/services, connection/schema/migration design, test setup, runtime configuration and clean starting Git status before changing code. No new public handler, Level 3–5 business behaviour, schema or migration was added.

### Authentication and validation decisions

- Added reusable ApiKeyGuard as a global APP_GUARD, sharing the same instance with ApiKeyMiddleware. Expected API_KEY is a server environment secret validated during provider creation before startup/listening. Reject missing/blank config, surrounding whitespace and control characters without including the value in errors. Compare SHA-256 digests using timingSafeEqual; no hardcoded production key, logging or browser exposure.
- A guard alone would authenticate after Nest's default body parser, and would not run for the two not-yet-implemented routes. Disabled automatic parsing in main/test application factories; module middleware authenticates the six official method/path combinations before JSON/urlencoded parsing, reusing the guard check. Correctly authenticated history/cancellation still return 404 because no handlers were introduced. Missing/empty/incorrect/whitespace-only/repeated key headers return 401 with the common Error envelope.
- Added CreateBookingDto and a booking-only transformation/validation pipe using class-transformer and existing class-validator. Required values must be strings and nonblank; trim name/email before syntax checks, preserve slot_id exactly, disable implicit coercion, and retain the existing lowercased email storage. No name-length limit, UUID requirement, domain whitelist or unknown-property rejection was added. Error strings contain field descriptions, not submitted values or validation targets.
- Added DatabaseClock, returning the SQL clock_timestamp() expression. After shared reset-lock acquisition, PostgreSQL evaluates starts_at <= clock_timestamp(); equality/past returns 400 before attempted insertion/occupancy handling. Missing slot remains 404. A small SQL-expression time seam makes exact-boundary tests deterministic while retaining actual PostgreSQL reads/writes. No Level 3 slot lock, future occupied-slot 409 mapping or cancellation was introduced.
- Added class-transformer and declared Express directly for the manually ordered parsers. The schema, all migration files and official PDF remain unchanged. Frontend and PRD were not modified.

### Tests and actual results

- Retained every Level 1 assertion; moved test connection/app setup into support.ts and attached generated test-key headers to authenticated calls. Test secrets are generated at runtime and do not use/log developer credentials.
- Level 2 covers all six paths with missing/empty/wrong/whitespace keys and correct keys; duplicate/differing-length keys, header/path casing, authentication before DTO/reset validation and malformed JSON, startup configuration, required-field/type/blank/email failures, normalization and direct stored-email checks, arbitrary IDs, 404 missing slots, past/occupied precedence and exact-now/strictly-future time boundaries. Common JSON error shape is checked throughout.
- First functional run passed 114 then-defined tests. Removed a synthetic guard-context test and added meaningful configuration/key-length edge cases. Final npm test -- --json --outputFile <temporary report>: **2 passed suites, 116 passed tests, 0 failures; 54.598 seconds**. Report confirms app.e2e-spec.ts 32/32 and level2.e2e-spec.ts 84/84. Real Docker PostgreSQL 18.6; no in-memory database or mocked query results.
- Final npm run build, ESLint src/test/drizzle.config.ts and Prettier source/test/config checks each exited 0. No functional test failure occurred during Level 2. An early lint attempt detected mixed line endings after a Windows edit; formatting resolved them. An initial formatter target included .env.example (unsupported inferred parser); reran supported targets successfully.
- Baseline and post-install npm audits both report 34 findings: 5 low, 27 moderate, 2 high, 0 critical. Compared advisory identities and affected-package sets: **no newly introduced advisories or newly affected packages**. Existing findings remain; no force upgrade or unrelated remediation was performed. Audit snapshots/test JSON are temporary, not tracked deliverables.

### Documentation and file inventory

Updated API.md, ARCHITECTURE.md, DATABASE.md, TESTING.md, DEPLOYMENT.md, backend README and this log for actual runtime behaviour, the new API_KEY environment requirement and remaining level boundaries. Existing developer .env/local credential files were not overwritten.

Created:

- backend/src/auth/api-key.guard.ts
- backend/src/auth/api-key.middleware.ts
- backend/src/bookings/create-booking.dto.ts
- backend/src/bookings/booking-validation.pipe.ts
- backend/src/database/database-clock.ts
- backend/test/level2.e2e-spec.ts
- backend/test/support.ts

Modified:

- backend/src/app.module.ts, backend/src/app.controller.ts and backend/src/main.ts
- backend/src/bookings/bookings.service.ts and backend/src/database/database.module.ts
- backend/test/app.e2e-spec.ts
- backend/.env.example, backend/package.json and backend/package-lock.json
- backend/README.md
- docs/API.md, docs/ARCHITECTURE.md, docs/DATABASE.md, docs/TESTING.md, docs/DEPLOYMENT.md and docs/CODEX_WORKFLOW.md

No files were removed. No schema/migration, official specification, frontend or PRD change. Local API startup now requires a privately configured API_KEY; the test runner supplies its own isolated value.

### Remaining work

Level 3 requires explicit authorization: map confirmed-slot conflicts to 409, add slot row locking and concurrency acceptance tests, implement cancellation and test repeated cancellation/cancel-versus-rebook races while preserving history. The existing partial unique index continues protecting confirmed-slot uniqueness; a duplicate future-slot insert still produces generic 500 until that controlled handling is implemented. Levels 4–5 idempotency/history/limiter, dependency-audit remediation, frontend/proxy and hosted deployment remain deferred. No unresolved issue blocks the verified Level 2 scope, and no external assessor result is claimed.

## 6 November 2026 — Approved policies, backend foundation and Level 1

Status: **Level 1 locally verified: 32 integration tests passed**, build and lint/format checks passed. No external Koya assessor was run. Stop at this requested implementation boundary; Levels 2–5 remain unimplemented/unverified. This entry supersedes historical design-only status statements below.

### Scope and owner policies recorded

- Owner approved the architecture and ten behaviour policies. API.md/ARCHITECTURE.md now distinguish those policies from official requirements: reset 200 {}, invalid/duplicate reset 400 without mutation, replay/422 before rate admission, canonical parsed-body equivalence preserving strings, response retention until reset, no transient/429 caching, admitted-attempt rolling 60 seconds, no shared unusable-email bucket, history missing-email/malformed/foreign-cursor 400, atomic four-table reset, started-slot 400 before occupancy, cancelled history and post-start cancellation.
- Corrected only the outdated frontend technology entry in PRD.md to Next.js/TypeScript with server-side API proxy; functional requirements unchanged.
- Interpreted task item GET /bookings/ as the official Level 1 GET /bookings/{id}. Did not invent another endpoint or implement Level 4 history.

### Implementation and architectural decisions

- Inspected the existing NestJS scaffold, package/build/test configuration, repository status and official-contract documentation before editing. This workspace now has Git; the prior historical no-Git limitation no longer applies. Starting Git status was clean.
- Added node-postgres, Drizzle ORM/Kit, dotenv, class-validator's date-time helper and pg types, with a lockfile update. Used stable installed packages rather than a release-candidate migration API. Official Drizzle PostgreSQL/migration guidance was consulted: https://orm.drizzle.team/docs/get-started-postgresql and https://orm.drizzle.team/docs/migrations.
- Added compose.yaml with local-only PostgreSQL port, named persistent volume, required password and health check. Generated credentials in ignored backend/.env.level1-local; preserved existing developer backend/.env. No secrets added to tracked files.
- Added typed DatabaseModule/Service with required DATABASE_URL, UTC sessions, startup connectivity and graceful pool shutdown. Added Drizzle config/schema, initial generated SQL/snapshot/journal and explicit db:generate/db:migrate scripts. No runtime schema synchronization.
- Initial migration installs slots, bookings, idempotency_records, booking_attempts, FK/check/index constraints and partial UNIQUE confirmed-slot index. Text slot IDs and required end timestamps match the official source. Auxiliary tables exist for reset lifecycle only; no later-level request logic was added.
- Thin AppController delegates to reset/slots/bookings services. Removed scaffold root endpoint/AppService and obsolete Hello World unit/e2e assertions. Only the four Level 1 routes exist. Common error filter preserves {error: string} and hides infrastructure details.
- Reset validates before destructive writes, rejects duplicate IDs, clears all four tables and installs caller inventory in one transaction. Inserts are batched below PostgreSQL parameter limits. Reset takes an exclusive advisory transaction lock; booking takes its shared mode to protect the existence-check/insert boundary against reset.
- Listing uses a single correlated NOT EXISTS query for availability and parameterized exact provider filtering. Booking creation generates a UUID string, commits before 201 and lookup returns exactly six public Booking fields. Basic shape/string checks and canonical stored name/email values protect persistence; full Level 2 validation/authentication is deferred.
- The database index prevents duplicates now, but slot row locking, intended 409 mapping and concurrent-request acceptance tests remain Level 3. A duplicate insert currently returns generic 500. No API-key guard, started-slot rejection, cancellation/history, idempotency or limiter request handler was implemented.

### Tests, results and encountered problems

- Local Docker PostgreSQL 18.6 started successfully after approved Docker access; npm dependency retrieval also required approved network escalation. Created development clinic_booking and dedicated clinic_booking_test; no production database was accessed.
- db:generate and db:migrate passed. Test setup applies the same migration twice successfully. Reviewed generated SQL for the confirmed-slot unique predicate and FK/checks.
- Initial test invocation failed setup (30 failures reported) because the dedicated test database was not yet provisioned. Provisioned it before retrying.
- First feature run: 28 passed, 2 failed. Availability incorrectly stayed true after booking; the hand-built correlated SQL lost qualification through ORM projection. Replaced with Drizzle correlated NOT EXISTS; rerun passed 30/30.
- Corrected six lint errors from Jest's any-typed asymmetric matchers. Added two contract/storage checks; final npm test passed **1 suite, 32 tests, 0 failures, 6.419 seconds**. Real PostgreSQL, NestJS and Supertest; no database mocks. Tests verify invalid-reset state preservation and insertion-failure rollback, exact provider matching, booking/lookup persistence across requests and app restart, and absence of later-level routes.
- npm run build passed; dist/main.js exists. ESLint src/test/config passed with no warnings/errors; Prettier checks passed. No concurrency, cancellation, retry or rate-limit acceptance suite was run or claimed complete. Full details/reproduction are in TESTING.md.
- npm install reported 34 dependency audit findings (5 low, 27 moderate, 2 high). No forced/unrelated upgrades were made; remediation requires a separate dependency review. No independent audit-remediation result is claimed.

### Documentation and final review

Updated API.md, ARCHITECTURE.md, DATABASE.md, TESTING.md, DEPLOYMENT.md and this log, plus the approved PRD frontend row and backend README. Official specification/PDF hash is unchanged. Reviewed source, migration, configuration, ignored credential paths and documentation for the implemented Level 1 boundary. Exact file inventory is available through Git status and the task response.

Final Git whitespace check passed. Generated credential files and existing .env are ignored; no credential contents are included in the changes. The only PRD content change is the authorized frontend technology row (plus a final newline).

### File inventory for this implementation

Created:

- compose.yaml
- backend/.env.example
- backend/drizzle.config.ts
- backend/drizzle/0000_stormy_killmonger.sql
- backend/drizzle/meta/0000_snapshot.json
- backend/drizzle/meta/_journal.json
- backend/src/database/database.module.ts
- backend/src/database/database.service.ts
- backend/src/database/schema.ts
- backend/src/database/locks.ts
- backend/src/database/migrate.ts
- backend/src/bookings/bookings.service.ts
- backend/src/reset/reset.service.ts
- backend/src/slots/slots.service.ts
- backend/src/common/input.ts
- backend/src/common/api-error.filter.ts

Modified:

- backend/package.json and backend/package-lock.json
- backend/src/app.controller.ts, backend/src/app.module.ts and backend/src/main.ts
- backend/tsconfig.build.json
- backend/test/app.e2e-spec.ts and backend/test/jest-e2e.json
- backend/README.md
- docs/API.md, docs/ARCHITECTURE.md, docs/DATABASE.md, docs/TESTING.md, docs/DEPLOYMENT.md, docs/PRD.md and docs/CODEX_WORKFLOW.md

Removed obsolete scaffold files: backend/src/app.service.ts and backend/src/app.controller.spec.ts. The existing e2e file was replaced with the PostgreSQL integration suite. No frontend or official specification file was modified. Ignored local credential/build/dependency files are not deliverable source changes.

### Remaining work

Await the next explicitly requested task. Level 2 needs X-API-Key and full validation; Level 3 needs cancellation and deliberate concurrent-conflict behaviour; Level 4 needs idempotency/history; Level 5 needs admitted-attempt rolling limiter and combined precedence tests. Next.js proxy/UI, hosted deployment, external assessment and dependency-audit remediation remain outstanding. Do not mark a higher assessment level verified from this foundation or proceed automatically.

## 6 November 2026 — Official specification reconciliation

Status: contract/design review completed; no application implementation authorized or performed. This entry supersedes the earlier PRD-only review's source-availability and frontend-decision blockers; the historical entry is retained below.

### Sources and scope

- Re-read root AGENTS.md, including its new source priority: official OpenAPI > official PDF > PRD > architecture > implementation.
- Read all nine pages of docs/specifications/koya-assessment-api.pdf through text extraction and inspected a rendered nine-page overview. Read the entire official OpenAPI 3.0.3 document, API version 1.0, from https://koyaacademy.com/assessment-api/openapi.json. No local openapi.json was present.
- The browser fetch tool could not retrieve the JSON. A shell request was blocked by sandbox networking, then the approved elevated request succeeded. The retrieval copy was temporary; official repository files were not edited. Source fingerprints are recorded in API.md.
- Inspected existing design documents and compared all six method/path combinations, all component schemas and every global/operation response against the PRD.

### Documents changed and definitive resolutions

- Created docs/API.md: complete required fields/types, JSON structures, headers, validation/normalization, six operations, pagination and full status matrix. Required status set is 200, 201, 400, 401, 404, 409, 422 and 429. Global 401 applies even when an operation response map omits it.
- Rewrote ARCHITECTURE.md against the official contract, with explicit specification/implementation distinctions, PRD comparison, transaction design, failure verification and level-gated implementation order.
- Revised DATABASE.md: text slot IDs instead of UUIDs; added required slot end instant; exact public/internal field mapping; removed speculative nonblank-provider/end-order constraints. Booking IDs may be generated UUID strings but path parameters are arbitrary strings.
- Reset accepts caller-supplied slots, including past slots and empty arrays; no fixed seed. Listing returns available alongside all four slot fields. Booking/create/read/cancel responses are direct six-field Booking objects. Cancellation is 200 with cancelled status, missing booking 404 and repeated cancellation 409. History uses cursor/next_cursor and null on the last page, with invalid limit 400.
- Resolved the PDF's misleading generic confirmed DELETE sample in favour of the definitive operation text requiring cancelled. Shared Error examples do not mandate the same literal message for every failure.
- Recorded owner approval of NestJS/TypeScript, PostgreSQL/Drizzle, Next.js/server-side proxy, partial confirmed-slot unique index, PostgreSQL-backed limiter and database-backed idempotency. Next.js is no longer an unresolved technology choice; the PRD's Vite entry is documented as stale. PRD itself was not edited because the requested update scope excludes it.

### Material ambiguities remaining

1. Reset 200 success JSON and invalid/duplicate-slot input errors; schema does not define interval ordering/nonblank slot restrictions.
2. Idempotency replay/422 versus rate-limit 429 precedence, and precedence when a slot is both started and occupied.
3. Same-body equivalence, error caching, key retention/scope and reset lifecycle.
4. Rolling/fixed minute, whether denied attempts extend the window, normalization/bucketing of invalid or absent email and treatment of auth/replay attempts.
5. Required history-email and malformed/foreign/stale-cursor error status/behaviour.
6. Whether reset clears limiter/idempotency state.

See API.md for exact gaps. Approved technology decisions do not settle these behavioural choices. The previous proposal's limiter-first precedence is explicitly withheld rather than silently adopted. No unspecified public endpoint, field, status or validation restriction has been invented as an official requirement.

### Validation and next step

Performed documentation checks against the parsed OpenAPI: all six operations, global authentication, component fields and status matrix. Rechecked document consistency and verified the PDF fingerprint was unchanged. No application tests were added, modified, removed or run; no build, database, migration, dependency installation or server was run. docs/TESTING.md is unchanged because no test work occurred. There is still no claim that any assessment level passes.

Only API.md, ARCHITECTURE.md, DATABASE.md and this log were targeted for final documentation changes. A temporary PDF-render inspection image was used for review and removed afterward. Application sources and the official specification were untouched. Report the remaining material ambiguities and await their resolution plus the next explicitly requested implementation task.

## 6 November 2026 — Requirements and architecture proposal

Status: design documentation completed; implementation awaiting owner approval. This is not completion of any assessment level.

### Requested scope and work completed

- Read root AGENTS.md and docs/PRD.md, inspected the repository file inventory and the NestJS/Next.js scaffolds. The three target documentation files were empty before this task.
- Analysed all five assessment levels, six endpoint/method combinations plus provider filtering, security, persistence, UI and deployment requirements.
- Updated ARCHITECTURE.md with endpoint behaviours, component boundaries, transaction flows, concurrency guarantee, idempotency, rate limiting, pagination/reset behaviour, failure scenarios, requirement comparison and gated implementation order.
- Updated DATABASE.md with a proposed four-table PostgreSQL/Drizzle model, constraints/indexes, migration approach and verification plan.
- Kept PRD requirements unchanged. No application code, dependency files, schema declarations, migrations or deployment configuration changed.

### Important proposed decisions

- Partial unique confirmed-slot index is the independent database protection against double-booking; row locks and transactions coordinate business decisions.
- Keep cancelled booking records and derive availability instead of maintaining a duplicate flag.
- Commit a booking and its idempotency result atomically, serializing concurrent keys with transaction advisory locks.
- Use a shared PostgreSQL rolling-window limiter with independently committed attempts so business failures consume quota.
- Use immutable timestamp/ID seek cursors and an exclusive/shared reset coordination protocol.
- Retain Next.js for server-held API-key mediation if the owner approves resolving the contradictory Vite entry in the PRD.

All choices are proposals. In particular, replay/rate-limit precedence is not settled and must not be silently implemented.

### Problems and unresolved decisions

1. The repository contains a PRD summary but no complete Koya technical specification or assessment fixtures. Exact JSON bodies/envelopes, many statuses, slot fields/IDs, reset dataset and cursor rules cannot be verified. Obtain these before API implementation.
2. Root AGENTS.md and existing frontend use Next.js; PRD names React/Vite. Owner must resolve this without an unapproved PRD edit.
3. Confirm idempotency body equivalence, scope, retention and which errors are retained; settle original-response replay versus sixth-attempt 429 precedence.
4. Confirm rolling/fixed window, counting denied attempts, and missing/invalid-email failure treatment.
5. Confirm reset's effect on idempotency and rate-limit data, cancelled-history visibility and past-slot cancellation semantics.
6. `git status --short` failed because the workspace is not a Git repository. No Git diff/status baseline is available; changes are confined to the three requested documents by the edit operation.

The full decision list and recommendations are in ARCHITECTURE.md. Implementation is paused at the user's explicit design approval boundary.

### Validation and test status

Documentation-only task: no application tests were added, modified, removed or executed. No claim is made that the existing scaffold tests or any Koya acceptance tests pass. No server, database, migration or build was run. Reviewed the document changes for consistency with the PRD, proposed schema and transaction ordering; mechanically checked target file contents and endpoint inventory after writing.

Public PostgreSQL CREATE INDEX documentation was consulted to verify partial unique index support and immutability restrictions; it is linked in the design documents. It does not substitute for the missing Koya specification.

### Remaining work / next authorized step

Present the unresolved decisions to the owner and wait for approval and the authoritative contract. After approval, undertake only the next explicitly requested implementation task. Implement/test Level 1 first, then advance level by level only after each level's acceptance tests pass. Record actual test execution in docs/TESTING.md and update other affected documentation in the same implementation task.
