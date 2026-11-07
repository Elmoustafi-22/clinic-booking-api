# Backend architecture — Levels 1–5

Updated 7 November 2026. Levels 1–5, including PostgreSQL rolling admission, are implemented; the Next.js frontend proxy and deployment remain deferred. TESTING.md records actual verification, not an external assessor result. Official OpenAPI > official PDF > PRD > architecture > implementation remains the source priority; API.md separates the contract from owner policies.

## Components and boundaries

AppController exposes exactly the six official operations: POST /reset, GET /slots, POST /bookings, GET /bookings/:id, DELETE /bookings/:id and GET /bookings history. It maps HTTP inputs/statuses and delegates to services. No prefix, scaffold root, extra public endpoint or frontend functionality was introduced.

- DatabaseModule supplies one typed Drizzle/node-postgres pool per Nest application, UTC sessions, startup connectivity validation and shutdown cleanup. Migrations run separately; startup never synchronizes schema.
- ResetService validates all replacement slots before taking its exclusive transaction reset lock and atomically clears idempotency records, rate-attempt rows, bookings and slots before installing inventory. It returns 200 {}; invalid/duplicate input returns 400 without mutation. Past slots and empty arrays remain valid.
- SlotsService derives availability in one correlated NOT EXISTS confirmed-booking query, with exact provider filtering and start/ID ordering. No duplicated mutable availability flag exists.
- BookingsService retains the Level 3 slot-lock/start/occupancy/insert protocol and conditional cancellation. It now chooses normal creation when Idempotency-Key is absent or delegates keyed work to IdempotencyService using the same transaction-aware insertion method.
- IdempotencyService owns scoped key synchronization, persisted response replay, savepoint recovery and atomic booking/result commit. It calls BookingRateLimitService only after resolving stored replay/mismatch.
- BookingHistoryService validates query parameters and uses a single ordered seek query; BookingCursor encodes and authenticates continuation tokens. Public Booking objects retain the same six fields.
- ApiErrorFilter retains {error: string}; unrelated database errors remain sanitized 500. Secrets, request bodies and internal metadata are not logged or returned.

Nest's automatic body parsing remains disabled in application/test factories. ApiKeyMiddleware invokes the reusable guard check before Express parsing on all official paths, and APP_GUARD also protects handlers before service work. API_KEY is required/validated at startup and captured privately. Authentication therefore precedes body validation, hashing, key lookup and pagination validation.

## Booking and cancellation transaction boundaries

Without an idempotency key, the transaction takes shared reset protection, awaits independently committed admission, then invokes BookingValidationPipe. It rejects missing/non-string/blank values, trims only name/email, validates email and preserves submitted slot_id exactly. The service lowercases stored email. Unknown fields and arbitrary name/ID lengths remain unrestricted by custom business rules.

Booking uses explicit READ COMMITTED: shared transaction reset lock -> independent admission -> DTO validation -> slot FOR UPDATE -> a separate database wall-clock statement after any lock wait -> confirmed occupancy check -> insert -> commit. Missing slot is 404, started/equal-now is 400 before occupied-slot 409. The existing partial unique index remains the independent double-booking guarantee. Only pg.DatabaseError 23505 for table bookings and bookings_one_confirmed_per_slot_idx maps to 409; other constraints/errors remain infrastructure failures.

Cancellation takes shared reset coordination, reads immutable slot_id without a booking lock, locks that slot, then conditionally updates id AND confirmed status. Only status/cancelled_at change; the six-field cancelled Booking is returned after commit. Missing ID is 404, repeated/concurrent loser 409. Records and original timestamps remain; cancellation after start is allowed and later rebooking creates another ID.

## Durable idempotency and canonical identity

The scope is the stable internal single-client namespace clinic-api plus POST /bookings. It is not the API secret or patient email, so reuse of one key with another email/body is a mismatch, and credential rotation does not silently discard records. An absent header bypasses idempotency; a present empty string is a key because the official header schema has no minimum length.

Hashing uses SHA-256 over UTF-8 canonical parsed JSON: recursively lexically sorted object keys, retained array order, JSON-serialized primitives and unchanged submitted string values. Formatting/key order outside strings does not matter; trimmed/case-normalized equivalence is deliberately not used. Unknown fields, nested arrays/objects and special own keys participate in identity without reconstructing unsafe prototype properties. Unsupported/non-finite JSON values cannot be fingerprinted and return 400; malformed/absent JSON is not cached as a keyed domain result.

