# AI Desk Runtime Migration Brief

## Goal

Move AI Desk runtime orchestration from n8n into the Node.js/TypeScript Fastify backend.

n8n must become transport only.

## Current backend

Stack:
- Node.js
- TypeScript
- Fastify
- Docker on VPS
- Service name: ai-intake-core

Existing endpoints:
- GET /health
- POST /availability/check
- POST /booking/apply

Do not break these endpoints.

## Target endpoint

Add:

POST /runtime/turn

n8n will call:

http://ai-intake-core:3000/runtime/turn

## Architecture law

AI = semantic perception and structured extraction.
Backend = deterministic decisions and execution.
Supabase/Postgres = source of truth.
Google Sheets = calendar provider.
n8n = transport only.

No regex as primary business logic.

## Runtime responsibilities

/runtime/turn must own:

1. Resolve clinic
2. Get/create contact
3. Save inbound message
4. Load state
5. Resolve active case
6. Resolve active hold/latest appointment
7. Build AI context
8. Call AI for structured semantic output
9. Validate AI output
10. Execute AI-requested tools in backend code if needed
11. Call existing booking service behind /booking/apply
12. Apply booking result to case/state
13. Build final reply
14. Save outbound message
15. Return reply_text and side_effects

## MVP scenarios

Must support:

1. FAQ only
2. FAQ + booking interest without date
3. Availability request with date
4. Patient confirms active proposed slot
5. Patient rejects active proposed slot
6. Follow-up after proposed slot
7. No phone request in Telegram unless patient asks for callback

## Calendar policy

FAQ / price / insurance / address does not call booking.

"Можно записаться?" without date/day/time:
- no booking call
- ask for convenient day/time

"На 16 число есть место?":
- bookingAction = propose_slot
- preferredDateIso resolved using Europe/Prague current date

Active hold + "да":
- bookingAction = confirm_slot

Active hold + rejection:
- bookingAction = cancel_hold

## Booking result authority

booking_result is authoritative.

Never say:
- slot exists
- no slots
- booked
- admin notified

unless backend booking_result says so.

If booking_result.booking_status = "none" or reason = "no_booking_action":
do not say there are no slots.
Use safe fallback.

## Runtime AI style

Preferred architecture:
- One AI runtime turn may use backend-executed tools.
- AI may request booking_apply or kb_retrieve.
- Backend code executes tool calls directly and logs args/results.
- No n8n AI tool wrapper for booking.
- Final output must be structured JSON.

## n8n after migration

n8n must only:

1. Receive Telegram update
2. Normalize to RuntimeTurnInput
3. POST /runtime/turn
4. Send Telegram reply
5. Send admin notification if returned by backend

Remove/disable from n8n:
- AI Agent
- Booking Apply tool
- Booking Gate
- Validate Agent Output
- Case/booking decision nodes
