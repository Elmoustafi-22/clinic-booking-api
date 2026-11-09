# ClinicSlot

A clinic appointment booking application built for **Koya Cohort 4 — Task 1**. ClinicSlot combines a NestJS REST API, PostgreSQL persistence and a Next.js patient interface.

Patients can browse appointments, filter by provider, book a slot, copy their booking ID, look up or cancel a booking, and browse their booking history. The backend implements all five assessment levels, including database-enforced concurrency safety, durable idempotency, cursor pagination and failed-attempt rate limiting.

## Project status

**Implemented and locally verified; not deployed.** The latest verification, recorded on **9 November 2026**, passed **323 tests**: 267 backend PostgreSQL integration tests, 25 focused BFF tests and 31 production-mode browser/integration tests. Both production builds, TypeScript, ESLint, formatting and Git whitespace checks passed during that hardening task.

These are recorded results, not a promise that every environment or failure scenario has been tested. Hosted HTTPS, Neon TLS, cloud migrations, hosted persistence and operational checks remain release gates. See [testing results](docs/TESTING.md) and the [assessment audit](docs/ASSESSMENT_AUDIT.md).

| Assessment level | Implemented capabilities                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1                | Atomic inventory reset, ordered slot listing, exact provider filtering, booking creation and booking lookup.             |
| 2                | API-key authentication on all six operations, booking validation, normalization, missing-slot and started-slot handling. |
| 3                | Transactional booking/cancellation, row locks and a PostgreSQL partial unique index preventing double-booking.           |
| 4                | Database-backed idempotency and signed, email-bound cursor pagination.                                                   |
| 5                | PostgreSQL-backed rolling 60-second rate limiting, including admitted failed attempts and Retry-After.                   |

## Contents

