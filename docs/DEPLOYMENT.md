# Deployment and local infrastructure

Updated 7 November 2026. Local PostgreSQL and backend Levels 1–3 have been configured. No API/frontend hosting, HTTPS deployment or Next.js proxy was implemented. Server-side API-key authentication and booking validation are implemented; the full assessment and hosted deployment remain incomplete.

## Local PostgreSQL

compose.yaml runs PostgreSQL 18, with a health check, localhost-only port mapping (default 5433) and named volume clinic_postgres mounted at /var/lib/postgresql. The actual runtime tested was PostgreSQL 18.6. Docker Desktop must use Linux containers.

From the repository root, after configuring backend/.env from the placeholder example if it does not already exist:

```powershell
docker compose --env-file backend/.env up -d --wait
docker compose --env-file backend/.env exec -T postgres psql -U clinic -d postgres -c 'CREATE DATABASE clinic_booking_test'
```

The test database creation command is first-time setup. The compose service initializes clinic_booking as the separate development database. The implementation run used generated credentials in ignored backend/.env.level1-local; substitute that file for backend/.env to reuse it. The existing developer .env was preserved. No secrets are checked in. API_KEY is newly required: configure it privately for API startup; do not assume the Level 1 generated local file already includes it.

## Environment configuration

| Variable | Current use |
| --- | --- |
| DATABASE_URL | Required backend and migration PostgreSQL connection URL. |
| API_KEY | Required server-only API credential; startup rejects missing/blank values, surrounding whitespace and control characters. Never log it, commit it or place it in browser-public environment variables. |
| TEST_DATABASE_URL | Required integration-test connection; explicit database name must end _test; never use production data. |
| POSTGRES_PASSWORD | Required compose initialization password; match both URLs. Applies on first initialization of the named volume. |
| POSTGRES_PORT | Optional compose host port; default 5433. |
| PORT | Backend port; default 3000, example 3001. |
| DOTENV_CONFIG_PATH | Optional dotenv file override for backend startup/migration; e.g. .env.level1-local. |

Backend CLI commands run from backend and load .env by default. Test config reads .env.test/.env.level1-local/.env, points the test application at TEST_DATABASE_URL, and supplies an isolated runtime-generated API_KEY rather than the developer secret. It does not silently fall back to DATABASE_URL. Credentials/password changes on an existing PostgreSQL volume require deliberate database administration; editing the compose environment alone does not reset a persisted password.

## Build, migrations and runtime

```powershell
npm ci
npm run db:migrate
npm run build
npm test
npm run start:prod
```

Run from backend after database initialization. db:generate produces reviewed migrations and db:migrate applies them separately; no startup schema synchronization occurs. dist/main.js is the production entry. DatabaseService checks connectivity and closes its connection pool on application shutdown. Unexpected API errors return generic JSON rather than database details.

For the generated local configuration, set $env:DOTENV_CONFIG_PATH = '.env.level1-local' before migration/start. The test runner discovers that file automatically. Database connections use PostgreSQL timezone UTC. Use provider-supplied SSL connection settings when deployment is separately implemented; no hosted connection was configured/tested here.

## Persistence and remaining deployment work

The Docker named volume survives docker compose down without -v. Integration tests verify database-backed state across requests and an application restart with a new pool. Container/host restart and hosted persistence checks remain later deployment tasks, not claimed as tested here.

Render API, Neon PostgreSQL and Vercel Next.js frontend remain the PRD hosting plan. Levels 1–3 now pass local integration tests. Levels 4–5, the server-only frontend proxy and HTTPS/hosted integration checks remain later authorized work. All six official method/path combinations authenticate; cancellation is implemented while the history handler remains absent. Key rotation requires restart because the configured digest is captured at startup.

Level 3 adds only transactional service/controller behaviour and tests. No environment variable, dependency, database schema/migration, index definition, deployment command or hosting configuration changed.
