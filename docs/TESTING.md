# Testing

## Latest executed verification

The final hardening run on **9 November 2026** passed **323 tests, 0 failed**. These are historical executed results, not tests rerun by the subsequent documentation cleanup. Both production builds and static checks passed. Hosted deployment remains unverified.

| Suite                          | File / command                                                     | Passed  | Recorded duration           |
| ------------------------------ | ------------------------------------------------------------------ | ------- | --------------------------- |
| Level 1                        | [app.e2e-spec.ts](../backend/test/app.e2e-spec.ts)                 | 32      | Included in backend run     |
| Level 2 + hardening            | [level2.e2e-spec.ts](../backend/test/level2.e2e-spec.ts)           | 96      | Included in backend run     |
| Level 3                        | [level3.e2e-spec.ts](../backend/test/level3.e2e-spec.ts)           | 27      | Included in backend run     |
| Level 4 idempotency            | [idempotency.e2e-spec.ts](../backend/test/idempotency.e2e-spec.ts) | 28      | Included in backend run     |
| Level 4 pagination             | [pagination.e2e-spec.ts](../backend/test/pagination.e2e-spec.ts)   | 42      | Included in backend run     |
| Level 5                        | [rate-limit.e2e-spec.ts](../backend/test/rate-limit.e2e-spec.ts)   | 42      | Included in backend run     |
| All backend                    | npm test                                                           | **267** | 174.639 seconds; six suites |
| Focused BFF                    | npm run test:bff                                                   | **25**  | 1257.2807 ms                |
| Production browser/integration | npm test in frontend                                               | **31**  | 4.3 minutes                 |

The final Level 2 rerun after a test-only header typing correction also passed 96/96 in 36.911 seconds. All previous 255 backend and 55 frontend cases were retained.

## Reproducing the suites

Use Node 24.x and Docker PostgreSQL. Complete the [root setup](../README.md#local-setup), create a dedicated database and configure TEST_DATABASE_URL. The database name must end _test; suites fail rather than silently fall back to development/production.

Tests reset fixtures, apply committed migrations and use generated credentials. Backend configuration reads .env.test, .env.level1-local and .env, preserving pre-set variables. Never use production data. Run backend and browser suites sequentially against a shared test database.

From backend:

```powershell
npm ci --include=dev
npm run build
npm test
```

From frontend, after the backend build:

```powershell
npm ci --include=dev
npm run build
npm run test:bff
npx playwright install chromium
npm test
```

Playwright starts production Next on 3100 and compiled Nest on 3101 with a shared random test-only key. Keep both ports free and allow child-process cleanup on Windows. PostgreSQL remains real; selected UI/upstream-fault cases are explicitly controlled. The BFF unit tests control fetch and are not themselves end-to-end database evidence.

## Coverage

| Area          | Executed scenarios                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Level 1       | Exact schemas, ordering/provider filtering, derived availability, arbitrary slot IDs, reset validation/rollback, persistence across requests and a fresh application/pool.                                                                             |
| Level 2       | Missing/empty/incorrect/repeated keys on all six operations; auth before parsing/validation; required/type/blank/email checks; normalization; absent/started/equal-now slots; startup key validation.                                                  |
| Level 3       | Sixteen simultaneous same-slot requests; multiple Nest instances; direct unique-index checks; multiple cancelled rows; concurrent cancellation/rebooking/reset; held-lock time boundary; unrelated DB errors remain 500; rollback/lock release.        |
| Idempotency   | Full original status/body replay; canonical JSON/string distinctions; concurrent same/different keys; mismatch; response-store atomicity; cacheable errors; uncached transient failures; restart/reset behavior.                                       |
| Pagination    | Default/range/invalid limits; both statuses; email isolation; complete traversal; timestamp ties and microseconds; signed/foreign/tampered cursor validation; cross-instance tokens and missing boundary rows.                                         |
| Rate limiting | Failed attempts count; normalized/independent buckets; rolling and exact expiry boundaries; whole-second Retry-After; denied state immutability; concurrent/multi-instance admission; replay precedence; admission/commit failure; reset coordination. |
| Hardening     | Three NUL paths return exact sanitized 400 after red-first reproduction; six missing/incorrect-key precedence cases; valid ID/provider text preservation; real idle-session disconnect with sanitized logging and healthy subsequent request.          |
| Frontend/BFF  | Real listing/booking/lookup/cancellation/replay/history/429; controlled UI errors; retry-intent keys; mobile layout/focus; secret absence; no reset/arbitrary proxy; origin guards; encoded/dot-segment slot IDs; controlled NUL errors.               |

The NUL tests first reproduced three actual 500 responses (PostgreSQL SQLSTATE 22021), then passed after input checks. A real pg_terminate_backend case verifies idle-pool recovery. Test-only triggers/held transactions support fault/concurrency checks and are cleaned up; they are not production migrations.

## Quality commands and recorded results

All commands below passed in the hardening run unless explicitly identified as an advisory result.

From backend:

```powershell
npm run build
npx tsc --noEmit
npx eslint src test drizzle.config.ts --max-warnings 0
npx prettier --check src test drizzle.config.ts package.json tsconfig.build.json
```

From frontend:

```powershell
npm run build
npm run typecheck
npx eslint --max-warnings 0
npm run format:check
```

From the root: git diff --check. Backend npm run lint includes --fix; the command above is read-only. Serialize heavy checks/browser runs on memory-constrained machines.

## Security results

Fresh audits during hardening reported:

| Project  | Full tree                                                   | Production-only audit |
| -------- | ----------------------------------------------------------- | --------------------- |
| Backend  | 32 package findings: 27 moderate, 5 low; zero high/critical | Zero findings; exit 0 |
| Frontend | 8 moderate; zero high/critical                              | Zero findings; exit 0 |

Full audits exit 1 for remaining tooling advisories. The compatible Nest 11.2.9/Multer 2.5.0 patch removed the prior high chain. No force fix, major upgrade or cross-major override was used. See [ASSESSMENT_AUDIT.md](ASSESSMENT_AUDIT.md) for exposure and remaining work. Audit results are dated observations, not a clean-security guarantee.

## Problems resolved and evidence limits

- Initial NUL reproduction intentionally failed three new tests before the fix.
- Broader backend tsc found an existing Supertest repeated-header overload mismatch; object-form headers retained runtime coverage and passed type/test checks.
- Earlier frontend work resolved runtime Suspense and public-Host origin handling. A resource-constrained browser run failed during concurrent heavy checks; serialized final execution passed.
- Native BFF module-type and Playwright color-environment warnings were informational.

Application restart persistence is tested; container/host restart, hosted TLS/pooler behavior, HTTPS deployment, cloud migrations, backups/restore, load/failover, production-log redaction and formal accessibility certification are not established. No dedicated repeated-cancellation-click or real >10-row UI Load more case was executed; related API/controlled UI cases do not replace those claims.

Generated machine reports are optional local/CI artifacts and are not tracked. Test source plus this dated summary and the compliance matrix provide repository evidence. Documentation cleanup performed only Markdown formatting, local-link/anchor checks, protected-file fingerprint checks and Git whitespace checks; it did not rerun application suites/builds.