- [Technology and architecture](#technology-and-architecture)
- [Repository layout](#repository-layout)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Try the API](#try-the-api)
- [API reference](#api-reference)
- [Consistency and database design](#consistency-and-database-design)
- [Testing and quality checks](#testing-and-quality-checks)
- [Production builds and deployment](#production-builds-and-deployment)
- [Security and operational limits](#security-and-operational-limits)
- [Troubleshooting](#troubleshooting)
- [Project documentation](#project-documentation)

## Technology and architecture

| Layer                | Technology                                                           |
| -------------------- | -------------------------------------------------------------------- |
| API                  | NestJS 11, TypeScript, Express                                       |
| Database             | PostgreSQL 18 locally, Drizzle ORM, node-postgres                    |
| Validation           | class-validator and class-transformer, with explicit input checks    |
| Frontend             | Next.js 16.4.5 App Router, React 19.3, TypeScript                    |
| UI                   | Tailwind CSS 4, source-owned shadcn-style controls, Radix components |
| Tests                | Jest, Supertest, Node test runner, Playwright with Chromium          |
| Local infrastructure | Docker Compose                                                       |
| Planned hosting      | Render API, Neon PostgreSQL, Vercel frontend                         |

```text
Browser
  │ same-origin /api requests; no API key in browser code
  ▼
Next.js frontend + server-side BFF
  │ fixed upstream paths + private X-API-Key
  ▼
NestJS API
  │ Drizzle / node-postgres transactions
  ▼
PostgreSQL
```

The browser never connects directly to PostgreSQL or receives the integration API key. Next.js Route Handlers form a backend-for-frontend (BFF), forwarding only the supported patient operations to Nest. Controllers map HTTP inputs and responses; services own validation, booking rules and database transactions.

The API also supports direct assessment clients that send `X-API-Key`. No public Nest root, health endpoint, Swagger UI route or API version prefix has been added. The official specification and [API contract](docs/API.md) document the assessment interface.

## Repository layout

```text
.
├── AGENTS.md                   Engineering and documentation rules
├── README.md                   Project entry point
├── compose.yaml                Local PostgreSQL and persistent volume
├── backend/
│   ├── src/
│   │   ├── auth/               API-key guard and early authentication
│   │   ├── bookings/           Booking, cancellation, history, replay, limiter
│   │   ├── common/             Shared input checks and error envelope
│   │   ├── database/           Drizzle schema, pools, clocks and migrations
│   │   ├── reset/              Atomic inventory replacement
│   │   └── slots/              Ordered listing and exact filtering
│   ├── drizzle/                Committed SQL migrations and metadata
│   └── test/                   PostgreSQL integration suites
├── frontend/
│   ├── app/                    Patient pages and explicit /api handlers
│   ├── components/             Patient flows and shared UI
│   ├── lib/                    Typed client, hooks and server-only proxy
│   └── tests/                  BFF tests and browser/integration tests
└── docs/
    ├── specifications/         Original Koya specification
    └── *.md                    Contract, design, testing and release guides
```

Backend and frontend have separate `package.json` and lockfiles. There is no root npm workspace or root application script; run npm commands from the indicated application directory.

## Local setup

### Prerequisites

- **Node.js 24.x** and npm. The full application was verified with Node 24.14.0; the focused BFF tests use native TypeScript loading.
- **Docker Desktop** with Linux containers and Docker Compose available.
- Git and a terminal. The examples below use **PowerShell** from the repository root unless noted otherwise.
- Available ports: PostgreSQL `5433`, API `3001`, frontend `3000`. Browser tests use separate listeners on `3100` and `3101`.

### 1. Install dependencies

```powershell
Push-Location backend
npm ci --include=dev
Pop-Location

Push-Location frontend
npm ci --include=dev
Pop-Location
```

Development dependencies are needed for migrations, TypeScript/Tailwind builds, linting and tests. Use the committed lockfiles rather than replacing them with an unrelated dependency update.

### 2. Configure private local environment files

Copy the templates only when the destination does not already exist:

```powershell
if (-not (Test-Path backend/.env)) {
  Copy-Item backend/.env.example backend/.env
}
if (-not (Test-Path frontend/.env.local)) {
  Copy-Item frontend/.env.example frontend/.env.local
}
```

In `backend/.env`:

- Choose a local `POSTGRES_PASSWORD` and update the password in **both** database URLs to match. URL-encode reserved password characters in connection URLs.
- Set `DATABASE_URL` to the development database `clinic_booking`.
- Set `TEST_DATABASE_URL` to the separate database `clinic_booking_test`.
- Set a strong, private `API_KEY` and keep `PORT=3001` for the standard local setup.

In `frontend/.env.local`, set `BACKEND_API_URL=http://localhost:3001` and the **same private API_KEY**. Generate and store the key privately, for example with a password manager. Neither variable should have a `NEXT_PUBLIC_` prefix. Never commit environment files or print secrets in logs.

Existing local installations may use ignored `backend/.env.level1-local` or `.env.test` files. Keep them intact and review which configuration will load; see [environment variables](#environment-variables).

### 3. Start PostgreSQL and create the test database

```powershell
docker compose --env-file backend/.env up -d --wait

# First-time setup only; skip if the test database already exists.
docker compose --env-file backend/.env exec -T postgres psql -U clinic -d postgres -c 'CREATE DATABASE clinic_booking_test'
```

Compose creates the **development** database `clinic_booking`. Creating `clinic_booking_test` is a separate first-time step. PostgreSQL binds only to localhost, on port `5433` by default.

### 4. Apply the committed migrations

```powershell
Push-Location backend
npm run db:migrate
Pop-Location
```

This migrates `DATABASE_URL`. Integration suites apply the same migrations to their dedicated test database automatically. Application startup checks connectivity but does **not** apply migrations or create inventory.

### 5. Start the applications

In one terminal, from `backend`:

```powershell
npm run start:dev
```

In another terminal, from `frontend`:

```powershell
npm run dev
```

Open [the local frontend](http://localhost:3000). The API listens on `http://localhost:3001` when using the example environment. An empty slot list is expected until an authorized operator installs inventory.

### 6. Install local demo inventory

Use the authenticated backend `POST /reset` directly; [Try the API](#try-the-api) contains an example. **Reset replaces all inventory and clears all bookings, idempotency records and rate-limit attempts. Use only a disposable local or dedicated test database.** There is no reset button or reset endpoint in the public Next.js BFF.

### Stopping the local database

```powershell
docker compose --env-file backend/.env down
```

The named volume `clinic_postgres` preserves database storage. Adding `-v` deletes that volume and its data; it is not part of normal shutdown. Changing `POSTGRES_PASSWORD` in an environment file does not update an already-initialized database password.

## Environment variables

| Variable             | Location                                     | Purpose                                                                                                                                  |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Backend and migration job                    | Required PostgreSQL writer connection URL.                                                                                               |
| `API_KEY`            | Backend and Next server                      | Shared private integration credential. Required by Nest startup; must be nonblank, without surrounding whitespace or control characters. |
| `BACKEND_API_URL`    | Next server only                             | Fixed API base URL; local example `http://localhost:3001`, HTTPS origin when hosted. No embedded credentials, query or fragment.         |
| `TEST_DATABASE_URL`  | Backend test setup and browser test launcher | Explicit disposable database with a name ending `_test`. Never point tests at production.                                                |
| `POSTGRES_PASSWORD`  | Local Compose configuration                  | Initializes the local PostgreSQL role password on a new volume.                                                                          |
| `POSTGRES_PORT`      | Local Compose configuration                  | Optional host port; defaults to `5433`. Update local URLs if changed.                                                                    |
| `PORT`               | Backend runtime                              | API port; default `3000`, example environment `3001`. Render supplies its own port.                                                      |
| `DOTENV_CONFIG_PATH` | Backend startup/migration shell              | Optional alternative dotenv file, relative to the backend working directory.                                                             |
| `NODE_ENV`           | Hosted runtime                               | Set to `production` for production runtime configuration.                                                                                |

Backend commands normally load `backend/.env`. Backend tests read `.env.test`, `.env.level1-local`, then `.env`, preserving already-set environment values. They require `TEST_DATABASE_URL`, switch the application to it and generate isolated API keys. Browser tests use the same test database configuration and a random shared test-only key for their two servers. Next.js loads its own environment files, including `frontend/.env.local`.

For an existing alternative backend configuration, use `$env:DOTENV_CONFIG_PATH = '.env.level1-local'` from `backend`, and pass `backend/.env.level1-local` to Compose. Restart the relevant process after changing credentials. Rotating API_KEY invalidates old signed history cursors and requires consistent keys across API replicas.

## Try the API

These PowerShell examples target the local development API. Privately set `API_KEY` in the operator shell to match the backend; editing `.env` alone does not export variables into that shell. All names, emails and slot values below are synthetic examples.

### Replace local inventory and list slots

```powershell
if (-not $env:API_KEY) { throw 'Configure the private API_KEY in this shell first.' }
$base = 'http://localhost:3001'
$headers = @{ 'X-API-Key' = $env:API_KEY }
$start = [DateTimeOffset]::UtcNow.AddDays(1)

$inventory = @{
  slots = @(
    @{
      id = 's1'
      provider = 'Dr Ade'
      start = $start.ToString('o')
      end = $start.AddMinutes(30).ToString('o')
    }
  )
} | ConvertTo-Json -Depth 4

# Destructive: disposable local inventory only.
Invoke-RestMethod -Method Post -Uri "$base/reset" -Headers $headers -ContentType 'application/json' -Body $inventory
Invoke-RestMethod -Uri "$base/slots" -Headers $headers
Invoke-RestMethod -Uri "$base/slots?provider=Dr%20Ade" -Headers $headers
```

Reset returns HTTP 200 with `{}`. Listing returns `{ "slots": [...] }`, including past and booked slots, with a boolean `available` on each item. Availability reflects confirmed occupancy; a past slot may be unoccupied but still cannot be booked.

### Create a booking and replay it

```powershell
$bookingHeaders = $headers.Clone()
$bookingHeaders['Idempotency-Key'] = [guid]::NewGuid().ToString()
$body = @{
  slot_id = 's1'
  name = ' Ada Obi '
  email = ' ADA@example.com '
} | ConvertTo-Json

$booking = Invoke-RestMethod -Method Post -Uri "$base/bookings" -Headers $bookingHeaders -ContentType 'application/json' -Body $body

# Same key and same parsed JSON: original 201 and original booking response.
$replay = Invoke-RestMethod -Method Post -Uri "$base/bookings" -Headers $bookingHeaders -ContentType 'application/json' -Body $body

$id = [uri]::EscapeDataString($booking.id)
Invoke-RestMethod -Uri "$base/bookings/$id" -Headers $headers
```

Booking responses contain exactly six fields:

```json
{
  "id": "illustrative-generated-id",
  "slot_id": "s1",
  "name": "Ada Obi",
  "email": "ada@example.com",
  "status": "confirmed",
  "created_at": "2026-11-09T12:00:00.000Z"
}
```

The ID and timestamp above are illustrative. Provider/date/time are joined from the slot inventory by the UI; they are not extra Booking response fields.

### History and cancellation

```powershell
$email = [uri]::EscapeDataString('ada@example.com')
$page = Invoke-RestMethod -Uri "$base/bookings?email=$email&limit=10" -Headers $headers

if ($null -ne $page.next_cursor) {
  $cursor = [uri]::EscapeDataString($page.next_cursor)
  $nextPage = Invoke-RestMethod -Uri "$base/bookings?email=$email&limit=10&cursor=$cursor" -Headers $headers
}

Invoke-RestMethod -Method Delete -Uri "$base/bookings/$id" -Headers $headers
```

History returns `{ "bookings": [...], "next_cursor": "..." }`, with `null` for the last cursor. Cancellation returns the complete Booking with `status: "cancelled"`. A subsequent lookup retains the cancelled record; rebooking creates a new ID. Replaying an earlier successful booking request still returns its original confirmed response, so use lookup for current status.

## API reference

All six Nest operations require `X-API-Key`; missing or invalid credentials return **401 before input validation**. Request bodies use JSON. Every API error uses only:

```json
{ "error": "descriptive message" }
```

| Method and path                       | Success                               | Main validation/domain responses                                                                                                                                             |
| ------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /reset`                         | **200** `{}`                          | **400** invalid payload or duplicate slot IDs; inventory remains unchanged on invalid input.                                                                                 |
| `GET /slots?provider=`                | **200** `{ "slots": [...] }`          | Exact, case-sensitive provider matching; **400** invalid filter input such as decoded NUL.                                                                                   |
| `POST /bookings`                      | **201** six-field Booking             | **400** invalid fields/started slot; **404** missing slot; **409** confirmed occupancy; **422** changed body for an existing key; **429** full email quota with Retry-After. |
| `GET /bookings/{id}`                  | **200** six-field Booking             | **404** missing booking; **400** invalid NUL-containing ID.                                                                                                                  |
| `DELETE /bookings/{id}`               | **200** six-field cancelled Booking   | **404** missing booking; **409** already cancelled; **400** invalid NUL-containing ID.                                                                                       |
| `GET /bookings?email=&limit=&cursor=` | **200** bookings/next_cursor envelope | **400** missing email, invalid limit or malformed/foreign cursor. Default limit 10; allowed range 1–50.                                                                      |

The table combines the official contract with approved implementation policies; [API.md](docs/API.md) distinguishes them precisely. In particular, reset's `{}` body, invalid-text 400 handling and detailed precedence/retention/window rules are owner decisions where the original specification leaves room.

Valid slot IDs retain their exact submitted value; they are not UUID-only or case-normalized. Name/email are trimmed and email is stored lowercase. At appointment start equality, booking is rejected as already started. That check precedes occupancy. Cancellation is allowed after start because the assessment does not prohibit it.

### Frontend routes

| Page             | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `/`              | Ordered appointments, provider filtering and availability states. |
| `/book?slot_id=` | Booking form, confirmation and current-page retry intent.         |
| `/find-booking`  | Booking-ID lookup and cancellation.                               |
| `/history`       | Email-based booking history with cursor continuation.             |

The BFF exposes `GET /api/slots`, `GET/POST /api/bookings` and `GET/DELETE /api/bookings/{id}`. It has no `/api/reset`, `/reset` wrapper or generic upstream proxy. These are frontend wrappers, not additional Koya assessment operations. Appointment times are displayed in the browser's local timezone; backend timestamps are stored consistently in UTC.

## Consistency and database design

PostgreSQL is the authority for booking state. Transactions lock each slot and the confirmed-only unique index prevents double-booking independently of application checks. Cancellation retains the original record and rebooking creates a new ID.

Durable idempotency replays original status/JSON, while cursor history uses signed full-microsecond positions. Rate-limit admission commits independently so failed business attempts count; replay/mismatch precedes admission. Reset replaces all four tables' state atomically.

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): service boundaries, lock order, replay, cursor and admission protocols.
- [DATABASE.md](docs/DATABASE.md): all four tables, constraints, indexes, migration workflow and retention.
- [API.md](docs/API.md): exact request/response contract and approved policies.

Edit the Drizzle schema, generate/review migration SQL and metadata, then apply the committed migrations. Do not use schema push or ad hoc production DDL.

## Testing and quality checks

Tests require real PostgreSQL and an explicit disposable TEST_DATABASE_URL ending _test. Fixtures are reset; do not use production data or run backend/browser suites concurrently against the same test database.

From backend:

```powershell
npm run build
npm test
npx tsc --noEmit
npx eslint src test drizzle.config.ts --max-warnings 0
npx prettier --check src test drizzle.config.ts package.json tsconfig.build.json
```

From frontend after building the backend:

```powershell
npm run build
npm run test:bff
npx playwright install chromium
npm test
npm run typecheck
npx eslint --max-warnings 0
npm run format:check
```

From the root, run git diff --check. Backend npm run lint includes --fix; the command above is read-only. Serialize heavy checks on memory-constrained machines.

The last complete execution passed **267 backend + 25 BFF + 31 browser/integration = 323 tests**. Playwright starts production Next/Nest on 3100/3101 with test-only keys and requires child-process cleanup permissions on Windows. [TESTING.md](docs/TESTING.md) owns suite details, measured results, prior issues and verification limits. Documentation cleanup did not rerun application tests/builds.

## Production builds and deployment

Build from the respective application directory:

```powershell
# backend
npm run build
npm run start:prod
```

```powershell
# frontend
npm run build
npm run start
```

Start these in separate terminals with the correct private environment configuration. Backend production entry is `dist/main.js`. Apply migrations separately before traffic; startup does not migrate the database. Next requires its server/BFF runtime and is not a static-export deployment.

| Platform | Recommended configuration                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Render   | Root `backend`, Node 24.x, build `npm ci --include=dev && npm run build`, pre-release `npm run db:migrate`, start `npm run start:prod`, private API_KEY/DATABASE_URL, supplied PORT. |
| Neon     | Direct writer initially, certificate-verifying `sslmode=verify-full`, separate production/preview/test data and sufficient connection capacity.                                      |
| Vercel   | Root `frontend`, Next.js preset, Node 24.x, install `npm ci --include=dev`, build `npm run build`, private API_KEY and HTTPS BACKEND_API_URL; no frontend database credential.       |

Use Render's default TCP health probe for the existing API contract. An unauthenticated HTTP probe to `/slots` returns 401; no authentication bypass or extra health endpoint exists. TCP health does not continuously certify database readiness. Check migrations, TLS, capacity, HTTPS flows and persistence before promotion. The BFF has a 15-second upstream deadline; configure the hosted function execution budget to accommodate it.

These are recommendations, not provisioned resources or verified hosted results. Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md) for readiness limits, secret scoping, connection pooling, reset administration and release gates. Deployment requires separate owner authorization.

## Security and operational limits

- **Integration authentication is not patient authentication.** ID lookup and email history follow the assessment model and do not prove patient identity. Use synthetic assessment data unless an appropriate real-patient privacy/access design is separately approved.
- **Reset is destructive and uses the same integration key.** Keep that credential on trusted servers; never expose reset through the public UI or use it as a production health check.
- **Secrets stay server-side.** The BFF injects its credential, ignores caller credentials/cookies, restricts upstream paths, refuses redirects and rejects cross-site mutations. It is not a general proxy.
- **Errors stay sanitized.** Expected API errors use `{ "error": "..." }`; unexpected backend failures do not expose SQL, stack traces, connection strings or request secrets. The BFF returns controlled 502/503/504 errors for upstream/configuration/deadline failures and forwards positive integer Retry-After for 429.
- **Mutation timeouts can be ambiguous.** A BFF timeout does not prove a booking rolled back. Retry the unchanged intent with its original idempotency key, then use lookup for current state. The UI's intent key is in memory and does not survive reload/navigation.
- **Durable state needs operational protection.** Patient details and response snapshots remain until reset; attempts also remain until reset, though expired attempts do not count. No automated retention job is implemented.
- **Dependency audits are qualified.** As of the 9 November hardening review, production-only audits report zero findings in both projects; full trees retain backend 27 moderate/5 low and frontend 8 moderate development-tool findings. The Nest/Multer high finding was patched. Build tools may still be present on disk; no full-tree clean-security claim is made.
- **Hosted reliability remains unverified.** Neon TLS/pooler compatibility, cold starts, backups/restore, production access-log redaction, load/failover and HTTPS smoke checks require release verification. Never disable TLS certificate verification to make a connection succeed.

Run `npm audit` and `npm audit --omit=dev` separately in each application when reviewing dependencies. Do not use a forced audit fix or a breaking downgrade as a substitute for compatibility review and regression tests.

## Troubleshooting

| Symptom                                          | Check                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| API does not start                               | API_KEY must be valid; DATABASE_URL must connect; PostgreSQL must be healthy. Startup intentionally fails before listening when initialization fails. |
| Database password authentication fails           | Match URL-encoded credentials to the existing role. An old Docker volume retains its original password even if the environment file changes.          |
| Tables do not exist                              | Run backend `npm run db:migrate` against the intended database. Startup does not create tables.                                                       |
| Frontend shows no appointments                   | An empty database is valid. Seed disposable inventory through authenticated backend reset; refresh the listing.                                       |
| Direct API call returns 401                      | Supply exactly one correct X-API-Key header. `.env` values are not automatically exported into an operator shell.                                     |
| BFF returns 503                                  | Check frontend server-only API_KEY/BACKEND_API_URL and restart Next. The backend key must match.                                                      |
| BFF returns 502/504                              | Check backend reachability/configuration and its 15-second upstream deadline. A hosted frontend cannot connect to your local localhost.               |
| Booking returns 400/409                          | Check required values and email syntax, appointment start against database time, and confirmed occupancy. Started-slot 400 precedes occupancy 409.    |
| Booking returns 429 after failed attempts        | Failed admitted attempts count. Respect Retry-After; another request can still consume available capacity before a retry.                             |
| Idempotency returns 422                          | The key was used with different parsed JSON. Reuse it only for an unchanged intent; use a new key for an intentional new request.                     |
| History cursor returns 400                       | Use the returned token unchanged with the same email context. After API-key rotation or an invalid cursor, restart from the first page.               |
| Tests refuse to run or reset unexpected fixtures | Set an explicit dedicated TEST_DATABASE_URL ending `_test`; inspect `.env.test`/`.env.level1-local` precedence. Never use production data.            |
| Browser setup fails or processes linger          | Free ports 3100/3101, build both applications, install Chromium and permit test process cleanup. Avoid simultaneous heavy checks.                     |

## Project documentation

| Document                                                                     | Purpose                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                                       | Engineering rules, source priority and definition of done.                       |
| [Official Koya PDF](docs/specifications/koya-assessment-api.pdf)             | Original checked-in assessment specification.                                    |
| [Official Koya OpenAPI](https://koyaacademy.com/assessment-api/openapi.json) | Primary authoritative API source; overrides conflicting project interpretations. |
| [PRD.md](docs/PRD.md)                                                        | Product requirements and acceptance criteria.                                    |
| [API.md](docs/API.md)                                                        | Complete API schemas/statuses and separately labelled owner policies.            |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                                      | Service boundaries, transactions, locking and frontend/BFF design.               |
| [DATABASE.md](docs/DATABASE.md)                                              | Schema, relationships, constraints, indexes and migrations.                      |
| [TESTING.md](docs/TESTING.md)                                                | Executed test results, commands and coverage limits.                             |
| [ASSESSMENT_AUDIT.md](docs/ASSESSMENT_AUDIT.md)                              | Requirement-to-implementation/test compliance matrix and hardening follow-up.    |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)                                          | Local infrastructure and recommended Render/Neon/Vercel release configuration.   |
| [CODEX_WORKFLOW.md](docs/CODEX_WORKFLOW.md)                                  | Implementation decisions, verification history and remaining work.               |
| [Frontend README](frontend/README.md)                                        | Frontend flows, BFF behavior and browser tooling.                                |

Patient registration/login, payments, notifications, medical records, calendar integrations and advanced administration are outside this assessment's scope. Follow AGENTS.md and the official specification before changing the API; keep implementation documentation and test evidence aligned with every change.
