# ClinicSlot backend

NestJS/TypeScript API with PostgreSQL and Drizzle ORM. All five assessment levels are implemented and locally verified, including cancellation, durable idempotency, cursor history and failed-attempt rate limiting. The Next.js frontend/BFF is also implemented; hosted deployment is outstanding.

## Start here

Follow the [root README](../README.md#local-setup) for dependency installation, environment files, Docker PostgreSQL, test database creation and API examples. Use Node 24.x for a consistent full-project runtime.

Run these commands from backend:

| Command              | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| npm ci --include=dev | Install locked application/build/test dependencies.             |
| npm run db:migrate   | Apply committed migrations to DATABASE_URL.                     |
| npm run start:dev    | Development API with watch mode.                                |
| npm run build        | Compile production source to dist.                              |
| npm run start:prod   | Start compiled dist/main.js.                                    |
| npm test             | Run all PostgreSQL integration suites serially.                 |
| npm run db:generate  | Generate migration SQL/metadata after a reviewed schema change. |

API_KEY and DATABASE_URL are required. Use PORT=3001 alongside the frontend. Startup checks database connectivity but does not create tables, seed inventory or apply migrations. All six operations, including reset, require X-API-Key.

Tests require TEST_DATABASE_URL ending _test and modify its fixtures. They generate isolated credentials, apply migrations and never silently select the development database. Do not run browser fixtures concurrently against the same database.

## Source guide

- src/auth: reusable key enforcement and early authentication before parsing.
- src/bookings: validation, transactional creation/cancellation, response replay, history and admission.
- src/database: typed pools, Drizzle schema, database clock and migration runner.
- src/common: shared input checks and exact sanitized error envelope.
- src/reset and src/slots: atomic inventory lifecycle and ordered availability.
- drizzle: committed SQL plus required metadata; do not delete or regenerate migration history casually.
- test: real PostgreSQL HTTP/integrity/concurrency/fault suites.

## Quality checks

```powershell
npx tsc --noEmit
npx eslint src test drizzle.config.ts --max-warnings 0
npx prettier --check src test drizzle.config.ts package.json tsconfig.build.json
```

npm run lint includes --fix; use the command above for a read-only check. Generate/review migrations rather than schema push or manual production DDL.

See the [API contract](../docs/API.md), [architecture](../docs/ARCHITECTURE.md), [schema](../docs/DATABASE.md), [test results](../docs/TESTING.md) and [deployment guide](../docs/DEPLOYMENT.md). These documents own the detailed rules; this guide intentionally avoids duplicating them.