The original header key is independently SHA-256 hashed into a fixed-size identity stored in idempotency_records.key. This avoids the PostgreSQL B-tree entry-size limit without adding an arbitrary public key-length restriction. The composite primary key remains the uniqueness backstop; cryptographic digest identity is distinct from the shorter lock hash.

Keyed processing uses explicit READ COMMITTED on a single pooled connection:

1. Acquire the shared reset transaction advisory lock.
2. Acquire a transaction advisory lock in the two-integer namespace 410402, using a signed 32-bit SHA-256-derived lock ID over scope/operation/key identity. The two-integer keyspace is disjoint from reset's one-bigint keyspace. Lock-hash collisions only serialize unrelated keys; lookup uses the full scoped SHA-256 identity.
3. Read persisted state after obtaining the lock. Matching request_hash replays only response_status/response_body. A changed fingerprint returns 422 and leaves the original record untouched.
4. For a new key, await independently committed admission before opening a Drizzle nested transaction (PostgreSQL savepoint), then run DTO validation and the shared Level 3 booking insertion logic. No second connection is needed for this savepoint.
5. Success releases the savepoint but remains uncommitted in the outer transaction. Deterministic 400 validation/start, 404 slot and 409 slot errors roll back to the savepoint first, then become cacheable Error JSON. The named actual uniqueness violation is mapped by booking logic and likewise recovered before any further SQL. Unrelated/transient errors abort the outer transaction and are not cached.
6. Store the original response status/JSON snapshot, then commit the outer transaction before sending a response. Failure to store the result rolls back the booking too. There is no committed pending row, lease or background worker.

Records are retained until reset, without TTL. A replay after cancellation returns the original confirmed response/ID, even though GET returns the current cancelled record. Commit followed by lost HTTP response is recoverable with the same key; crash/rollback before commit leaves no successful booking/result pair. Authentication 401, mismatched-key 422, infrastructure 500 and 429 are not newly cached. Error records may legitimately have no booking; this is why there is no mandatory booking FK.

JSONB snapshots preserve JSON values, not serialized property order, Date/connection headers or byte-for-byte HTTP framing. No internal hashes, scoped keys or response-status wrappers leak into public JSON. The controller uses passthrough response status to replay original 201/400/404/409 correctly.

## Cursor history algorithm and precision

GET /bookings requires a nonblank string email, normalized by trim/lowercase for matching. It does not invent a new email-syntax requirement for GET. limit defaults to 10; decimal-digit strings representing integers 1–50 are accepted, and malformed/out-of-range/repeated values return 400. cursor is optional; malformed, repeated or foreign cursors return 400.

One SQL statement filters the canonical stored email, includes both statuses, orders immutable (created_at, id) ascending, seeks with tuple > the decoded boundary and fetches limit + 1. Return at most limit six-field bookings; a continuation is produced only when an extra row exists, otherwise next_cursor is null. No offset or cursor-row lookup is used.

PostgreSQL to_char(created_at AT TIME ZONE 'UTC', ...) obtains six fractional digits for the cursor position. That string goes directly back to timestamptz in the seek predicate; it never passes through JavaScript Date for boundary reconstruction. Public created_at serialization remains compatible with existing endpoints at millisecond precision. Equal timestamps use the text booking-ID tie-breaker; sub-millisecond timestamps remain traversable without gaps/duplicates on an unchanged dataset.

The opaque token is base64url(JSON [version, normalized email, full-precision UTC timestamp, ID]) plus a base64url HMAC-SHA-256 signature. The signing key is domain-separated from the existing server API_KEY; no new environment variable is required. Verify signature in constant time, canonical encoding, version, email context, actual date-time validity and safe string ID before SQL. No timestamp is cast through Date to form the query boundary. The token is integrity protected, not encrypted; ordering/email/ID data already belongs to the public query/Booking contract, and internal database columns are not returned.

Replicas must share API_KEY to accept each other's cursors. Rotating it invalidates old cursors with 400, while database idempotency records remain scoped independently. Pagination is a live listing, not a frozen snapshot: later commits may appear later or behind a traversed boundary. Deleting the boundary row does not invalidate a valid token. After reset, clients should begin a fresh traversal of the replaced dataset.

## Lock ordering, reset and failure review

