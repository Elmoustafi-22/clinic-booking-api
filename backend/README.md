# Backend — Koya Clinic Booking API

Backend foundation and Level 1 only. See ../docs/API.md for the target contract and current implementation boundary, and ../docs/TESTING.md for executed checks. Authentication, full booking validation and Levels 3–5 are deferred; do not deploy this stage publicly.

## Local setup

Use Node.js 20+ and Docker Desktop in Linux-container mode. From backend run npm ci. If .env does not already exist, copy .env.example to .env, choose a local password and update both database URLs to match it. Never overwrite an existing developer .env or commit credentials.

From the repository root:

```powershell
docker compose --env-file backend/.env up -d --wait
docker compose --env-file backend/.env exec -T postgres psql -U clinic -d postgres -c 'CREATE DATABASE clinic_booking_test'
```

The second command is first-time setup only. Development and test databases are separate. From backend:

```powershell
npm run db:migrate
npm run build
npm test
npm run start:dev
```

DATABASE_URL supplies the runtime/migration connection; TEST_DATABASE_URL must identify a dedicated database ending _test. Tests replace all fixture data there and apply committed migrations automatically. Tests fail if PostgreSQL or the dedicated test database is unavailable.

For this implementation run, generated credentials were saved to the ignored .env.level1-local without changing the existing .env. To reuse that local setup, pass backend/.env.level1-local to compose and set DOTENV_CONFIG_PATH=.env.level1-local for backend migration/start commands. Tests automatically read .env.test, .env.level1-local and .env in that order, without overriding already-exported values.

## Database changes

Edit src/database/schema.ts, run npm run db:generate, review and commit generated SQL plus metadata, then apply with npm run db:migrate. Do not use schema push or manual production DDL. Runtime startup checks connectivity but never applies migrations.

The named Docker volume persists database storage across container recreation. docker compose down preserves it; do not add -v unless deliberately deleting local data. PostgreSQL binds to localhost:5433 by default. PORT defaults to 3000; the example sets 3001 to avoid the frontend port.
