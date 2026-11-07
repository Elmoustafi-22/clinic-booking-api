# Testing — Levels 1–5

## Level 5 final verification — 7 November 2026

**Levels 1–5 locally verified: 6 PostgreSQL integration suites, 255 passed, 0 failed.** Existing suites retain all 213 cases unchanged: Level 1 32/32, Level 2 84/84, Level 3 27/27, Level 4 28/28 idempotency and 42/42 pagination. Level 5 adds 42/42. No existing test file was modified for Level 5.

| Check | Actual result |
| --- | --- |
| npm test -- --json --outputFile <temporary report> | Exit 0: 255/255 passed, 6 suites; Jest reported 123.126 seconds. |
| New test/rate-limit.e2e-spec.ts | 42/42 passed with real PostgreSQL and listening Nest HTTP applications. |
| npm run build | Passed, exit 0. |
| npm exec -- eslint src test drizzle.config.ts | Passed, exit 0 after test-helper lint cleanup. |
| npm exec -- prettier --check src test drizzle.config.ts package.json tsconfig.build.json | Passed, exit 0. |
| git diff --check | Passed, exit 0 (also checked with line-ending conversion disabled). |
| Migration/package/specification fingerprints | Existing migration SQL/metadata, package/lock files and official PDF unchanged. schema.ts diff is a comment only. |

Coverage includes five admissions/sixth 429 and positive integer Retry-After; independent/normalized emails; counted invalid name, missing slot, missing/occupied/started slot, invalid syntax and oversized/NUL email strings; absent/blank/non-string email without a bucket; authentication first; database timestamps; expired history; calendar-minute crossing; exact microsecond 60-second expiry and ceil rounding; denied state immutability.

Two burst cases send 24 simultaneous distinct-slot requests with one email, through one or two independent Nest applications. Each asserts five 201, nineteen 429, no unexpected 500 response, five admitted events and five bookings directly in PostgreSQL. Twenty concurrent identical keyed requests across two applications consume one event and retain one response/booking. Replay and mismatched-body 422 bypass a full bucket; new keys consume quota, cached validation retries consume once, and a denied key is reusable after expiry with no cached 429.

Fault triggers prove booking and response-store rollbacks retain admission, admission insert/clock-query/deferred-COMMIT failure fails closed, and no booking/result pair is orphaned. A failed booking followed by four healthy bookings exhausts the budget, proving the failed transaction still counts. Reset clears admission and permits new attempts; invalid reset preserves it, and failed inventory insertion rolls back all tables. A PostgreSQL gate holds one admission while another email succeeds. A second gate test queues exclusive reset behind the parent's shared lock before releasing the child, proving the child does not deadlock by reacquiring reset and final reset clears the completed attempt/booking together. Fault fixtures are removed in finally and applications/pools close.

The first new-suite run passed 38/39 with one unexpected 500 in a burst. A targeted burst rerun passed, but the initial complete run reproduced both burst failures (250/252 passed); all 213 legacy cases passed. Bounded connection/lock waits were then increased for burst queues (primary/admission connection wait 30 seconds; admission lock 15 seconds, statement 20 seconds). The 39-case Level 5 suite passed in 37.189 seconds. Three additional clock/rollback/reset cases brought the final full run to 255/255. Initial ESLint flagged a redundant assertion and method-binding issues in optional test diagnostics; the redundant spy was removed, retaining every status/database-state assertion. An initial production build also caught a missing explicit NodePgDatabase type on the new service; it was corrected before passing integration execution.

No dependency was installed or updated and no security audit was rerun. Earlier audit findings below remain the last measured baseline; no new dependency finding is claimed. These are local acceptance results, not hosted load, availability, external assessment or frontend verification. Resource overload and external lock holders can still produce fail-closed 500 responses after bounded waits. Events are retained until reset; no expiry cleanup job exists.

After the test-diagnostic lint cleanup, both affected 24-request concurrency cases passed again (2/2; 40 unrelated cases skipped), 18.841 seconds. Final direct local ESLint and Prettier checks also exited 0; Git whitespace checks reported no errors for tracked or newly created files.

## Historical Level 4 verification

