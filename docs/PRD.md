# PRD: Clinic Appointment Booking System

**Project:** Koya Cohort 4 – Task 1  
**Version:** 1.0  
**Status:** Implementation-ready  
**Target completion:** Saturday, 7 November 2026

## 1\. Product overview

Build a clinic appointment booking system consisting of a REST API and a simple web application.

Patients should be able to:

- View available appointment slots.
- Filter slots by healthcare provider.
- Book an available appointment.
- Receive a booking confirmation.
- Look up an existing booking.
- Cancel an existing booking.
- View their booking history.

The backend must enforce authentication, validation, concurrency safety, idempotency, pagination and rate limiting according to the assessment's technical specification.

## 2\. Objectives

1. Implement the exact API contract provided by Koya.
2. Persist appointment slots and bookings in PostgreSQL.
3. Prevent duplicate confirmed bookings for the same slot.
4. Ensure retry requests cannot create duplicate bookings.
5. Protect the API using an API key.
6. Provide a functional and accessible booking interface.
7. Deploy the application using HTTPS.
8. Provide automated tests covering all five assessment levels.

## 3\. Technology decisions

| Layer | Technology |
| --- | --- |
| Backend | NestJS |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Validation | class-validator / class-transformer |
| Frontend | Next.js + TypeScript with a server-side API proxy |
| API testing | Jest + Supertest |
| Local database | Docker |
| API hosting | Render |
| Database hosting | Neon PostgreSQL |
| Frontend hosting | Vercel |
| API documentation | OpenAPI / Swagger |

## 4\. Functional requirements

### Level 1 – Basic booking

- POST /reset: Replace all slots and delete existing bookings.
- GET /slots: Return all slots, ordered by earliest start.
- GET /slots?provider=: Filter slots by exact provider name.
- POST /bookings: Book an appointment slot.
- GET /bookings/:id: Retrieve an individual booking.

### Level 2 – Authentication and validation

- Every request must include X-API-Key.
- Missing or incorrect keys return HTTP 401.
- Validate required booking fields.
- Validate email addresses.
- Trim names and emails.
- Convert stored emails to lowercase.
- Reject slots that have already started.
- Return HTTP 404 when a requested slot does not exist.

### Level 3 – Concurrency and cancellation

- A slot may have only one confirmed booking.
- Enforce this rule at database level.
- Concurrent booking requests must not produce duplicate confirmed bookings.
- DELETE /bookings/:id cancels a booking.
- A cancelled slot becomes available again.
- Repeated cancellation returns HTTP 409.

### Level 4 – Idempotency and pagination

- Support the optional Idempotency-Key header.
- The same key and same request body must return the original response.
- Reusing a key with a different body returns HTTP 422.
- GET /bookings?email=: Retrieve bookings for an email.
- Support limit values from 1 to 50.
- Default page size is 10.
- Implement cursor-based pagination.
- Return bookings oldest first.
- Email matching must be case-insensitive.

### Level 5 – Rate limiting

- Maximum of five booking attempts per email per minute.
- Failed attempts count.
- The sixth attempt returns HTTP 429.
- Include Retry-After in whole seconds.
- Rate limits for different email addresses must be independent.

## 5\. Non-functional requirements

- All endpoints return JSON.
- Use appropriate HTTP status codes.
- Persist all data between requests.
- Use environment variables for secrets and connection strings.
- Use database constraints to protect critical business rules.
- Handle concurrent requests safely.
- Provide meaningful error responses.
- Avoid logging API keys or sensitive information.
- Deploy using HTTPS.
- Provide automated tests for critical business logic.

## 6\. User interface requirements

The frontend should provide:

1. Appointment listing.
2. Provider filtering.
3. Available/booked slot indicators.
4. Booking form containing name and email.
5. Booking confirmation showing booking ID and appointment details.
6. Booking lookup.
7. Booking history with pagination.
8. Cancellation functionality.
9. Loading, success and error states.

The interface should be responsive and simple. Visual complexity is not a priority.

## 7\. Acceptance criteria

The project is complete when:

- All specified endpoints follow the technical contract.
- API-key authentication works on every required endpoint.
- Invalid booking details are rejected.
- A slot cannot be double-booked under concurrent requests.
- Cancellation releases a slot.
- Idempotency prevents duplicate bookings.
- Cursor pagination works correctly.
- Rate limiting counts failed attempts.
- The web application successfully interacts with the deployed API.
- Database records survive subsequent requests and application restarts.
- All critical tests pass.
- API and frontend are deployed using HTTPS.

## 8\. Out of scope

- Patient accounts and registration.
- Doctor authentication.
- Payment processing.
- Email/SMS notifications.
- Medical records.
- Calendar integrations.
- Advanced administrative dashboards.

These features are not necessary for the assessment.
