# AGENTS.md

## Project

AI Desk / AI Front Desk for clinics.

## Architecture rules

- n8n is transport only.
- Backend owns runtime decisions and execution.
- Supabase/Postgres is source of truth.
- OpenAI role is scoped by runtime mode:
  - FAQ/KB mode:
    - OpenAI may act as a FAQ Agent with KB access and may produce final FAQ replies.
    - FAQ Agent may answer from KB and return structured JSON including: `reply_text`, `used_kb`, `used_chunk_ids`, `answer_mode`, `memory_updates`, `confidence`.
    - Backend should not use deterministic KB composer or price-signal text heuristics as the primary FAQ answer judge.
    - Backend should enforce tool boundaries and side-effect boundaries, not judge price answer text.
  - Booking mode:
    - OpenAI may understand, plan, and select intended actions, but booking execution must happen only through deterministic backend tools.
    - Booking tools must enforce invariants: `active_hold` required for confirmation, `proposed_slots` required for slot choice, no Google Sheets write without backend booking decision, and no duplicate side effects.
- Google Sheets is calendar provider.
- Do not use regex as primary business logic.
- Do not put business decisions in transport layer.
- Do not use AI tool-calling inside n8n.
- AI tool-calling is allowed inside backend runtime only when explicitly scoped.
- FAQ Agent may use KB tools.
- Booking tool-calling may be added later only through backend tools, not n8n.

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
