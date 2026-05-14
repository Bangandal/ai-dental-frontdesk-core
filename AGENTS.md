# AGENTS.md

## Project

AI Desk / AI Front Desk for clinics.

## Architecture rules

- n8n is transport only.
- Backend owns runtime decisions and execution.
- Supabase/Postgres is source of truth.
- OpenAI is semantic perception.
- Google Sheets is calendar provider.
- Do not use regex as primary business logic.
- Do not put business decisions in transport layer.

## Coding rules

- TypeScript strict style where possible.
- Prefer small services with explicit contracts.
- Validate all external inputs.
- Log trace_id for every runtime step.
- Do not break existing endpoints:
  - GET /health
  - POST /availability/check
  - POST /booking/apply
- Reuse existing booking/calendar logic.
- Do not invent new tables unless necessary.
- Do not expose secrets in code, logs, tests, or docs.

## Runtime migration goal

Implement POST /runtime/turn.

n8n after migration:
Telegram input -> /runtime/turn -> Telegram reply.

## Testing

Every runtime change must include at least one test or a documented manual curl test.

## Do not

- Do not move Telegram transport into backend yet.
- Do not implement multi-doctor scheduling yet.
- Do not implement rescheduling yet.
- Do not implement complex CRM.
- Do not use AI tool-calling for booking in n8n.
