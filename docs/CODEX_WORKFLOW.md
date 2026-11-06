# Work log

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
