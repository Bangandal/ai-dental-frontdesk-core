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
  "requested_action": "continue|ask_slot|answer_faq|handoff|complete_intake|clarify|greeting|stop|check_availability|propose_slot|await_confirmation|confirm_slot|reject_slot|create_appointment",
  "conversation_intent": "greeting|faq|booking|availability_request|patient_confirmation|slot_rejected|objection|urgent|correction|off_topic|post_handoff_ack|follow_up|multi_patient_request|reschedule|cancel_appointment|unknown",
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
  "bookingAction": "propose_slot|confirm_slot|cancel_hold",
  "serviceInterest": "консультация",
  "preferredDateIso": "2026-05-16",
  "preferredWeekday": null,
  "timeOfDay": "any",
  "activeHoldId": null,
  "patientName": "Patient",
  "channel": "telegram",
  "traceId": "uuid",
  "durationMinutes": 30
}

## RuntimeKnowledgeRepository contract (PR #17)

`POST /runtime/turn` resolves clinic FAQ facts through a backend-owned knowledge repository before building clinic-fact replies.
The repo audit found runtime docs mentioning `kb_retrieve`, but no versioned KB schema, `kb_chunks`, `kb_documents`, embeddings table, or concrete Supabase RPC migration in this repository. Until the production KB contract is versioned here, runtime depends on this TypeScript interface and unit-test fakes rather than inventing duplicate tables.

`RuntimeKnowledgeRepository.searchClinicKnowledge(input)` input:

```json
{
  "clinic_id": "uuid",
  "faq_topic": "price|insurance|address|other|unknown",
  "service_interest": "string|null",
  "user_text": "string",
  "language": "string|null",
  "channel": "telegram",
  "trace_id": "uuid",
  "limit": 4
}
```

Output:

```json
{
  "found": true,
  "snippets": [
    {
      "title": "optional title",
      "content": "grounding fact text",
      "source_type": "optional source type",
      "score": 0.9,
      "metadata": {}
    }
  ],
  "debug": {}
}
```

Runtime must answer price, insurance, address, and other FAQ facts only from returned snippets. If retrieval returns no snippets or fails, runtime uses a safe fallback and does not use general AI knowledge or hardcoded clinic facts.


### Optional Postgres RPC adapter

The default runtime factory uses `NoopRuntimeKnowledgeRepository` unless `RUNTIME_KB_RPC_NAME` is configured. When configured, `PgRuntimeKnowledgeRepository` calls exactly one Postgres function with a single `jsonb` argument using parameterized SQL:

```sql
select "schema"."function_name"($1::jsonb) as result
```

`RUNTIME_KB_RPC_NAME` must be either `function_name` or `schema.function_name` using only ASCII letters, digits, and underscores. The RPC must return a JSON/JSONB object matching `RuntimeKnowledgeResult` (`found`, `snippets`, optional `debug`). A recommended production name is `kb.kb_retrieve_json` if that RPC exists in the deployed database. This repo still does not add KB tables or migrations; production DB/RAG remains the source of truth.
