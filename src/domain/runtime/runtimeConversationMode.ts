import type { BookingApplyResponse } from '../booking/bookingApply.js';
import type { RuntimeAIOutput, RuntimeTurnInput } from './runtimeContracts.js';
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
  user_text: RuntimeTurnInput['text'];
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

  if (detectMultiPatientRequest(input.user_text) || aiOutput?.conversation_intent === 'multi_patient_request') {
    return 'multi_patient_request';
  }

  if (aiOutput?.conversation_intent === 'reschedule' || aiOutput?.conversation_intent === 'cancel_appointment') {
    return 'reschedule_request';
  }

  if (aiOutput?.handoff_recommended === true || aiOutput?.requested_action === 'handoff' || aiOutput?.conversation_intent === 'urgent') {
    return 'human_handoff';
  }

  if (detectAddressQuestion(input.user_text)) {
    return 'faq_address';
  }

  if (detectPriceQuestion(input.user_text)) {
    return 'faq_price';
  }

  if (detectInsuranceQuestion(input.user_text)) {
    return 'faq_insurance';
  }

  if (hasBookingContinuity(input.booking_context) && isNonBookingQuestion(aiOutput)) {
    return 'post_booking_question';
  }

  if (aiOutput?.conversation_intent === 'availability_request' || input.policy_decision?.next_action === 'propose_slot') {
    return 'availability_request';
  }

  if (aiOutput?.conversation_intent === 'booking' || input.policy_decision?.reason === 'booking_interest_missing_datetime') {
    return 'booking_interest';
  }

  return 'safe_fallback';
}

export function detectMultiPatientRequest(userText: string): boolean {
  const normalized = normalizeText(userText);
  const directPhrases = [
    'можно с парнем',
    'можна з хлопцем',
    'хочу записать мужа',
    'хочу записати чоловіка',
    'записать мужа',
    'записати чоловіка',
    'записать брата',
    'записати брата',
    'записать сестру',
    'записати сестру',
    'записать маму',
    'записати маму',
    'записать папу',
    'записати тата',
  ];

  if (directPhrases.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  const hasBookingVerb = normalized.includes('записать') || normalized.includes('записати');
  const hasOtherPatient = ['мужа', 'чоловіка', 'брата', 'сестру', 'маму', 'папу', 'тата', 'парнем', 'хлопцем']
    .some((word) => normalized.includes(word));

  return hasBookingVerb && hasOtherPatient;
}

function detectAddressQuestion(userText: string): boolean {
  const normalized = normalizeText(userText);

  return [
    'адрес',
    'адреса',
    'локация',
    'локація',
    'геолокация',
    'геолокація',
    'как добраться',
    'як дістатися',
    'где вы',
    'де ви',
    'карте',
    'мапі',
  ].some((phrase) => normalized.includes(phrase));
}

function detectPriceQuestion(userText: string): boolean {
  const normalized = normalizeText(userText);

  return [
    'сколько стоит',
    'скільки коштує',
    'цена',
    'ціна',
    'прайс',
    'стоимость',
    'вартість',
  ].some((phrase) => normalized.includes(phrase));
}

function detectInsuranceQuestion(userText: string): boolean {
  const normalized = normalizeText(userText);

  return ['страхов', 'страхів', 'insurance', 'pojist', 'pojišť'].some((phrase) => normalized.includes(phrase));
}

function hasBookingContinuity(bookingContext: RuntimeBookingContext): boolean {
  return bookingContext.active_hold !== null || bookingContext.latest_appointment !== null;
}

function isNonBookingQuestion(aiOutput: RuntimeAIOutput | null): boolean {
  if (aiOutput === null) {
    return false;
  }

  return aiOutput.conversation_intent === 'faq'
    || aiOutput.conversation_intent === 'follow_up'
    || aiOutput.requested_action === 'answer_faq'
    || aiOutput.requested_action === 'continue'
    || aiOutput.requested_action === 'clarify';
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase('uk-UA').replaceAll('ё', 'е').trim();
}
