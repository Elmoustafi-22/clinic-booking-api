# API contract — official Koya assessment

Updated 9 November 2026. This document records the full official contract plus separately labelled owner policies. The backend foundation and Levels 1–5 are implemented; see TESTING.md for actual results. Specification requirements and owner policies remain distinguished below.

## Implementation status

All six required operations and Levels 1–5 are implemented locally. [TESTING.md](TESTING.md) records executed verification, [ARCHITECTURE.md](ARCHITECTURE.md) explains transaction design, and [DEPLOYMENT.md](DEPLOYMENT.md) records unverified hosted release gates. The sections below distinguish the official contract from approved owner policies.

## Authority and interpretation

Authoritative source: [official OpenAPI JSON](https://koyaacademy.com/assessment-api/openapi.json), OpenAPI 3.0.3, title `Clinic booking API`, version `1.0`, fetched in full on the review date. The checked-in `specifications/koya-assessment-api.pdf` (all nine pages reviewed) is its rendered companion. Root AGENTS.md establishes OpenAPI > PDF > PRD > architecture > implementation precedence. The official files were not modified; no local openapi.json was present during review.

Source fingerprints (SHA-256):

- Local PDF: `7DD78ACB40E657788DA5DC3FC5025A57EB28D04E6231C6CB272694391AC6DF73`.
- Retrieved OpenAPI bytes: `B0B9278576DB1309797271F23C26F4BA828FE5BBDF018F974E670EE0D401F5E6`.

Sections labelled **Specification** state contract requirements. Gaps are explicitly labelled **Unspecified**. Implementation choices belong in ARCHITECTURE.md/DATABASE.md and must not be mistaken for additional assessment requirements. Examples illustrate schema values; they do not prescribe literal error messages or generated IDs.

## Common requirements

**Specification:** everything is JSON. Requests with bodies use `application/json`. Global API-key security applies to all six operations: `X-API-Key` is required and a missing or wrong key returns **401**, even though individual response maps omit 401. The API owner chooses the key. No base URL, route prefix, extra endpoint or health route is specified.

Every error has this JSON structure:

```json
{ "error": "<message>" }
```

`Error.error` is a required, non-null string. The specification does not fix message text; `slot not found` is a shared schema example, not the required message for every failure. Do not return NestJS's default `statusCode/message/error` envelope or an array of validation errors in place of the specified shape.

**Schema details:** the source declares no `additionalProperties: false`, string length bounds, ID patterns, email-format keyword or idempotency-key length/TTL. Do not infer these restrictions. Email validity is nevertheless explicitly required by the POST operation's prose. Date-time fields use the OpenAPI `date-time` format; the samples use UTC `Z`, but no exact fractional-second precision is mandated. Non-null types are used unless explicitly nullable below.

## Shared object schemas

### Slot

All four fields are required:

| Field    | Type              | Contract                                                                   |
| -------- | ----------------- | -------------------------------------------------------------------------- |
| id       | string            | Caller-supplied identifier; arbitrary strings such as `s1`, not UUID-only. |
| provider | string            | Provider name; exact-match query filtering.                                |
| start    | string, date-time | Appointment start.                                                         |
| end      | string, date-time | Appointment end.                                                           |

The source does not declare duplicate-ID error handling, nonblank-string rules, duration or `end > start` validation. Approved reset policies below resolve invalid/duplicate input handling. Past slots are explicitly accepted by reset.

### SlotWithAvailability

All Slot fields plus required `available: boolean`. It is false while a confirmed booking exists. Do not hide booked or past slots from the listing or equate a past slot with a booked slot; started-slot rejection belongs to booking creation.

### NewBooking

Required JSON object fields:

| Field   | Type   | Contract                                                             |
| ------- | ------ | -------------------------------------------------------------------- |
| slot_id | string | Required and nonempty. Refers to a supplied slot.                    |
| name    | string | Required and nonempty; trim spaces.                                  |
| email   | string | Required and nonempty; valid email; trim spaces and store lowercase. |

Missing/empty fields or an invalid email return 400. The schema has no additional request fields, but does not prohibit additional properties. It does not require trimming `slot_id` or changing provider/ID case.

### Booking

All six fields are required:

| Field      | Type              | Contract                                       |
| ---------- | ----------------- | ---------------------------------------------- |
| id         | string            | Any unique ID generated by the implementation. |
| slot_id    | string            | Booked slot ID.                                |
| name       | string            | Trimmed name.                                  |
| email      | string            | Trimmed, lowercase email.                      |
| status     | string enum       | `confirmed` or `cancelled`.                    |
| created_at | string, date-time | Creation timestamp.                            |

The contract has no nested slot object, provider, start/end or cancelled_at field in Booking. Internal columns must not leak into responses. Booking response examples below use an illustrative generated ID and timestamp.

## 1. POST /reset — Level 1

**Specification:** delete every booking and replace the complete slot inventory with the submitted slots, including past slots.

Required JSON body: an object with required `slots`, an array of Slot objects. No minimum or maximum item count is specified, so an empty array is schema-valid. There is no fixed seed dataset.

```json
{
  "slots": [
    {
      "id": "s1",
      "provider": "Dr Ade",
      "start": "2026-12-10T09:00:00Z",
      "end": "2026-12-10T09:30:00Z"
    }
  ]
}
```

Responses:

| Status | Meaning               | Body                                    |
| ------ | --------------------- | --------------------------------------- |
| 200    | Done                  | No response content/schema is declared. |
| 401    | Missing/wrong API key | Error JSON, from the global rule.       |

**Unspecified:** exact success JSON, invalid reset-body status, duplicate IDs, nonblank slot strings, inverted intervals, and whether idempotency/rate-limit data is cleared. The global JSON statement does not supply a success body. Do not claim `{ "success": true }`, `{}`, a slot count, an empty body or 204 is mandated.

## 2. GET /slots — Level 1

Optional query `provider: string`: exact provider-name match. No body. Return every matching slot, earliest `start` first, including booked/past slots.

**200 application/json:**

```json
{
  "slots": [
    {
      "id": "s1",
      "provider": "Dr Ade",
      "start": "2026-12-10T09:00:00Z",
      "end": "2026-12-10T09:30:00Z",
      "available": true
    }
  ]
}
```

`slots` is an array of SlotWithAvailability; an empty result is represented by an empty array. Global 401 applies. The wrapper's `slots` property is defined but omitted from a formal `required` list in OpenAPI; consistently returning the documented property preserves the described listing contract. No tie-break order or provider normalization rule is specified.

## 3. POST /bookings — Levels 1–5

Required JSON body: NewBooking. Optional `Idempotency-Key: string` request header. Global `X-API-Key` still applies.

```json
{ "slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com" }
```

**201 application/json:** the Booking object directly, without a `booking` envelope:

```json
{
  "id": "generated-id",
  "slot_id": "s1",
  "name": "Ada Obi",
  "email": "ada@example.com",
  "status": "confirmed",
  "created_at": "2026-11-06T16:00:00Z"
}
```

| Status | Required condition                                                                    | Body / headers                                                        |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 201    | New booking succeeds (Level 1)                                                        | Booking with status confirmed.                                        |
| 400    | slot_id/name/email missing or empty, invalid email, or slot already started (Level 2) | Error JSON.                                                           |
| 401    | Missing/wrong API key (global Level 2)                                                | Error JSON.                                                           |
| 404    | Slot does not exist (Level 2)                                                         | Error JSON.                                                           |
| 409    | Slot already has a confirmed booking, including simultaneous requests (Level 3)       | Error JSON.                                                           |
| 422    | Same Idempotency-Key with a different body (Level 4)                                  | Error JSON.                                                           |
| 429    | Sixth attempt for an email within the per-minute allowance (Level 5)                  | Error JSON and required `Retry-After`, integer whole seconds to wait. |

**Idempotency requirement:** same key and same body returns the same response, specifically the same status code and booking ID, and never creates another booking. Without the optional header no idempotency guarantee is declared. The source does not define canonical body equivalence, key scope/lifetime, failure caching or interaction with rate limiting.

**Limiter requirement:** at most five attempts per email per minute, failed attempts included. The sixth returns 429. Other emails are unaffected. The source does not specify rolling/fixed windows, whether 429 attempts prolong the window, handling of absent/invalid-email buckets, or whether replay/mismatched-key requests consume quota. These gaps must not be replaced by undocumented assumptions.

## 4. GET /bookings/{id} — Level 1

Required path parameter `id: string`; no UUID pattern is prescribed. No request body or query parameters are declared.

| Status | Meaning                 | Body              |
| ------ | ----------------------- | ----------------- |
| 200    | Found                   | Booking directly. |
| 404    | No booking with that ID | Error JSON.       |
| 401    | Missing/wrong API key   | Error JSON.       |

There is no status filter or instruction to conceal cancelled records. Return the stored booking with its current status; cancellation does not make it a nonexistent ID.

## 5. DELETE /bookings/{id} — Level 3

Required path parameter `id: string`; no body. Set status to cancelled and free the slot.

| Status | Meaning                   | Body                        |
| ------ | ------------------------- | --------------------------- |
| 200    | Cancellation succeeds     | Cancelled Booking directly. |
| 404    | No booking with that ID   | Error JSON.                 |
| 409    | Booking already cancelled | Error JSON.                 |
| 401    | Missing/wrong API key     | Error JSON.                 |

Successful body example, following the operation's required behaviour:

```json
{
  "id": "generated-id",
  "slot_id": "s1",
  "name": "Ada Obi",
  "email": "ada@example.com",
  "status": "cancelled",
  "created_at": "2026-11-06T16:00:00Z"
}
```

**Resolved example conflict:** the PDF's generated Booking sample shows confirmed even for DELETE. The operation explicitly says to set cancelled and its 200 description is the cancelled booking. Those definitive instructions govern; do not return confirmed after successful cancellation. No past-appointment cancellation restriction is stated; do not add one.

## 6. GET /bookings — Level 4

No body. Query parameters:

| Name   | Required | Type / rule                                                                 |
| ------ | -------- | --------------------------------------------------------------------------- |
| email  | yes      | string; case-insensitive match.                                             |
| limit  | no       | integer 1–50 inclusive; default 10; anything outside this rule returns 400. |
| cursor | no       | string; pass the previous next_cursor as cursor.                            |

**200 application/json:**

```json
{
  "bookings": [
    {
      "id": "generated-id",
      "slot_id": "s1",
      "name": "Ada Obi",
      "email": "ada@example.com",
      "status": "confirmed",
      "created_at": "2026-11-06T16:00:00Z"
    }
  ],
  "next_cursor": null
}
```

Return the person's bookings oldest first. `bookings` is an array of Booking; `next_cursor` is a nullable string. Return a string to continue and null on the last page. Empty history therefore has `bookings: []` and `next_cursor: null`. No confirmed-only filter is specified; both booking statuses belong to the person's history. Both envelope properties are defined but not formally included in an OpenAPI `required` array; return both consistently according to the operation description.

| Status | Meaning               | Body            |
| ------ | --------------------- | --------------- |
| 200    | A page of bookings    | Envelope above. |
| 400    | Invalid limit         | Error JSON.     |
| 401    | Missing/wrong API key | Error JSON.     |

**Unspecified:** error status for missing/invalid email, malformed/foreign/stale cursor, cursor encoding and snapshot semantics. Required email does not by itself specify the error status or require email-format validation on this GET. Creation's email-validation rule must not silently be extended into a new documented GET contract.

## Complete status inventory

| Operation             | Explicit operation responses | Global response |
| --------------------- | ---------------------------- | --------------- |
| POST /reset           | 200                          | 401             |
| GET /slots            | 200                          | 401             |
| POST /bookings        | 201, 400, 404, 409, 422, 429 | 401             |
| GET /bookings/{id}    | 200, 404                     | 401             |
| DELETE /bookings/{id} | 200, 404, 409                | 401             |
| GET /bookings         | 200, 400                     | 401             |

Complete required status set: **200, 201, 400, 401, 404, 409, 422, 429**. The source does not declare 204, 403, 405, infrastructure-failure codes, reset-validation codes or statuses for several invalid-query cases. Framework defaults must not be presented as official requirements. All error responses, including any implementation-defined ones later approved, must retain the common Error shape.

## Owner-approved implementation policies

Approved 6 November 2026. These resolve gaps in the official source; they do not modify the official specification. Earlier **Unspecified** notes describe source omissions, resolved as follows where applicable.

| Topic                        | Approved policy                                                                                                                         | Current state                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Reset success/errors         | 200 with {}; invalid payloads and duplicate slot IDs return 400 without modifying existing state                                        | Implemented.                                                                                                                  |
| Reset lifecycle              | Atomically clear bookings, slots, idempotency records and rate-limit attempts, then install submitted inventory                         | Implemented.                                                                                                                  |
| Retry precedence             | Matching idempotency keys replay the original response and changed bodies return 422 before rate limiting                               | Implemented before admission.                                                                                                 |
| Same-body identity           | Canonicalized parsed JSON preserving submitted strings; object key order/JSON formatting do not matter                                  | Implemented, including nested/unknown fields and retained array order.                                                        |
| Response retention           | Retain until reset; cache successful bookings and deterministic domain errors, not transient infrastructure failures or 429             | Implemented: 201 and deterministic DTO/business 400/404/409; parser/auth/mismatch/infrastructure errors are not newly cached. |
| Limit algorithm              | PostgreSQL rolling 60 seconds; count admitted attempts, including failed validation/business attempts when a usable email bucket exists | Implemented.                                                                                                                  |
| Rejected/email-less attempts | Denied 429 does not extend the window; missing/unusable email gets normal validation error without a shared bucket                      | Implemented.                                                                                                                  |
| History error policy         | Missing email or malformed/foreign cursor returns 400 Error JSON                                                                        | Implemented.                                                                                                                  |
| Started/occupied precedence  | Return started-slot 400 before checking occupancy                                                                                       | Implemented, including a fresh clock check after the row lock is acquired.                                                    |
| Cancellation/history         | Include cancelled bookings in history and allow cancellation after appointment start                                                    | Implemented.                                                                                                                  |

The official operation-status matrix remains unchanged. Additional policy-defined responses are reset 400 and history 400 for missing email/malformed/foreign cursors. Unexpected infrastructure failures currently use generic 500 {error: "internal server error"}; this is implementation handling, not an official declared status.

Reset checks required object/array/string types and timezone-qualified date-time values, accepts past/empty inventories, ignores unknown properties, and adds no duration/end-after-start rule. Because PostgreSQL text cannot contain a NUL character, it is rejected as invalid input with 400. Exact error wording is implementation-defined; only the Error envelope is required.

Source omissions do not justify arbitrary key/field size limits, exact timestamp spelling or extra endpoints. The implemented input, identity and cursor policies below resolve the relevant behavior without changing the official contract.

## Input and response policies

These details implement approved behavior; they are not additional requirements attributed to the official source.

- Reset validates complete object/array/string/date-time input before destructive work, ignores unknown properties, accepts past slots and empty inventories, and adds no end-after-start rule.
- Booking requires nonblank string slot_id/name/email. Name/email are trimmed; email uses class-validator IsEmail with its optional maximum-length check disabled and is stored lowercase. slot_id retains its submitted case/whitespace if nonblank. No arbitrary name/ID length, UUID, provider/domain whitelist or unknown-property restriction is added.
- Invalid PostgreSQL text is rejected before SQL. GET/DELETE /bookings/{id} with decoded NUL return 400 {"error":"id must be a string"}; GET /slots with NUL provider returns 400 {"error":"provider must be a string"}. Authentication remains first. Valid absent IDs return 404; valid unmatched providers return 200 with an empty slots array.
- Cancellation preserves all original public fields except status, keeps records, permits post-start cancellation and never reactivates a cancelled row. Rebooking creates a new ID.
- Unexpected infrastructure failures return sanitized 500 {"error":"internal server error"}. They are not converted into domain conflicts.

## Idempotency contract details

Canonical parsed JSON recursively sorts object properties, preserves array order/types/submitted strings and includes unknown properties. JSON transport formatting/property order do not matter; name/email whitespace/case changes are different bodies even if normalized storage would match. A present empty Idempotency-Key is supported; no arbitrary key length or UUID rule is added.

Replay returns the original status and JSON values, including after cancellation or restart. It does not promise byte-for-byte property order or transport Date headers. Cache 201 and deterministic validation/business 400/404/409 until reset; do not newly cache authentication 401, mismatch 422, admission 429, parser/canonicalization failures or infrastructure errors. A successful booking and its snapshot commit together; failed snapshot storage rolls both back.

## History and rate-limit policies

History accepts one nonblank email string and matches trim/lowercase; it does not extend POST email-syntax validation to GET. Missing/blank/repeated email, invalid/repeated limit, or malformed/repeated/foreign cursor returns 400. Limit defaults to 10; decimal-digit integers 1–50 are supported. Both statuses are ordered by (created_at, id). A valid signed cursor need not refer to a still-present row; it is not a frozen snapshot. Key rotation invalidates old cursors.

Admission counts any nonblank string email after trim/lowercase, including invalid syntax. Missing/null/blank/non-string emails have no shared bucket. Unauthorized or unparseable requests do not reach admission. New attempts are counted before full validation/business work, so a full bucket returns 429 before those errors. Matching idempotency replay and mismatched-body 422 come first.

The rolling interval is (PostgreSQL now - 60 seconds, now]. A denied request returns {"error":"too many booking attempts"} and Retry-After as a positive whole-second ceiling until the oldest active event expires. Denials do not extend the window or create an idempotency record. Committed admission survives later booking failure; admission infrastructure failures fail closed with sanitized 500. Retry-After is guidance, not reserved capacity.

## ClinicSlot frontend BFF mapping (implementation; not new Koya endpoints)

The patient frontend calls fixed same-origin Next.js routes. These wrappers do not change the NestJS contract or constitute additional assessment endpoints.

| Browser method/path                     | Authenticated Nest method/path      |
| --------------------------------------- | ----------------------------------- |
| GET /api/slots?provider=                | GET /slots?provider=                |
| POST /api/bookings                      | POST /bookings                      |
| GET /api/bookings?email=&limit=&cursor= | GET /bookings?email=&limit=&cursor= |
| GET /api/bookings/{id}                  | GET /bookings/{id}                  |
| DELETE /api/bookings/{id}               | DELETE /bookings/{id}               |

No /api/reset, /reset wrapper or arbitrary-URL proxy exists. Server-only API_KEY and BACKEND_API_URL are never browser configuration. Supported query values (including duplicates), body strings, optional Idempotency-Key, success/error domain status and JSON are forwarded; path IDs/query values are encoded without UUID/case normalization. Retry-After is forwarded for 429. Browser-origin mutation protection rejects foreign Origin / cross-site requests with BFF-only 403. Other BFF-only errors are 400 unreadable/unsafe request, 503 invalid/missing configuration, 502 unavailable/malformed/redirecting upstream and 504 after a 15-second deadline. Upstream 5xx keep their status and use a sanitized {error: string}; raw internal responses are never exposed. Successful Booking remains exactly six fields; provider/date/time are joined in presentation from GET /slots, with a slot-reference fallback.

All BFF responses use Cache-Control: no-store. Client credentials/cookies/internal backend headers are not forwarded. No patient login is implied: email history and booking-ID lookup do not verify identity. Frontend behavior and idempotency-intent lifetime are documented in ARCHITECTURE.md and frontend/README.md. These are frontend implementation policies, not claims about unspecified Koya requirements.
