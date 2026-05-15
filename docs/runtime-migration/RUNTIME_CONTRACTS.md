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
