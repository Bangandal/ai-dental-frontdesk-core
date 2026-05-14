# Runtime Acceptance Tests

## Test 1: FAQ + booking interest without date

Input:

{
  "clinic_code": "clinic_1",
  "channel": "telegram",
  "external_user_id": "test_1",
  "chat_id": "test_1",
  "text": "здравствуйте\nсколько стоит консультация? можно записаться?",
  "meta": {
    "first_name": "Test"
  }
}

Expected:
- reply contains consultation price if KB/context available
- asks for convenient day/time
- no booking call
- booking_result = null
- no phone request
- no admin notification

## Test 2: availability request with date

Input:

{
  "clinic_code": "clinic_1",
  "channel": "telegram",
  "external_user_id": "test_2",
  "chat_id": "test_2",
  "text": "на 16 число есть место?",
  "meta": {
    "first_name": "Test"
  }
}

Expected:
- bookingAction = propose_slot
- preferredDateIso = 2026-05-16
- booking_result.booking_status is awaiting_patient_confirmation or no_slots
- if awaiting_patient_confirmation: reply is built from booking_result.proposed_slot.label
- if no_slots: reply says no windows for that date
- never invent slots

## Test 3: confirmation

Precondition:
- active hold exists

Input:

{
  "clinic_code": "clinic_1",
  "channel": "telegram",
  "external_user_id": "test_2",
  "chat_id": "test_2",
  "text": "да, подходит",
  "meta": {
    "first_name": "Test"
  }
}

Expected:
- bookingAction = confirm_slot
- booking_result.booking_status = booked_pending_admin_confirmation or equivalent
- admin notification side_effect exists
- reply confirms appointment based on booking_result

## Test 4: rejection

Precondition:
- active hold exists

Input:

{
  "clinic_code": "clinic_1",
  "channel": "telegram",
  "external_user_id": "test_2",
  "chat_id": "test_2",
  "text": "нет, не подходит",
  "meta": {
    "first_name": "Test"
  }
}

Expected:
- bookingAction = cancel_hold
- reply asks for another convenient day/time
- no admin notification

## Test 5: no booking_result hallucination

If booking_result.status = none or reason = no_booking_action:
- do not say "нет свободных мест"
- do not say "записала"
- use safe fallback