Updated 7 November 2026. **Levels 1–4 locally verified: 5 PostgreSQL integration suites, 213 passed, 0 failed.** Level 1: 32; Level 2: 84; Level 3: 27; Level 4: 70 (28 idempotency, 42 pagination). No external Koya assessor, hosted deployment or frontend was run.

## Level 4 final executed checks

| Check | Actual result |
| --- | --- |
| npm test -- --json --outputFile <temporary report> | Exit 0: 5 suites / 213 tests passed, 0 failed; Jest reported 104.766 seconds. |
| Previous Level 1–3 suites | 32/32, 84/84 and 27/27 passed, retaining all 143 cases. |
| test/idempotency.e2e-spec.ts | 28/28 passed. |
| test/pagination.e2e-spec.ts | 42/42 passed. |
| npm run build | Passed, exit 0. |
| npm exec -- eslint src test drizzle.config.ts | Passed, exit 0, no warnings/errors. |
| npm exec -- prettier --check src test drizzle.config.ts package.json tsconfig.build.json | Passed, exit 0. |
| git diff --check | Passed after final documentation review. |
| Migration/dependency/specification fingerprints | Unchanged. schema.ts differs only in a lifecycle comment; restoring that comment reproduces the task-start fingerprint. No DDL/migration was generated. |

The first complete Level 4 run passed 210 tests (27 idempotency/40 pagination plus previous 143). Review then added fixed-size header-key identity storage and strict decoded cursor date/text validation. Final coverage added three tests and passed all 213. No functional integration-test failure was observed. Initial ESLint found four unused variables after extracting shared booking logic/projection; they were removed before the final passing check. This was a lint cleanup, not a suppressed rule.

## Existing-suite compatibility

All 143 previous cases remain and pass. Two history-absence staging assertions necessarily changed when GET /bookings was implemented: the Level 1 missing-email request now expects the approved 400 instead of routing 404, and Level 2's authenticated valid-email request expects 200 instead of 404. Authentication/validation/reset/availability/lookup/cancellation/concurrency assertions were retained. No previous test case was removed or weakened to mask a regression.

## Idempotency coverage — 28 tests

- Original status, booking ID and full six-field JSON are replayed; PostgreSQL holds the status/body snapshot and public responses contain no metadata.
- Canonical recursive property order, arrays, number/string distinctions, special own JSON keys, submitted whitespace/case and extra fields are tested. Changed bodies, including invalid changed bodies, return 422 while the original remains replayable.
- No-header requests independently book valid different slots. A present empty key works; a 4000-character random header key works without exceeding B-tree entry size because stored identity is SHA-256.
- Sixteen identical simultaneous HTTP requests replay one result. Twelve matching requests across two independent Nest instances/pools also return one ID. Mixed-body simultaneous requests yield one original result plus 422 mismatches. Twelve different keys competing for a slot create one confirmed booking and cache independent occupied-slot outcomes.
- Original confirmed responses replay after cancellation; current lookup remains cancelled. Replay also survives an application close/recreation with a fresh pool.
- Deterministic 400 validation/start, 404 missing-slot and 409 occupied-slot results replay even after the underlying slot/booking state changes.
- A response-store trigger failure rolls back the newly created booking and leaves no metadata; retry succeeds after cleanup. A transient booking error is not cached. A real unique-index violation rolls back to the savepoint, then commits/replays its 409 without aborted-transaction errors or trigger-written booking residue.
- Reset clears old records atomically and permits key reuse with another body/new booking ID. Missing API credentials take precedence over replay, mismatch and validation, without metadata mutation.

## Pagination coverage — 42 tests

