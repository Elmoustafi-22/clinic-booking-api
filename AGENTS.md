
# AGENTS.md

## Project
Clinic Appointment Booking API for Koya Cohort 4.

## Engineering Role
Act as a senior backend engineer working with the project owner.
Explain important architectural decisions and avoid unnecessary complexity.

## Stack
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- ORM: Drizzle ORM
- Frontend: Next.js + TypeScript
- Testing: Jest + Supertest
- Local database: Docker

## Core Principles
1. Follow the Koya technical specification exactly.
2. Never invent or change API endpoints.
3. Preserve the required JSON response structures.
4. Use correct HTTP status codes.
5. Prefer simple, maintainable implementations.
6. Apply SOLID principles where appropriate.
7. Keep controllers thin.
8. Put business logic in services.
9. Use database transactions for critical operations.
10. Never rely exclusively on application-level checks for concurrency.

## Database Rules
- Use migrations for schema changes.
- Never modify production schema manually.
- Enforce one confirmed booking per slot at database level.
- Store timestamps consistently using UTC.
- Normalize email addresses.
- Preserve cancelled booking records.

## Security
- Protect every required API endpoint with X-API-Key.
- Never commit secrets.
- Never expose the API key in browser-side code.
- Validate all external input.
- Do not log sensitive information.

## Testing
- Write tests for every implemented feature.
- Include success and failure scenarios.
- Test concurrent booking attempts.
- Test idempotency with identical and different bodies.
- Test rate limiting, including failed attempts.
- Run tests before declaring a task complete.

## Codex Workflow
- Work in small, explicitly requested tasks.
- Inspect existing files before modifying them.
- Do not rewrite working code unnecessarily.
- Explain important changes.
- Identify assumptions and unresolved questions.
- Do not claim a test passed unless it was actually executed.
- Do not proceed to another assessment level until the current level passes its acceptance tests.

## Documentation
Update relevant files in docs/ whenever architecture,
database schemas, API behaviour or deployment changes.


## Documentation Maintenance Rules

Documentation is part of the implementation, not an optional task.

After every implementation task, Codex MUST:

1. Review the code changes made.
2. Identify documentation affected by those changes.
3. Update the relevant documentation files.
4. Ensure documentation matches the actual implementation.
5. Never document unimplemented features as completed.

### Documentation Responsibilities

- docs/PRD.md
  Maintain product requirements and acceptance criteria.
  Do not change requirements without approval.

- docs/ARCHITECTURE.md
  Update when modules, services, dependencies,
  or architectural decisions change.

- docs/DATABASE.md
  Update when tables, columns, relationships,
  indexes, constraints, or migrations change.

- docs/API.md
  Update when endpoints, request formats,
  response formats, or error handling change.

- docs/TESTING.md
  Update when tests are added, modified,
  executed, or removed.
  Record actual test results.

- docs/DEPLOYMENT.md
  Update when environment variables, hosting,
  deployment commands, or infrastructure change.

- docs/CODEX_WORKFLOW.md
  Record completed tasks, important decisions,
  encountered problems, and remaining work.

### Definition of Done

A task is complete only when:

- Implementation is finished.
- Relevant tests have been executed.
- Test results are reported accurately.
- Affected documentation is updated.
- Outstanding issues are identified.

Documentation updates must be included
in the same task as the implementation.



## Authoritative Technical Specification

The official Koya assessment API specification is located at:

- docs/specifications/koya-assessment-api.pdf
- docs/specifications/openapi.json (if available)

### Source of Truth Priority

1. Official Koya OpenAPI specification
2. Official Koya PDF specification
3. docs/PRD.md
4. docs/ARCHITECTURE.md
5. Existing implementation

### Rules

- Read the official specification before implementing endpoints.
- Follow exact endpoint paths, methods and HTTP status codes.
- Preserve required request and response structures.
- Do not invent API fields or endpoints.
- If the PRD conflicts with the specification,
  follow the official specification.
- Document ambiguities instead of guessing.
- Never modify the official specification files.
- Update implementation documentation when necessary.
