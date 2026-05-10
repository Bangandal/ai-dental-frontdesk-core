# AI Intake Core Architecture

`ai-intake-core` is the source-of-truth backend for an AI Intake / AI Front Desk system for dental clinics. The service owns intake cases, appointment mirrors, integration configuration, and the domain decisions that protect external systems from direct AI writes.

## System boundaries

- **n8n is an orchestration shell only.** It may trigger workflows and call this API, but it must not become the system of record.
- **PostgreSQL is the source of truth.** Patient cases, appointment mirrors, integration configuration, trace records, audit records, and future conversation history live in Postgres.
- **AI is not an actor with write authority.** AI components may extract intent and slots, and may draft human-facing replies. They must not directly mutate calendars, CRMs, Google Sheets, or other external systems.
- **External writes go through adapters.** Calendar and CRM writes must be performed by explicit adapter interfaces owned by the backend.
- **Google Sheets is the first schedule adapter.** It is one implementation behind the schedule adapter boundary; future CRM/calendar adapters should be registered without changing AI behavior.
- **External stores hold minimal appointment data.** Calendar/CRM/schedule systems should receive only the minimum appointment fields required for scheduling operations.

## Implemented backend shape

The current skeleton includes:

- Fastify application construction and route registration in `src/app.ts`.
- Process startup and graceful shutdown in `src/server.ts`.
- Zod-backed environment validation in `src/config/env.ts`.
- PostgreSQL connection pooling in `src/db/pool.ts`.
- Health, availability, appointment lifecycle, and case resolver routes in `src/http/routes/`.
- Plain SQL migrations for `core.cases`, `core.external_appointments`, and `core.clinic_integrations` in `migrations/`.
- A schedule adapter interface plus a read-only Google Sheets schedule adapter in `src/adapters/schedule/`.
- Appointment lifecycle domain logic for availability checks, idempotent holds, confirmation attempts, and external-write failure marking.
- Case resolution domain logic for attaching messages to open cases, creating new cases, and marking booked cases pending admin confirmation.

## Module boundaries

Future implementation should keep these boundaries explicit:

- **HTTP layer:** request validation, authentication, response shaping, and delegation to application services.
- **Application/domain services:** use-case orchestration, state transitions, idempotency checks, adapter selection, and policy enforcement.
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
