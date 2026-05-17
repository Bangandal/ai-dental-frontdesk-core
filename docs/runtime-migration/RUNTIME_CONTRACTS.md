# Runtime Contracts

## RuntimeTurnInput

{
  "clinic_code": "clinic_1",
  "channel": "telegram",
  "external_user_id": "8054104741",
  "chat_id": "8054104741",
  "text": "на 16 число есть место?",
  "meta": {
    "message_id": "1270",
    "update_id": "464427367",
    "username": "Mishae_l",
    "first_name": "Light",
    "last_name": null
  }
}

## RuntimeTurnResult

{
  "trace_id": "uuid",
  "reply_text": "Есть окно 16.05.2026 в 07:00. Подтверждаем?",
  "clinic_id": "uuid",
  "contact_id": "uuid",
  "case_id": "uuid|null",
  "booking_result": {},
  "side_effects": [],
  "debug": {}
}

## AIOutput

{
  "reply_draft": "string|null",
  "slot_updates": {
    "name": null,
    "service_interest": null,
    "problem": null,
    "phone": null,
    "preferred_time": null,
    "preferred_contact": null
  },
  "requested_action": "continue|ask_slot|answer_faq|handoff|complete_intake|clarify|greeting|stop|check_availability|propose_slot|select_slot|await_confirmation|confirm_slot|reject_slot|create_appointment",
  "conversation_intent": "greeting|faq|booking|availability_request|slot_selection|patient_confirmation|slot_rejected|objection|urgent|correction|off_topic|post_handoff_ack|follow_up|multi_patient_request|reschedule|cancel_appointment|unknown",
  "availability_query": {
    "search_type": "nearest_available|specific_date|weekday|relative_day|exact_slot|time_constraint|unknown",
    "date_iso": null,
    "weekday": "monday|tuesday|wednesday|thursday|friday|saturday|sunday|null",
    "relative_day": "today|tomorrow|day_after_tomorrow|null",
    "time_window": {
      "type": "morning|afternoon|evening|before|after|between|any",
      "start_time": "HH:mm|null",
      "end_time": "HH:mm|null"
    },
    "exact_time": "HH:mm|null",
    "flexibility": "specific|flexible|nearest|unknown"
  },
  "slot_selection": {
    "selected_option_id": null,
    "selected_start_at": null,
    "selected_time": null,
    "selection_confidence": "high|medium|low|unknown"
  },
  "booking": {
    "preferred_date_iso": null,
    "preferred_weekday": null,
    "time_of_day": "morning|afternoon|evening|any|null",
    "patient_confirmed_proposed_slot": false,
    "patient_rejected_proposed_slot": false,
    "selected_hold_id": null
  },
  "faq_topic": "price|insurance|address|other|unknown",
  "patient_scope": "self|another_person|multiple_people|unknown",
  "handoff_recommended": false,
  "kb_used": false,
  "confidence": "high|medium|low"
}

## BookingPayload

{
  "clinicId": "uuid",
  "contactId": "uuid",
  "caseId": "uuid|null",
  "bookingAction": "propose_options|propose_slot|confirm_slot|cancel_hold",
  "serviceInterest": "консультация",
  "preferredDateIso": "2026-05-16",
  "preferredWeekday": null,
  "timeOfDay": "any",
  "preferredTimeWindow": {
    "startTime": "HH:mm|null",
    "endTime": "HH:mm|null"
  },
  "exactTime": "HH:mm|null",
  "activeHoldId": null,
  "selectedSlotStartAt": "ISO datetime|null",
  "selectedSlotEndAt": "ISO datetime|null",
  "selectedSlotProviderMetadata": {},
  "patientName": "Patient",
  "channel": "telegram",
  "traceId": "uuid",
  "durationMinutes": 30
}

## Runtime KB/RAG contract

`POST /runtime/turn` may ground factual FAQ replies with Supabase pgvector KB context. The production adapter does **not** call a generic single-`jsonb` RPC. It calls the deployed KB RPC with typed parameters:

```sql
select kb.rpc_retrieve_context_json(
  $1::uuid,
  $2::public.vector,
  $3::integer,
  $4::real
) as result
```

Parameters:

- `$1`: `clinic_id` (`uuid`)
- `$2`: OpenAI embedding vector formatted for `public.vector`; `kb.kb_chunks.embedding` is `vector(1536)`
- `$3`: retrieval limit, default `KB_RETRIEVAL_LIMIT=5`
- `$4`: minimum similarity, default `KB_MIN_SIMILARITY=0.55`

Expected RPC result shape:

```json
{
  "hits": [
    {
      "title": "...",
      "content": "...",
      "metadata": {},
      "similarity": 0.82
    }
  ],
  "count": 1,
  "top_similarity": 0.82,
  "context_text": "..."
}
```

Runtime maps `hits[*].similarity` to snippet `score`, reads `source_type` from `metadata.source_type` when present, and treats KB as found only when `count > 0` and at least one snippet is mapped.


## Multi-slot proposal memory

Runtime stores the latest offered options in `core.convo_state.state_json.runtime` (backend-owned state; AI must not write it directly):

```json
{
  "runtime": {
    "last_proposed_slots": [
      {
        "option_id": "1",
        "start_at": "2026-05-20T08:00:00.000Z",
        "end_at": "2026-05-20T08:30:00.000Z",
        "label": "20.05.2026, 10:00",
        "service_interest": "консультация",
        "preferred_date_iso": "2026-05-20",
        "time_of_day": "any",
        "exact_time": null,
        "provider_metadata": {}
      }
    ],
    "last_proposed_slots_trace_id": "uuid",
    "last_proposed_slots_created_at": "2026-05-17T10:00:00.000Z",
    "awaiting_slot_choice": true
  }
}
```

`bookingAction = propose_options` checks real availability for broad availability requests and returns up to 3 `proposed_slots` with `booking_status = awaiting_slot_choice`. It does not create holds, write external calendar records, or notify admin. Direct `exact_slot` requests with a valid `date_iso` and `exact_time` use `bookingAction = propose_slot` immediately, creating only one hold when the exact slot is available and returning `awaiting_patient_confirmation` rather than `awaiting_slot_choice`.

After the patient chooses an offered option, AI fills typed `slot_selection`; backend resolves it against this stored memory, re-checks the exact selected slot, and only then calls `propose_slot` to create the single hold with `booking_status = awaiting_patient_confirmation`. Once a selected option is consumed, runtime clears `runtime.last_proposed_slots` and sets `runtime.awaiting_slot_choice = false` for both successful holds and stale/no-slots outcomes.
