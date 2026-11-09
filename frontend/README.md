# ClinicSlot frontend

Next.js 16.4.5 App Router, React 19.3, TypeScript and Tailwind CSS 4. Patient flows use source-owned controls and Radix AlertDialog; system fonts avoid a remote font dependency. Node 24.x is the verified full-project runtime.

## Local development

Complete the [root setup](../README.md#local-setup), including the backend and PostgreSQL. From frontend, install with npm ci --include=dev, configure private .env.local values and run npm run dev.

| Server-only variable | Value                                                            |
| -------------------- | ---------------------------------------------------------------- |
| BACKEND_API_URL      | Local http://localhost:3001; fixed HTTPS API origin when hosted. |
| API_KEY              | Same private credential as Nest. Never NEXT_PUBLIC_.             |

The frontend needs no database URL. Do not overwrite an existing environment file or commit secrets. Restart Next after environment changes. Inventory is installed directly through the authenticated backend reset, not through the public UI/BFF.

## Patient flows

| Page           | Behavior                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| /              | API-ordered appointments, exact provider filtering, availability filter and refresh/error states.                                    |
| /book?slot_id= | Form validation, pending protection, booking confirmation and copyable ID. Query selection preserves arbitrary/dot-segment slot IDs. |
| /find-booking  | ID lookup, confirmed/cancelled details and cancellation dialog.                                                                      |
| /history       | Email history, returned cursor continuation, deduplication and empty/error states.                                                   |

Times use the browser's local timezone; PostgreSQL validates eligibility. Provider/date/time are joined from slots rather than added to Booking JSON. Lookup/history retain booking information if schedule lookup fails.

One random idempotency key is retained for the unchanged submitted intent, including uncertain retries; edits/new intent rotate it. State is in memory and is lost on reload/navigation. No patient records are persisted in browser storage. There are no patient accounts, payments or notifications.

## Server-side proxy

app/api exposes only GET /slots, GET/POST /bookings and GET/DELETE /bookings/[id] under the frontend /api prefix. The server-only helper injects the private key, preserves supported queries/body/domain responses, encodes path IDs and forwards Retry-After for 429.

There is no reset or generic URL proxy. Requests/responses are no-store; caller cookies/credentials and internal upstream headers are not forwarded. Redirects and foreign-origin mutations are rejected. A 15-second upstream deadline bounds requests; network/configuration/protocol errors are sanitized. Detailed error/status policy belongs in [API.md](../docs/API.md).

This is integration authentication, not patient identity verification. Booking-ID and email lookup follow the assessment's access model.

## Build and verification

Run from frontend:

```powershell
npm run build
npm run start
```

Build before starting production mode. For quality/testing:

```powershell
npm run typecheck
npx eslint --max-warnings 0
npm run format:check
npm run test:bff
npx playwright install chromium
npm test
```

Browser tests need both application builds, the guarded TEST_DATABASE_URL and free ports 3100/3101. They start production Next and compiled Nest with test-only keys, reset only test fixtures and require permission to clean up child processes on Windows. Run them separately from backend fixture suites. Traces/screenshots remain ignored.

[TESTING.md](../docs/TESTING.md) owns current results and limits. [DEPLOYMENT.md](../docs/DEPLOYMENT.md) owns Vercel configuration and unverified release gates. Next needs its server/BFF runtime; do not configure static export. No deployment has been performed.
