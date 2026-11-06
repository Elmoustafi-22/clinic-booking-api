# Work log

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
