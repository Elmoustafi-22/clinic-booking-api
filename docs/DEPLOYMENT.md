# Deployment and local infrastructure

Updated 9 November 2026. **The application is locally verified, not deployed.** This guide contains recommended configuration and release gates, not provisioned resources or hosted verification. Start with the [root setup](../README.md#local-setup).

## Environment requirements

| Variable           | Consumer                  | Requirement                                                                                                                                          |
| ------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DATABASE_URL       | Nest and migration job    | Required PostgreSQL writer URL; private.                                                                                                             |
| API_KEY            | Nest and Next server      | Same strong private credential. Nest rejects missing/blank, surrounding whitespace and control characters at initialization. Never use NEXT_PUBLIC_. |
| BACKEND_API_URL    | Next server               | Fixed API origin; localhost:3001 locally, HTTPS when hosted. No embedded credentials/query/fragment.                                                 |
| TEST_DATABASE_URL  | Integration/browser tests | Explicit disposable database whose name ends _test. Never production.                                                                                |
| POSTGRES_PASSWORD  | Local Compose             | Initial role password on a new volume; match URL credentials.                                                                                        |
| POSTGRES_PORT      | Local Compose             | Optional host port, default 5433.                                                                                                                    |
| PORT               | Nest runtime              | Default 3000; local example 3001; Render supplies its port.                                                                                          |
| DOTENV_CONFIG_PATH | Backend shell             | Optional alternative dotenv file for startup/migration.                                                                                              |
| NODE_ENV           | Hosted runtime            | production; explicitly include development dependencies when building/migrating.                                                                     |

Backend commands load .env by default; tests read .env.test/.env.level1-local/.env while preserving pre-set variables. Next loads its own environment, normally .env.local locally. Never overwrite an existing environment file or put production secrets into a test configuration.

All API replicas need the same API_KEY for cursor portability. Rotation requires API restart, coordinated BFF secret replacement and a new frontend deployment; old cursors become invalid. Idempotency records remain independent of the secret and persist until reset.

## Local database

compose.yaml runs PostgreSQL 18, binds 127.0.0.1:5433 by default, checks pg_isready and persists to clinic_postgres at /var/lib/postgresql. The verified runtime was PostgreSQL 18.6. Docker Desktop must use Linux containers.

From the root after configuring backend/.env:

```powershell
docker compose --env-file backend/.env up -d --wait
# First-time test database creation only.
docker compose --env-file backend/.env exec -T postgres psql -U clinic -d postgres -c 'CREATE DATABASE clinic_booking_test'
```

Compose initializes clinic_booking for development. Test database creation is separate. For an existing .env.level1-local installation, substitute that file for Compose and set DOTENV_CONFIG_PATH=.env.level1-local when starting/migrating from backend.

docker compose down preserves the named volume; -v removes data. Changing the environment password does not change an initialized database role. Application restart persistence is tested; container/host restart is not certified.

## Render API recommendation

- Node web service; root backend; Node 24.x (local verification used 24.14.0).
- Build: npm ci --include=dev && npm run build.
- Before release traffic: run npm run db:migrate once against the intended direct writer. Use a pre-deploy command where supported, otherwise a controlled migration job.
- Start: npm run start:prod (dist/main.js).
- Private API_KEY/DATABASE_URL; NODE_ENV=production; use Render's supplied PORT.
- Keep auto-deploy off until release authorization; review CI gates before later enabling it.

Migration uses ts-node, so its environment needs development dependencies. Runtime never synchronizes schema. Preserve committed SQL and migration metadata; do not use manual production DDL or schema push.

Startup validates the key and queries PostgreSQL before listening. Use Render's default TCP health probe: an unauthenticated HTTP /slots probe receives 401 and is considered unhealthy. Do not weaken authentication or add an undocumented health route. TCP probes do not continuously verify PostgreSQL or migration completeness; a protected external read-only synthetic check can cover that gap.

References: [Render deployment phases](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks), [Node versions](https://render.com/docs/node-version).

## Neon PostgreSQL recommendation

Use a separate production database/branch and isolated preview/test data. Initially use the **direct writer** connection with sslmode=verify-full, retaining the provider hostname for certificate verification. DATABASE_URL supplies TLS options to primary, admission and migration connections. Never disable certificate checks with NODE_TLS_REJECT_UNAUTHORIZED=0, rejectUnauthorized=false or a no-verify URL.

The application does not combine explicit SSL objects with URL SSL settings; node-postgres warns that those can overwrite one another. A publicly trusted Neon certificate should not need a custom CA file. Actual hosted TLS must still be checked.

Budget up to **14 writer connections per API replica** (primary max 10 plus admission max 4), plus migration/administration headroom. Booking parents retain clients while admission independently commits: a large pooler client limit does not ensure sufficient underlying writer capacity.

Neon pooling uses PgBouncer transaction mode. The application uses transaction-scoped locks, but startup session options and independent admission have not been tested through that pooler. Prefer the direct connection initially; do not certify pooler compatibility from local results. Do not use lagging replicas for coordinated operations. Consider wake-up latency against the BFF deadline and keep compute warm if required.

References: [Neon security](https://neon.com/docs/connect/connect-securely), [pooling](https://neon.com/docs/connect/connection-pooling), [node-postgres SSL](https://node-postgres.com/features/ssl).

## Pooling, timeouts and shutdown

The primary pool uses a 30-second acquisition timeout and default maximum 10. Admission uses maximum 4, 30-second acquisition timeout, 15-second lock timeout and 20-second statement timeout. Both use UTC and close on graceful shutdown. Idle connection errors produce fixed sanitized messages; recovery from a real primary idle disconnect is integration-tested.

Admission fails closed with sanitized 500; there is no in-memory fallback. No retry layer or general primary transaction deadline is implemented. External lock holders, outages and ambiguous commit acknowledgments remain operational risks. A BFF timeout does not prove the upstream mutation rolled back; recover an uncertain booking using its original idempotency key.

## Vercel frontend recommendation

- Root frontend; Next.js preset; Node 24.x.
- Install npm ci --include=dev; build npm run build; keep default Next server/output settings, not static export.
- Set private API_KEY matching Nest and HTTPS BACKEND_API_URL for each intended Production/Preview environment. No frontend database URL or NEXT_PUBLIC credential.
- Redeploy after environment changes. Allow execution above the existing 15-second upstream deadline, e.g. 30 seconds subject to the selected plan.
- A hosted function cannot reach the developer machine's localhost.

Browser requests stay same-origin with the Next BFF; Nest does not enable CORS and does not need wildcard CORS. The BFF permits only patient paths, refuses redirects/arbitrary targets and rejects foreign-origin mutations. Neither /api/reset nor a /reset wrapper exists; both are tested 404.

References: [Vercel build settings](https://vercel.com/docs/builds/configure-a-build), [environment scoping](https://vercel.com/docs/environment-variables), [function duration](https://vercel.com/docs/functions/configuring-functions/duration).

## Security and release gates

POST /reset remains authenticated by the same integration key as the other operations because Koya requires it. Possession grants destructive reset access; no separate admin identity exists. Keep the key only on trusted servers/assessment clients, restrict platform access and never reset production as a smoke/health check. The public BFF does not expose this capability.

Booking ID/email lookup is the assessment access model, not patient authentication. Use synthetic assessment data unless real-patient privacy/access requirements are separately approved. Protect retained bookings/response snapshots and hashed attempts; no automated retention cleanup is implemented.

Keep headers, bodies, lookup queries, connection strings and patient responses out of application/platform logs. Sanitized code paths do not certify hosted access-log redaction. Development dependencies may remain in build directories even when production-only audits are clear; do not expose development servers or CLIs.

Before release:

1. Obtain owner deployment authorization and provision environment-specific resources/secrets.
2. Verify writer TLS, capacity, migrations and the confirmed-only unique index; configure backups and review restore procedures.
3. Verify HTTPS listing/booking/lookup/history/cancellation/replay/429 with isolated inventory.
4. Inspect browser assets/requests for secret absence and confirm reset remains unavailable through Next.
5. Review monitoring, access logs, latency/cold starts, persistence, failover and remaining tooling advisories before promotion.

No cloud resource, production secret or deployment was created by documentation cleanup. [TESTING.md](TESTING.md) and [ASSESSMENT_AUDIT.md](ASSESSMENT_AUDIT.md) distinguish executed local evidence from these unverified gates.