Keyed booking order is shared reset -> idempotency key -> independent email admission -> savepoint/validation -> slot -> booking work. Unkeyed booking uses reset -> independent admission -> validation -> slot; cancellation remains reset -> slot -> booking. No operation acquires a key after a slot or a reset lock after row locks. Reset obtains exclusive coordination before deleting any table, so it cannot interleave inventory/result deletion with keyed replay/commit. All locks release on commit/rollback; no process-local correctness mutex or pooled session lock exists.

Savepoint rollback releases its booking/slot changes while the outer reset/key lock remains held until caching finishes. Unrelated storage errors are outside the domain-error recovery block, so failed idempotency writes cannot be mislabeled 409/422 or leave a successful booking committed alone. Existing FK, status/cancellation checks and partial unique index remain unchanged. No schema migration was needed.

## Verification and operational boundary

TESTING.md records full Level 1–5 checks, concurrent retries across independent Nest instances, different-key slot competition, atomic store failure, savepoint recovery, cursor portability and microsecond/tie traversal. Earlier history-absence staging assertions were updated for the newly authorized route, rather than removing prior test cases. Finite tests do not replace the independent database invariant or establish hosted/load guarantees.

Level 5 uses the existing attempts schema; see the admission protocol below and TESTING.md for actual checks.

Next.js/proxy, hosting, production lock/statement-timeout policy, external assessment and previous dependency-audit remediation remain separate work. Stop after Level 5; frontend and deployment require separate authorization.

## PostgreSQL admission protocol — Level 5

BookingRateLimitService owns a separate bounded node-postgres pool (max 4; the existing primary pool defaults to 10). Parents retain primary connections/reset/key locks while admission commits. Separate capacity prevents every primary client waiting for a child on the same exhausted pool. Both pools close with the Nest application. Plan up to 14 database connections per replica plus migrations/administration; there is no new dependency or environment variable.

The caller must hold the shared reset transaction lock before invoking admission. On a dedicated READ COMMITTED connection, acquire a transaction advisory lock in two-integer namespace 410403 using the first signed 32 bits of SHA-256(trimmed lowercase email). Read database clock_timestamp AFTER that lock, retaining microsecond precision as a UTC SQL timestamp string. Count existing events within (now-60 seconds, now]. If fewer than five, insert one event and COMMIT before booking processing. Otherwise commit without mutation and throw 429 with ceil(oldest active event + 60 seconds - now), at least 1. The filter writes Retry-After while retaining the error-only JSON envelope.

All instances use the same PostgreSQL lock, so a waiter reads the previous committed admission before counting; count and insert are serialized for each email. Hash-lock collisions merely serialize distinct full-digest identities. The existing email/time/id index supports the count and oldest expiry. The full SHA-256 normalized-email identity is stored in the existing email column, supporting even oversized/NUL invalid string input without B-tree/text failures. It is pseudonymous identity, not encryption.

Admission never takes a slot/key/reset lock or borrows a primary client. In particular, reacquiring shared reset inside the child could wait behind an exclusive reset that itself waits for the parent: this is deliberately avoided. The parent already protects both commits from reset. A queued reset runs only after the outer booking/result transaction ends and clears attempts/bookings/results atomically. No cross-pool lock cycle exists in the application protocol.

New keyed admission is outside the cacheable-domain-error savepoint block, so 429 and admission failures cannot become cached results. Key ownership across admission ensures concurrent identical requests consume once. Unfingerprintable parsed bodies with a usable email count admission for a new key and remain uncached 400; an existing key with such a different body is 422 before admission. Parser/authentication failures occur earlier.

A later booking/savepoint/result-write rollback leaves the independently committed admission intact. Admission SQL, connection or COMMIT failure aborts processing with generic 500, without silently permitting a booking. A lost COMMIT acknowledgment can leave a counted attempt with a 500 response; conservative counting is intentional. Admission uses a 30-second connection timeout, 15-second lock timeout and 20-second statement timeout; resource overload/external lock holders may therefore fail closed. The primary pool also uses a bounded 30-second connection wait to tolerate burst queues while parent clients retain reset/key protection. No retries or process-local correctness state were added.

Events remain until reset; expired events are excluded by the indexed time predicate, with no cleanup job implemented. Production retention, pool sizing/load testing, PostgreSQL clock administration and primary transaction timeout policy require deployment review. This local implementation does not claim infinite capacity or hosted assessment success.
