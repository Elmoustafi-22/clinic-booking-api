# Testing — Levels 1–3

Updated 7 November 2026. **Levels 1–3 locally verified: 3 PostgreSQL integration suites, 143 passed, 0 failed.** Level 1 retains 32 passing tests, Level 2 retains 84, and Level 3 adds 27. No external Koya assessor or hosted deployment was run.

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
