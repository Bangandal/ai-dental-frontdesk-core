# AI Intake Core Contracts

This document captures the initial integration contracts and architectural guardrails for `ai-intake-core`.

## Health contract

`GET /health`

Response:

```json
{
  "ok": true,
  "service": "ai-intake-core"
}
```

The health route is intentionally dependency-light in the initial skeleton. Future readiness checks may be added as separate endpoints so uptime checks and dependency checks can be reasoned about independently.

## AI contract

AI components are limited to two responsibilities:

1. Extract structured intent and slots from user messages.
2. Generate proposed human-facing replies.

AI components must not directly write to:

- calendars;
- CRMs;
- Google Sheets;
- patient records;
- appointment stores;
- audit tables.

Any proposed action from AI must be validated and executed by backend application services.

## Schedule and CRM adapter contract

All calendar, schedule, and CRM writes must go through adapter interfaces owned by this backend.

The first schedule adapter will target Google Sheets. Future adapters may target dental CRMs, practice management systems, or calendar APIs. Application services should depend on adapter interfaces rather than provider-specific SDKs.

Adapters should receive only minimal appointment data, such as:

- appointment identifier or idempotency key;
- patient display name or safe reference;
- appointment date/time;
- appointment type;
- contact reference required by the target system;
- notes that are explicitly approved for the target system.

Conversation transcripts, full intake history, trace data, and audit data must remain in Postgres unless a later product requirement explicitly allows a narrower export.

## Database contract

The initial persistence approach is plain SQL migrations and the `pg` driver. No ORM is used.

Repositories should own SQL statements and return typed domain/application data to services. Application services should own transaction boundaries when a use case needs multiple repository writes.