- Missing/blank/repeated email is 400; empty history has exact bookings/next_cursor envelope. GET does not invent POST email-syntax rules.
- Default page size 10, valid limits 1/50, invalid/fractional/nonnumeric/empty/repeated limits and a multi-page unchanged dataset are checked. All expected IDs appear once in database order; final cursors are null.
- Case-insensitive/trimmed email matches and email isolation work. Both booking statuses remain visible, including a record cancelled through the actual API. Every result contains only six public Booking fields.
- Equal timestamps use the ID tie-breaker. A deliberately reversed-ID dataset with three distinct microsecond timestamps inside one visible millisecond traverses correctly, detecting any truncation of cursor boundaries.
- Malformed/repeated/foreign/tampered cursors are 400. Signed but impossible calendar dates and invalid PostgreSQL text IDs are rejected before SQL. Email case and page-size changes preserve valid continuation.
- Another Nest instance accepts a generated cursor; a valid cursor does not depend on the boundary row remaining present. API authentication precedes query validation.

## Reproduction, isolation and limits

Use the existing Docker PostgreSQL 18.6 and dedicated TEST_DATABASE_URL ending _test. Both new suites listen on ephemeral localhost ports and issue actual HTTP requests with runtime-generated API keys; parallel cases use Promise.all, not sequential simulation or process mutexes. Existing migration files are applied/reapplied by suite setup. Test-only triggers are removed in finally and all applications/pools close; no production schema or credentials are modified.

Run npm test from backend. Test JSON/advisory/fingerprint reports are temporary, not source artifacts. No new dependency was added, no audit was rerun, and the prior Level 2 audit findings below remain the last measured security baseline. No hosted load/availability benchmark or external assessment was performed.

Pagination guarantees complete traversal for an unchanged dataset, not a frozen snapshot during writes/reset. Cursor signing requires the same API_KEY across replicas; rotating it invalidates old tokens. Error snapshots may legitimately have no booking. Retention remains until reset. HTTP transport/body limits and external PostgreSQL lock holders/timeouts remain deployment constraints.

## Historical Level 4 prerequisites (now implemented)

No rate-limit service, admission or attempt writes were implemented. Add independently committed PostgreSQL rolling-60-second admitted attempts after replay/422 resolution and before validation/business work when an email bucket is usable; denied 429 must neither extend the window nor be cached. Preserve reset/key coordination across admission and avoid inner reset-lock acquisition/pool starvation. Both keyed and unkeyed validation paths need deliberate integration with that future policy. Previous dependency audit remediation, frontend/proxy and deployment remain separate work.

## Historical Level 1–3 verification (superseded stage boundary)

The following records describe the previous Level 3 task, not the current implementation boundary.

## Final executed checks

| Check | Actual result |
| --- | --- |
| npm test -- --json --outputFile <temporary report> | Exit 0: 3 suites passed, 143 tests passed, 0 failed; Jest reported 89.837 seconds. |
| Level 1 suite: test/app.e2e-spec.ts | 32/32 passed; existing assertions retained with authenticated request setup. |
| Level 2 suite: test/level2.e2e-spec.ts | 84/84 passed against the same real PostgreSQL. |
| Level 3 suite: test/level3.e2e-spec.ts | 27/27 passed against a listening Nest application and real PostgreSQL. |
| npm run build | Passed, exit 0; production TypeScript/Nest build. |
| npm exec -- eslint src test drizzle.config.ts | Passed, exit 0, no warnings/errors. |
| npm exec -- prettier --check src test drizzle.config.ts package.json tsconfig.build.json | Passed, exit 0; all matched files use Prettier style. |
| git diff --check | Passed, exit 0 after final documentation review. |
| Prior Level 2 npm audit --json before/after | Both reports: 34 findings (5 low, 27 moderate, 2 high, 0 critical). No new advisory identities or newly affected packages after Level 2 dependencies. The audit still reports outstanding findings; this is not a clean-security claim. |
| Schema/migration/specification review | No Level 3 schema, migration or dependency change (fingerprints compared with task-start baseline); official PDF SHA-256 remains 7DD78ACB40E657788DA5DC3FC5025A57EB28D04E6231C6CB272694391AC6DF73. |

The first functional Level 2 run passed 114 then-defined tests. After removing a synthetic guard-context test in favour of real request coverage and adding configuration/key-length edge cases, the final suites passed 116 tests. No functional integration-test failures occurred during Level 2. An early lint run detected mixed Windows line endings in the newly edited test file; Prettier normalized the supported source/config files and the final lint/format checks passed. An initial formatting invocation included .env.example, for which Prettier has no inferred parser; it was removed from formatter targets and valid targets were checked successfully.

