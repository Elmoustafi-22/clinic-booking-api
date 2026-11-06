# Testing — Level 1 backend foundation

Updated 6 November 2026. Level 1 is locally verified by the integration acceptance suite: **32 passed, 0 failed** against real Docker PostgreSQL 18.6. No official remote assessor was run. Levels 2–5 are not implemented or verified.

## Executed checks and actual results

| Check | Actual result |
| --- | --- |
| npm run db:generate | Passed; generated the four-table initial migration and metadata. Generated SQL reviewed, including the confirmed-slot partial unique index. |
| npm run db:migrate | Passed against development clinic_booking. |
| Same committed migration applied twice in test setup | Passed; fresh test schema installed and second application was harmless. |
| npm run build | Passed, exit 0; production entry dist/main.js generated. |
| npm test (final) | Passed, 1 suite / 32 tests / 0 failures; Jest reported 6.419 seconds. Uses real PostgreSQL, NestJS and Supertest, no database mocks. |
| ESLint src/test/drizzle.config.ts | Passed, exit 0 after correcting matcher types. |
| Prettier source/test/config check | Passed, exit 0; all matched files use Prettier formatting. |

All executed tests live in backend/test/app.e2e-spec.ts, configured by backend/test/jest-e2e.json. npm test and npm run test:e2e use that same suite, serially; duplicate command execution is not a second independent suite. Watch/coverage/debug scripts use this configuration too. Coverage was not measured during this task.

## Acceptance coverage

- POST /reset returns 200 {} and installs arbitrary caller-supplied string slot IDs, start/end values, past slots and empty inventories.
- All four fixture tables are cleared on successful reset, including seeded idempotency/rate-attempt records. This is schema/reset testing, not implementation/testing of the later services.
- Twelve invalid-reset cases, including duplicate IDs, missing/wrong fields, impossible timestamps and a late invalid item, return 400 and preserve existing bookings, slots and auxiliary state. Malformed JSON also returns 400 without mutation.
- An injected PostgreSQL trigger failure during replacement returns generic 500 and proves all reset deletions roll back. The temporary test trigger/function is removed in finally.
- GET /slots returns all six required slot-with-availability fields in start order, exact provider filtering, independent available/booked indicators, an empty result for unknown/case/space-mismatched providers, and safe parameter handling for SQL-like provider strings.
- Equivalent offset timestamps round-trip as UTC instants. No extra blank-slot-string/end-after-start restriction is imposed by reset.
- POST /bookings returns 201 with an unwrapped, exactly six-field confirmed Booking; stored name/email normalization, unique IDs across separate requests, unknown-slot 404 and no orphan booking are checked.
- GET /bookings/:id returns the original object, including after a full Nest application close/recreation with a fresh connection pool. Unknown non-UUID ID returns JSON 404.
- The initial partial unique index exists with the confirmed predicate. Deliberate conflict mapping and concurrent booking tests remain Level 3 work.
- GET /, GET /bookings history and DELETE cancellation are absent at this stage; errors remain JSON.

## Problems encountered and corrected

1. Initial test invocation ran before clinic_booking_test had been provisioned: setup failed and Jest reported all 30 then-defined tests failed. No Level 1 verification was claimed from that run. Provisioning the dedicated database resolved it.
2. First actual feature run: 28 passed, 2 failed. Creation and lookup worked but availability remained true because the hand-built correlated SQL lost column qualification through ORM projection handling. Replaced it with Drizzle's typed correlated NOT EXISTS subquery; the next run passed all 30 tests.
3. ESLint initially rejected six Jest expect.any(String) assignments as unsafe any; typed matcher boundaries were corrected. Build/lint then passed. Two additional meaningful storage/reset-contract tests were added; final suite passed all 32.
4. Restricted sandbox prevented Docker access and stalled dependency networking. Approved elevated Docker/npm access was used. Local PostgreSQL connections and tests then ran successfully.
5. npm installation reported 34 dependency audit findings (5 low, 27 moderate, 2 high). No forced or unrelated dependency upgrade was performed; audit remediation remains a separate dependency review. This count is the install report, not a claim of an independent audit/remediation run.

## Reproduction and data isolation

See backend/README.md and DEPLOYMENT.md for compose/password/migration setup. TEST_DATABASE_URL must explicitly select a dedicated database ending _test. The suite fails, rather than skips or uses in-memory state, when that variable/database/PostgreSQL is unavailable. Never point it at development or production inventory. It replaces all fixture tables in the selected test database and runs serially to avoid reset interference.

Tests read .env.test, .env.level1-local and .env without overriding exported values, then replace the application's DATABASE_URL with TEST_DATABASE_URL for the test process only. The existing developer .env was not edited. A generated, ignored .env.level1-local was used in this run. Docker stores data in its named volume; the suite does not drop the database or volume.

## Deferred verification

Level 2: API-key guard, missing/empty/email validation, started slots and full failure contract. Level 3: concurrent bookings across separate connections, duplicate-slot 409, cancellation races and retained cancelled records. Level 4: matching/different/concurrent idempotency bodies, retained domain errors, original-response replay after cancellation/reset and cursor history/error cases. Level 5: admitted failed attempts, per-email independence, window boundaries, denied-attempt nonextension and replay/422 precedence over 429.

The backend currently has no API-key enforcement, no started-slot rejection, no controlled duplicate-slot response and no cancellation/history/idempotency/limiter handler. Database protection exists but later-level acceptance cannot be inferred from it. External assessor, hosted deployment, browser/frontend, Docker/host restart and full system end-to-end checks were not run.
