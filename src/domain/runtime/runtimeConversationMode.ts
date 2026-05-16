import type { BookingApplyResponse } from '../booking/bookingApply.js';
import type { RuntimeAIOutput } from './runtimeContracts.js';
import type { RuntimePolicyDecision } from './runtimePolicy.js';
import type { RuntimeBookingContext, RuntimeCaseContext } from './runtimeTurnService.js';

export const runtimeConversationModeValues = [
  'faq_price',
  'faq_insurance',
  'faq_address',
  'booking_interest',
  'availability_request',
  'slot_proposal',
  'slot_confirmation',
  'reschedule_request',
  'post_booking_question',
  'multi_patient_request',
  'human_handoff',
  'safe_fallback',
] as const;

export type RuntimeConversationMode = typeof runtimeConversationModeValues[number];

export interface RuntimeConversationModeInput {
  ai_output: RuntimeAIOutput | null;
  booking_result: BookingApplyResponse | null;
  policy_decision: RuntimePolicyDecision | null;
  case_context: RuntimeCaseContext;
  booking_context: RuntimeBookingContext;
}

export function classifyRuntimeConversationMode(input: RuntimeConversationModeInput): RuntimeConversationMode {
  if (input.booking_result?.booking_status === 'awaiting_patient_confirmation') {
    return 'slot_proposal';
  }

  if (input.booking_result?.booking_status === 'booked_pending_admin_confirmation') {
    return 'slot_confirmation';
  }

  if (input.booking_result?.booking_status === 'no_slots') {
    return 'availability_request';
  }

  if (input.booking_result?.booking_status === 'external_write_failed') {
    return 'human_handoff';
  }

  const aiOutput = input.ai_output;

  if (aiOutput === null) {
    return 'safe_fallback';
  }

  if (aiOutput.patient_scope === 'another_person' || aiOutput.patient_scope === 'multiple_people') {
    return 'multi_patient_request';
  }

  if (aiOutput.conversation_intent === 'reschedule' || aiOutput.conversation_intent === 'cancel_appointment') {
    return 'reschedule_request';
  }

  if (aiOutput.handoff_recommended === true || aiOutput.requested_action === 'handoff' || aiOutput.conversation_intent === 'urgent') {
    return 'human_handoff';
  }

  if (aiOutput.faq_topic === 'address') {
    return 'faq_address';
  }

  if (aiOutput.faq_topic === 'price') {
    return 'faq_price';
  }

  if (aiOutput.faq_topic === 'insurance') {
    return 'faq_insurance';
  }

  if (hasBookingContinuity(input.booking_context) && isNonBookingQuestion(aiOutput)) {
    return 'post_booking_question';
  }

  if (aiOutput.conversation_intent === 'availability_request' || input.policy_decision?.next_action === 'propose_slot') {
    return 'availability_request';
  }

  if (aiOutput.conversation_intent === 'booking' || input.policy_decision?.reason === 'booking_interest_missing_datetime') {
    return 'booking_interest';
  }

  return 'safe_fallback';
}

function hasBookingContinuity(bookingContext: RuntimeBookingContext): boolean {
  return bookingContext.active_hold !== null || bookingContext.latest_appointment !== null;
}

function isNonBookingQuestion(aiOutput: RuntimeAIOutput): boolean {
  return aiOutput.conversation_intent === 'faq'
    || aiOutput.conversation_intent === 'follow_up'
    || aiOutput.requested_action === 'answer_faq'
    || aiOutput.requested_action === 'continue'
    || aiOutput.requested_action === 'clarify';
}