## Level 1 regression coverage — 32 tests

All prior acceptance assertions remain: reset returns 200 {}, supplied arbitrary string IDs and start/end timestamps, past slots and empty inventories, exact provider filtering and ordering, derived availability, direct six-field confirmed Booking, lookup 404, normalized storage, unique IDs across successive requests, and persistence across requests/application close/recreation with a fresh pool.

Reset tests still prove four-table clearing, invalid/duplicate input 400 without mutation, malformed JSON handling and rollback after an injected PostgreSQL insertion-trigger failure. Initial migration/index installation is checked, and the history handler remains absent. The unknown-cancellation assertion still returns 404 now that DELETE exists; its test name was updated to describe that required behaviour. The only request setup changes are required authentication headers and shared test application construction with automatic body parsing disabled. No original Level 1 acceptance case was dropped to obtain a passing result.

## Level 2 acceptance coverage — 84 tests

- Missing, empty, whitespace-only and incorrect keys return 401 on all six official method/path combinations, including POST /reset. Correct keys reach all four implemented handlers; history still authenticates then returns routing 404; cancellation of the tested unknown ID authenticates then returns booking-not-found 404.
- Incorrect keys of different lengths, repeated headers, case-insensitive header names and Express-compatible case/trailing-slash routing are covered. Responses use only {error: string}, never contain the actual configured test key and contain JSON content type.
- Authentication precedes booking DTO validation, reset validation and malformed JSON parsing. Unauthorized reset leaves inventory intact; the same malformed body with correct credentials returns 400.
- Missing, empty, whitespace-only, null, numeric, boolean, object and array values for each required field return 400 without inserting bookings. Root arrays and invalid email syntaxes are rejected.
- Name/email whitespace is trimmed before validation; email is lowercased in the successful response, subsequent lookup and direct PostgreSQL record. Long names and extra properties are not arbitrarily rejected or exposed in responses.
- Arbitrary string slot IDs, including mixed case, embedded slash and surrounding spaces, remain unchanged. Incorrect case/trailing spaces are not silently normalized to another slot; missing slot returns 404.
- Production PostgreSQL clock rejects a past slot with 400 and no new booking. A started slot that already has a confirmed record returns 400 before the unique-index insertion path; the same precedence is retained by Level 3 under the slot lock.
- Exact equality with the current-time boundary is rejected, while a start one millisecond later is allowed. Only DatabaseClock's SQL expression is controlled in those two cases; the actual table reads, comparisons, transactions and inserts execute against PostgreSQL. No in-memory database or mocked query result is used.
- Missing/blank/malformed API_KEY configuration rejects AppModule compilation before startup/listening can succeed. Environment state is restored after each configuration case; no expected secret is hardcoded or logged.

## Reproduction and isolation

Docker PostgreSQL 18.6 is healthy and was reused from Level 1. TEST_DATABASE_URL explicitly selects clinic_booking_test, separate from development; the suite requires a database name ending _test and never silently falls back to DATABASE_URL. It resets fixture data and applies the existing committed migrations (Level 1 setup also reapplies them to check idempotent migration execution). No new migration was generated/applied in this task.

Test helpers in backend/test/support.ts read .env.test/.env.level1-local/.env and generate a fresh isolated API_KEY. Both application factories disable default parsing (bodyParser: false) so module middleware authenticates before Express JSON/urlencoded parsing. Tests run serially under test/jest-e2e.json to avoid cross-suite reset interference. Run npm test from backend after starting the local database described in DEPLOYMENT.md/backend README.

Tests close Nest applications and PostgreSQL pools. Temporary SQL trigger/function cleanup remains protected by finally. Tests do not delete the database or Docker volume. Existing developer .env and generated local credentials were not overwritten. Coverage measurement, frontend/browser tests, container/host restart and external assessment were not run.

## Security findings and remaining verification

Added class-transformer and explicitly declared the already-used Express parser package. Before/after npm advisory identities and affected package names were compared; **no newly introduced findings** were detected. The pre-existing 34 findings, including two high, remain outstanding; no forced/unrelated dependency upgrade was made.

