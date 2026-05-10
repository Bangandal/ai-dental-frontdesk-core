# AI Intake Core Architecture

`ai-intake-core` is the source-of-truth backend for an AI Intake / AI Front Desk system for dental clinics. The service owns clinical intake state, conversation history, appointment mirrors, trace records, and audit records in PostgreSQL.

## System boundaries

- **n8n is an orchestration shell only.** It may trigger workflows and call this API, but it must not become the system of record.
- **PostgreSQL is the source of truth.** Conversation history, patient cases, intake state, appointment mirrors, traces, and audit events live in Postgres.
- **AI is not an actor with write authority.** AI components may extract intent and slots, and may draft human-facing replies. They must not directly mutate calendars, CRMs, or other external systems.
- **External writes go through adapters.** Calendar and CRM writes must be performed by explicit adapter interfaces owned by the backend.
- **Google Sheets is the first schedule adapter.** The adapter boundary must remain stable so future CRM/calendar adapters can be added without changing AI behavior.
- **External stores hold minimal appointment data.** Calendar/CRM/schedule systems should receive only the minimum appointment fields required for scheduling operations.

## Initial backend shape

The current skeleton provides:

- Fastify application construction in `src/app.ts`.
- Process startup and graceful shutdown in `src/server.ts`.
- Zod-backed environment validation in `src/config/env.ts`.
- PostgreSQL connection pooling in `src/db/pool.ts`.
- Health routing in `src/http/routes/health.routes.ts`.

No business logic, AI workflow logic, adapter implementation, or database migrations are implemented yet.

## Planned module boundaries

Future implementation should keep these boundaries explicit:

- **HTTP layer:** request validation, authentication, response shaping, and delegation to application services.
- **Application services:** use-case orchestration, transaction boundaries, state transitions, and policy enforcement.
- **Repositories:** plain SQL access to Postgres. No ORM is planned for the initial system.
- **AI services:** intent/slot extraction and response drafting only.
- **Adapters:** integration contracts for schedule, calendar, CRM, messaging, and related external systems.
- **Audit/trace:** append-only records that explain what the system observed, decided, and wrote.

## Data ownership

Postgres should own the full operational record:

- inbound and outbound conversation events;
- patient intake cases and their state transitions;
- extracted intents and slots;
- appointment mirror records;
- external adapter write attempts and outcomes;
- trace and audit records.

External CRM/calendar systems should be treated as integration targets, not authoritative history stores.
