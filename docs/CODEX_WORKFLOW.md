# Engineering workflow and decision record

This concise record retains important decisions, milestone results and outstanding work. Detailed development transcripts and generated reports are not submission requirements. Follow [AGENTS.md](../AGENTS.md); update the relevant documentation in the same task as implementation.

## Working rules

1. Read the official specification and inspect existing code before changes.
2. Work only within the authorized task/assessment level.
3. Keep controllers thin, business rules in services and concurrency guarantees in PostgreSQL.
4. Preserve the six required operations, exact schemas and status codes.
5. Use reviewed migrations; never alter production schema manually.
6. Run relevant tests and report actual results, including failures/limits.
7. Update API, architecture, database, testing and deployment docs when affected.
8. Keep secrets private and stop before deployment without authorization.

## Milestones

| Date            | Milestone                                                           | Recorded result                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 November 2026 | Requirements/specification reconciliation and architecture approval | Official OpenAPI established as primary authority; owner policies recorded separately.                                                                                                                                                |
| 6 November 2026 | Backend foundation and Level 1                                      | 32 PostgreSQL integration tests passed.                                                                                                                                                                                               |
| 6 November 2026 | Level 2 auth and validation                                         | 116 cumulative backend tests passed.                                                                                                                                                                                                  |
| 7 November 2026 | Level 3 concurrency and cancellation                                | 143 cumulative backend tests passed.                                                                                                                                                                                                  |
| 7 November 2026 | Level 4 idempotency and pagination                                  | 213 cumulative backend tests passed.                                                                                                                                                                                                  |
| 7 November 2026 | Level 5 rolling admission                                           | 255 backend tests passed.                                                                                                                                                                                                             |
| 7 November 2026 | Patient frontend/BFF                                                | 55 frontend tests passed; production build passed.                                                                                                                                                                                    |
| 9 November 2026 | Full assessment audit                                               | 310 tests passed; separate probes found three NUL-input 500s and a dependency review found the Multer high chain.                                                                                                                     |
| 9 November 2026 | Pre-deployment hardening                                            | 323 tests passed; both builds/static checks passed; NUL failures fixed, idle-pool handling tested and high dependency chain patched.                                                                                                  |
| 9 November 2026 | Root README                                                         | Added first-run/API/testing/deployment guidance; documentation checks passed, application suites not rerun.                                                                                                                           |
| 9 November 2026 | Submission documentation cleanup                                    | Consolidated current-state docs and component guides; preserved requirements/specification; removed optional generated JSON from the repository after local archival. Documentation checks only; no application change or deployment. |

Milestone counts are historical. [TESTING.md](TESTING.md) is the source for the latest executed results and limitations.

## Important decisions

- Stack: NestJS/TypeScript, PostgreSQL/Drizzle, Next.js with server-side API proxy.
- Confirmed-slot uniqueness uses the initial partial unique index, backed by transaction row locks; only its named violation becomes 409.
- Cancellation retains original records/fields, allows post-start cancellation and creates no reactivation path.
- Reset validates first and atomically clears all four tables; invalid/duplicate payloads are 400 without mutation.
- Idempotency uses canonical parsed JSON preserving strings; replay/422 precedes admission. Success and deterministic 400/404/409 snapshots remain until reset; infrastructure/429 are not cached.
- Admission uses PostgreSQL rolling 60 seconds and an independent pool so failed attempts remain counted. Child admission must not reacquire parent reset protection.
- History uses signed full-microsecond seek cursors; API_KEY rotation invalidates old cursors.
- NUL read/filter/cancellation input returns owner-approved 400 before SQL; valid identifiers remain unrestricted by UUID/case rules.
- BFF routes remain explicit, private-key/server-only, no-store and bounded by a 15-second upstream deadline. There is no reset proxy or patient identity system.

## Problems addressed

Reproduced NUL text errors were fixed using shared validation rather than blanket database-error mapping. A real idle disconnect exposed missing primary-pool error handling, now sanitized and tested. Broader typechecking corrected a repeated-header test typing mismatch without dropping coverage. Frontend runtime Suspense/public-Host issues were resolved; heavy checks were serialized after a memory-pressure failure. The compatible Nest/Multer update removed the high advisory without forced or major changes.

## Repository documentation policy

The root README is the entry point. API.md owns the contract/policies; ARCHITECTURE.md owns runtime/transaction design; DATABASE.md owns storage; TESTING.md owns commands/results; DEPLOYMENT.md owns environment/hosting; ASSESSMENT_AUDIT.md owns the current compliance matrix. PRD and original specification remain unchanged. Component READMEs contain only component-specific guidance.

Generated audit JSON, traces and other machine output belong in ignored local/CI artifacts. During cleanup, the two existing JSON reports were copied to a local temporary archive outside the repository before removal; that archive is not a reproducible project dependency. Current results, advisory identities and material limits remain in the tracked Markdown. Any future evidence should be sanitized before sharing.

## Documentation cleanup verification

Formatted and checked the ten edited Markdown files; all 94 local file/anchor references across the project guides resolve. Git whitespace checks pass after normalizing the edited root ignore file's line endings. Fingerprints confirm that all 91 protected files other than the intentionally changed .gitignore remain unchanged, including implementation, tests, migrations, packages, AGENTS, PRD and official specification. Archived evidence confirms the recorded 323-test result; application suites/builds were not rerun. The seven core technical guides decreased from 308,608 to approximately 99,000 bytes, while retaining the current contract, design, results and release limits.

## Remaining work

Owner authorization and actual Render/Neon/Vercel setup; hosted TLS/capacity/migration/index checks; HTTPS/persistence smoke tests; operational logging/backups/failover review; remaining development-tool advisory review. No deployment or additional product feature is authorized by documentation cleanup.
