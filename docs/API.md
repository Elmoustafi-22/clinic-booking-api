# API contract — official Koya assessment

Updated 6 November 2026. This document records the full official contract plus separately labelled owner policies. The backend foundation and Level 1 are implemented; see TESTING.md for actual results. Later-level contracts below remain requirements, not claims of implemented behaviour.

## Current implementation boundary

Implemented: POST /reset (200 {}), GET /slots, POST /bookings (Level 1 creation only), GET /bookings/{id}. No GET /, GET /bookings history or DELETE cancellation route exists. Names/emails are stored canonically and basic object/string input checks protect writes, but full Level 2 required/nonempty/email/start validation is deferred. The partial unique index exists; controlled duplicate-slot 409 handling and concurrent-request acceptance tests are deferred to Level 3. A duplicate insert currently returns generic 500 while the index prevents a duplicate row.

Per the explicit Level 1-only authorization, there is no API-key guard yet. Global authentication described below is the target contract for Level 2, not current runtime behaviour. Idempotency headers and rate limiting are not processed yet; their tables exist only for foundation/reset lifecycle support. The Level 1 server is not ready for external deployment.

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
{"error":"<message>"}
```

`Error.error` is a required, non-null string. The specification does not fix message text; `slot not found` is a shared schema example, not the required message for every failure. Do not return NestJS's default `statusCode/message/error` envelope or an array of validation errors in place of the specified shape.

**Schema details:** the source declares no `additionalProperties: false`, string length bounds, ID patterns, email-format keyword or idempotency-key length/TTL. Do not infer these restrictions. Email validity is nevertheless explicitly required by the POST operation's prose. Date-time fields use the OpenAPI `date-time` format; the samples use UTC `Z`, but no exact fractional-second precision is mandated. Non-null types are used unless explicitly nullable below.

## Shared object schemas

### Slot

All four fields are required:

| Field | Type | Contract |
| --- | --- | --- |
| id | string | Caller-supplied identifier; arbitrary strings such as `s1`, not UUID-only. |
| provider | string | Provider name; exact-match query filtering. |
| start | string, date-time | Appointment start. |
| end | string, date-time | Appointment end. |

No slot uniqueness, nonblank-string, duration or `end > start` validation rule is declared in the source; reset handling for invalid/duplicate slots is a remaining gap. Past slots are explicitly accepted by reset.

### SlotWithAvailability

All Slot fields plus required `available: boolean`. It is false while a confirmed booking exists. Do not hide booked or past slots from the listing or equate a past slot with a booked slot; started-slot rejection belongs to booking creation.

### NewBooking

Required JSON object fields:

| Field | Type | Contract |
| --- | --- | --- |
| slot_id | string | Required and nonempty. Refers to a supplied slot. |
| name | string | Required and nonempty; trim spaces. |
| email | string | Required and nonempty; valid email; trim spaces and store lowercase. |

Missing/empty fields or an invalid email return 400. The schema has no additional request fields, but does not prohibit additional properties. It does not require trimming `slot_id` or changing provider/ID case.

### Booking

All six fields are required:

| Field | Type | Contract |
| --- | --- | --- |
| id | string | Any unique ID generated by the implementation. |
| slot_id | string | Booked slot ID. |
| name | string | Trimmed name. |
| email | string | Trimmed, lowercase email. |
| status | string enum | `confirmed` or `cancelled`. |
| created_at | string, date-time | Creation timestamp. |

The contract has no nested slot object, provider, start/end or cancelled_at field in Booking. Internal columns must not leak into responses. Booking response examples below use an illustrative generated ID and timestamp.

## 1. POST /reset — Level 1

**Specification:** delete every booking and replace the complete slot inventory with the submitted slots, including past slots.

Required JSON body: an object with required `slots`, an array of Slot objects. No minimum or maximum item count is specified, so an empty array is schema-valid. There is no fixed seed dataset.

```json
{
  "slots": [
    {"id":"s1","provider":"Dr Ade","start":"2026-12-10T09:00:00Z","end":"2026-12-10T09:30:00Z"}
  ]
}
```

Responses:

| Status | Meaning | Body |
| --- | --- | --- |
| 200 | Done | No response content/schema is declared. |
| 401 | Missing/wrong API key | Error JSON, from the global rule. |

**Unspecified:** exact success JSON, invalid reset-body status, duplicate IDs, nonblank slot strings, inverted intervals, and whether idempotency/rate-limit data is cleared. The global JSON statement does not supply a success body. Do not claim `{ "success": true }`, `{}`, a slot count, an empty body or 204 is mandated.

## 2. GET /slots — Level 1

Optional query `provider: string`: exact provider-name match. No body. Return every matching slot, earliest `start` first, including booked/past slots.

**200 application/json:**

```json
{
  "slots": [
    {"id":"s1","provider":"Dr Ade","start":"2026-12-10T09:00:00Z","end":"2026-12-10T09:30:00Z","available":true}
  ]
}
```

`slots` is an array of SlotWithAvailability; an empty result is represented by an empty array. Global 401 applies. The wrapper's `slots` property is defined but omitted from a formal `required` list in OpenAPI; consistently returning the documented property preserves the described listing contract. No tie-break order or provider normalization rule is specified.

## 3. POST /bookings — Levels 1–5

Required JSON body: NewBooking. Optional `Idempotency-Key: string` request header. Global `X-API-Key` still applies.

```json
{"slot_id":"s1","name":"Ada Obi","email":"ada@example.com"}
```

**201 application/json:** the Booking object directly, without a `booking` envelope:

```json
{"id":"generated-id","slot_id":"s1","name":"Ada Obi","email":"ada@example.com","status":"confirmed","created_at":"2026-11-06T16:00:00Z"}
```

| Status | Required condition | Body / headers |
| --- | --- | --- |
| 201 | New booking succeeds (Level 1) | Booking with status confirmed. |
| 400 | slot_id/name/email missing or empty, invalid email, or slot already started (Level 2) | Error JSON. |
| 401 | Missing/wrong API key (global Level 2) | Error JSON. |
| 404 | Slot does not exist (Level 2) | Error JSON. |
| 409 | Slot already has a confirmed booking, including simultaneous requests (Level 3) | Error JSON. |
| 422 | Same Idempotency-Key with a different body (Level 4) | Error JSON. |
| 429 | Sixth attempt for an email within the per-minute allowance (Level 5) | Error JSON and required `Retry-After`, integer whole seconds to wait. |

**Idempotency requirement:** same key and same body returns the same response, specifically the same status code and booking ID, and never creates another booking. Without the optional header no idempotency guarantee is declared. The source does not define canonical body equivalence, key scope/lifetime, failure caching or interaction with rate limiting.

**Limiter requirement:** at most five attempts per email per minute, failed attempts included. The sixth returns 429. Other emails are unaffected. The source does not specify rolling/fixed windows, whether 429 attempts prolong the window, handling of absent/invalid-email buckets, or whether replay/mismatched-key requests consume quota. These gaps must not be replaced by undocumented assumptions.

## 4. GET /bookings/{id} — Level 1

Required path parameter `id: string`; no UUID pattern is prescribed. No request body or query parameters are declared.

| Status | Meaning | Body |
| --- | --- | --- |
| 200 | Found | Booking directly. |
| 404 | No booking with that ID | Error JSON. |
| 401 | Missing/wrong API key | Error JSON. |

There is no status filter or instruction to conceal cancelled records. Return the stored booking with its current status; cancellation does not make it a nonexistent ID.

## 5. DELETE /bookings/{id} — Level 3

Required path parameter `id: string`; no body. Set status to cancelled and free the slot.

| Status | Meaning | Body |
| --- | --- | --- |
| 200 | Cancellation succeeds | Cancelled Booking directly. |
| 404 | No booking with that ID | Error JSON. |
| 409 | Booking already cancelled | Error JSON. |
| 401 | Missing/wrong API key | Error JSON. |

Successful body example, following the operation's required behaviour:

```json
{"id":"generated-id","slot_id":"s1","name":"Ada Obi","email":"ada@example.com","status":"cancelled","created_at":"2026-11-06T16:00:00Z"}
```

**Resolved example conflict:** the PDF's generated Booking sample shows confirmed even for DELETE. The operation explicitly says to set cancelled and its 200 description is the cancelled booking. Those definitive instructions govern; do not return confirmed after successful cancellation. No past-appointment cancellation restriction is stated; do not add one.

## 6. GET /bookings — Level 4

No body. Query parameters:

| Name | Required | Type / rule |
| --- | --- | --- |
| email | yes | string; case-insensitive match. |
| limit | no | integer 1–50 inclusive; default 10; anything outside this rule returns 400. |
| cursor | no | string; pass the previous next_cursor as cursor. |

**200 application/json:**

```json
{
  "bookings": [
    {"id":"generated-id","slot_id":"s1","name":"Ada Obi","email":"ada@example.com","status":"confirmed","created_at":"2026-11-06T16:00:00Z"}
  ],
  "next_cursor": null
}
```

Return the person's bookings oldest first. `bookings` is an array of Booking; `next_cursor` is a nullable string. Return a string to continue and null on the last page. Empty history therefore has `bookings: []` and `next_cursor: null`. No confirmed-only filter is specified; both booking statuses belong to the person's history. Both envelope properties are defined but not formally included in an OpenAPI `required` array; return both consistently according to the operation description.

| Status | Meaning | Body |
| --- | --- | --- |
| 200 | A page of bookings | Envelope above. |
| 400 | Invalid limit | Error JSON. |
| 401 | Missing/wrong API key | Error JSON. |

**Unspecified:** error status for missing/invalid email, malformed/foreign/stale cursor, cursor encoding and snapshot semantics. Required email does not by itself specify the error status or require email-format validation on this GET. Creation's email-validation rule must not silently be extended into a new documented GET contract.

## Complete status inventory

| Operation | Explicit operation responses | Global response |
| --- | --- | --- |
| POST /reset | 200 | 401 |
| GET /slots | 200 | 401 |
| POST /bookings | 201, 400, 404, 409, 422, 429 | 401 |
| GET /bookings/{id} | 200, 404 | 401 |
| DELETE /bookings/{id} | 200, 404, 409 | 401 |
| GET /bookings | 200, 400 | 401 |

Complete required status set: **200, 201, 400, 401, 404, 409, 422, 429**. The source does not declare 204, 403, 405, infrastructure-failure codes, reset-validation codes or statuses for several invalid-query cases. Framework defaults must not be presented as official requirements. All error responses, including any implementation-defined ones later approved, must retain the common Error shape.

## Owner-approved implementation policies

Approved 6 November 2026. These resolve gaps in the official source; they do not modify the official specification. Earlier **Unspecified** notes describe source omissions, resolved as follows where applicable.

| Topic | Approved policy | Current state |
| --- | --- | --- |
| Reset success/errors | 200 with {}; invalid payloads and duplicate slot IDs return 400 without modifying existing state | Implemented. |
| Reset lifecycle | Atomically clear bookings, slots, idempotency records and rate-limit attempts, then install submitted inventory | Implemented. |
| Retry precedence | Matching idempotency keys replay the original response and changed bodies return 422 before rate limiting | Level 4/5 pending; these paths consume no new admission. |
| Same-body identity | Canonicalized parsed JSON preserving submitted strings; object key order/JSON formatting do not matter | Level 4 pending. |
| Response retention | Retain until reset; cache successful bookings and deterministic domain errors, not transient infrastructure failures or 429 | Level 4 pending. |
| Limit algorithm | PostgreSQL rolling 60 seconds; count admitted attempts, including failed validation/business attempts when a usable email bucket exists | Level 5 pending. |
| Rejected/email-less attempts | Denied 429 does not extend the window; missing/unusable email gets normal validation error without a shared bucket | Level 2/5 pending. |
| History error policy | Missing email or malformed/foreign cursor returns 400 Error JSON | Level 4 pending. |
| Started/occupied precedence | Return started-slot 400 before checking occupancy | Level 2/3 pending. |
| Cancellation/history | Include cancelled bookings in history and allow cancellation after appointment start | Level 3/4 pending. |

The official operation-status matrix remains unchanged. Additional policy-defined responses are reset 400 and history 400 for missing email/malformed/foreign cursors. Unexpected infrastructure failures currently use generic 500 {error: "internal server error"}; this is implementation handling, not an official declared status.

Reset checks required object/array/string types and timezone-qualified date-time values, accepts past/empty inventories, ignores unknown properties, and adds no duration/end-after-start rule. Because PostgreSQL text cannot contain a NUL character, it is rejected as invalid input with 400. Exact error wording is implementation-defined; only the Error envelope is required.

Remaining minor source omissions include key/field size limits, byte-exact timestamp spelling, unknown-field identity nuances, and stale but otherwise well-formed cursors. Do not add extra restrictions or endpoints while implementing a later level. None blocks Level 1's approved scope; full email validation, history and header handling must be reviewed/tested in their requested levels.