Level 3 is locally verified as detailed below. Levels 4–5 idempotency/history/limiter and their combined precedence/race tests remain deferred. Do not infer those behaviours from the foundation tables or proceed without authorization. Production policy for external lock holders, infrastructure deadlocks and timeouts, hosted persistence and external assessment remain outside this local verification. No dependency changes were made in Level 3; npm audit was not rerun, and the existing findings remain the last measured security baseline.

## Level 3 acceptance coverage — 27 tests

- Inspected the installed index through pg_index before implementation: valid=true, unique=true, B-tree slot_id key, confirmed-only predicate. It was not recreated. A direct second confirmed INSERT is rejected with real SQLSTATE 23505 and the exact index identity; multiple cancelled records alongside one confirmed record are allowed.
- Sixteen actual simultaneous POST requests with different emails yield one 201 and fifteen JSON 409 responses, with one confirmed row. Twelve requests across two independent listening Nest instances and separate pools also yield one winner. Sequential occupied-slot retries return 409 and preserve the original booking.
- Cancellation returns the exact six-field cancelled Booking; original ID, slot ID, patient details and creation timestamp remain unchanged (including full database timestamp precision). GET retains the cancelled record, slot availability becomes true, and rebooking creates a different ID while the old record stays cancelled. Repeated cancellation is 409 without changing its timestamp or cancelling a replacement record; unknown ID is 404; past-start cancellation succeeds.
- Twelve simultaneous DELETE requests produce exactly one 200, eleven 409 and a final cancelled row. All parallel requests use Promise.all against HTTP listeners, not sequential simulations or in-process mutexes.
- Eight independently reset cancellation/rebooking races each run one cancellation alongside eight booking attempts. Cancellation succeeds; booking outcomes may be 201 or 409 according to actual slot-lock order, with at most one new winner. Database counts, status/timestamp coherence, original cancelled lookup, availability and subsequent ability to book are checked after all requests settle. No particular race winner is assumed.
- A temporary BEFORE INSERT trigger provokes a real confirmed-slot index violation after the normal application precheck. Direct SQL verifies code/index identity; HTTP returns 409. The entire failed transaction, including trigger-written rows, is rolled back; retry succeeds after trigger removal, demonstrating lock/connection release.
- Separate fault cases provoke actual unrelated primary-key 23505, normalization CHECK 23514 and foreign-key 23503 errors. Direct SQL verifies their identities before HTTP returns sanitized 500 rather than 409. Failed inserts leave prior state unchanged; a healthy retry succeeds after cleanup. A failed cancellation CHECK similarly rolls back the status/timestamp change and permits later cancellation.
- A dedicated PostgreSQL client holds a slot FOR UPDATE. pg_blocking_pids confirms the HTTP booking is actually blocked, then database time is allowed to pass the slot start before the lock is released. The HTTP request returns 400 with no booking, proving time was re-evaluated after waiting. A separate test proves another slot can be booked while one slot remains blocked.
- Simultaneous reset/cancellation/booking returns only ordering-valid results (reset 200; cancellation 200/404; booking 201/409), with no orphan or duplicate confirmed row afterward. This exercises the shared/exclusive reset coordination and consistent lock order.

The first Level 3 run passed 143 tests. Review then strengthened fault probes to assert actual PostgreSQL codes/index names and ensured the primary-key fixture did not recurse; the unchanged test count passed again with those assertions. Both mutation transactions were then explicitly pinned to READ COMMITTED; the final complete rerun passed 143/143 in 89.837 seconds. No failing integration test was observed in this task. The final build, ESLint and formatting checks all passed. Test-only trigger/functions and held transactions are removed/rolled back in finally; no production schema changes or session-level application locks are introduced.

The Level 3 server listens on an ephemeral localhost port; requests are real HTTP with API-key headers. Tests apply the existing migration but create no new migration. Finite concurrent tests do not prove arbitrary external-client schedules; the database partial unique index supplies the independent invariant. No unexpected 500 or deadlock occurred in these concurrency cases; expected 500s are limited to deliberate infrastructure/integrity fault injections.
