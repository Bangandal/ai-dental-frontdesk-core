import type { BookingApplyRequest, TimeOfDay } from '../booking/bookingApply.js';
import type { RuntimeAIOutput, RuntimeTurnInput } from './runtimeContracts.js';
import { planRuntimeAvailability } from './runtimeAvailabilityPlanner.js';
import type { RuntimeBookingContext, RuntimeCaseContext, RuntimeClinicRecord } from './runtimeTurnService.js';

export interface RuntimePolicyInput {
  ai_output: RuntimeAIOutput | null;
  case_context: RuntimeCaseContext;
  booking_context: RuntimeBookingContext;
  clinic: RuntimeClinicRecord;
  contact_id: string;
  channel: RuntimeTurnInput['channel'];
  meta?: RuntimeTurnInput['meta'];
  trace_id: string;
  current_time_iso?: string;
  current_clinic_date_iso?: string;
}

export interface RuntimePolicyDecision {
  next_action: string;
  should_call_booking: boolean;
  booking_request: BookingApplyRequest | null;
  reason: string;
  warnings: string[];
  reply_text?: string;
}

const availabilityActions = new Set<RuntimeAIOutput['requested_action']>(['check_availability', 'propose_slot']);
const bookingInterestActions = new Set<RuntimeAIOutput['requested_action']>([
  'ask_slot',
  'await_confirmation',
  'create_appointment',
]);
const bookingIntents = new Set<RuntimeAIOutput['conversation_intent']>(['booking', 'availability_request']);
const faqIntents = new Set<RuntimeAIOutput['conversation_intent']>(['faq', 'greeting']);
const pureFaqActions = new Set<RuntimeAIOutput['requested_action']>(['answer_faq', 'continue', 'greeting', 'clarify']);

export function decideRuntimeAction(input: RuntimePolicyInput): RuntimePolicyDecision {
  const aiOutput = input.ai_output;

  if (aiOutput === null) {
    return noBooking('safe_fallback', 'invalid_or_missing_ai_output');
  }

  if (aiOutput.conversation_intent === 'off_topic') {
    return {
      ...noBooking('respond_clinic_scoped', 'off_topic'),
      reply_text: 'Можу допомогти з питаннями клініки або записом на прийом.',
    };
  }

  const activeHold = input.booking_context.active_hold;
  const booking = aiOutput.booking;

  if (
    activeHold !== null
    && (aiOutput.requested_action === 'confirm_slot' || booking.patient_confirmed_proposed_slot)
  ) {
    const activeHoldId = readNonEmpty(booking.selected_hold_id) ?? activeHold.hold_id ?? activeHold.dedupe_key;

    return callBooking('confirm_slot', 'active_hold_patient_confirmation', {
      clinicId: input.clinic.id,
      contactId: input.contact_id,
      caseId: activeHold.case_id ?? input.case_context.current_case_id,
      bookingAction: 'confirm_slot',
      serviceInterest: activeHold.service_interest ?? activeHold.service ?? readServiceInterest(input),
      activeHoldId,
      patientName: readPatientName(input.meta),
      channel: input.channel,
      traceId: input.trace_id,
      timeOfDay: normalizeTimeOfDay(booking.time_of_day),
      durationMinutes: 30,
      metadata: buildPolicyMetadata(input, 'confirm_slot'),
    });
  }

  if (
    activeHold !== null
    && (aiOutput.requested_action === 'reject_slot' || booking.patient_rejected_proposed_slot)
  ) {
    const activeHoldId = readNonEmpty(booking.selected_hold_id) ?? activeHold.hold_id ?? activeHold.dedupe_key;

    return callBooking('cancel_hold', 'active_hold_patient_rejection', {
      clinicId: input.clinic.id,
      contactId: input.contact_id,
      caseId: activeHold.case_id ?? input.case_context.current_case_id,
      bookingAction: 'cancel_hold',
      serviceInterest: activeHold.service_interest ?? activeHold.service ?? readServiceInterest(input),
      activeHoldId,
      patientName: readPatientName(input.meta),
      channel: input.channel,
      traceId: input.trace_id,
      timeOfDay: normalizeTimeOfDay(booking.time_of_day),
      durationMinutes: 30,
      metadata: buildPolicyMetadata(input, 'cancel_hold'),
    });
  }

  const isAvailabilityRequest = availabilityActions.has(aiOutput.requested_action)
    || aiOutput.conversation_intent === 'availability_request';

  if (isAvailabilityRequest) {
    const availabilityDecision = planRuntimeAvailability({
      ai_output: aiOutput,
      case_context: input.case_context,
      booking_context: input.booking_context,
      clinic: input.clinic,
      contact_id: input.contact_id,
      channel: input.channel,
      meta: input.meta,
      trace_id: input.trace_id,
      current_time_iso: input.current_time_iso,
      current_clinic_date_iso: input.current_clinic_date_iso ?? readDatePart(input.current_time_iso) ?? new Date().toISOString().slice(0, 10),
    });
    return {
      next_action: availabilityDecision.booking_action ?? (availabilityDecision.should_call_booking ? 'propose_slot' : 'ask_preferred_datetime'),
      should_call_booking: availabilityDecision.should_call_booking,
      booking_request: availabilityDecision.booking_request,
      reason: availabilityDecision.reason,
      warnings: availabilityDecision.warnings,
      reply_text: availabilityDecision.reply_text,
    };
  }

  const hasPreferredDate = readNonEmpty(booking.preferred_date_iso) !== undefined;
  const hasPreferredWeekday = readNonEmpty(booking.preferred_weekday) !== undefined;
  const hasPreferredDateOrWeekday = hasPreferredDate || hasPreferredWeekday;
  const hasBookingInterest = bookingIntents.has(aiOutput.conversation_intent)
    || bookingInterestActions.has(aiOutput.requested_action)
    || isAvailabilityRequest;

  if (hasBookingInterest && !hasPreferredDateOrWeekday) {
    return {
      ...noBooking('ask_preferred_datetime', 'booking_interest_missing_datetime'),
      reply_text: 'Підкажіть, будь ласка, який день і час Вам зручні 🙂',
    };
  }

  if (faqIntents.has(aiOutput.conversation_intent) && pureFaqActions.has(aiOutput.requested_action)) {
    return noBooking('reply_from_ai', 'no_booking_for_faq');
  }

  return noBooking('reply_from_ai', 'no_booking_policy_match');
}

function callBooking(
  nextAction: string,
  reason: string,
  bookingRequest: BookingApplyRequest,
): RuntimePolicyDecision {
  return {
    next_action: nextAction,
    should_call_booking: true,
    booking_request: bookingRequest,
    reason,
    warnings: [],
  };
}

function noBooking(nextAction: string, reason: string): RuntimePolicyDecision {
  return {
    next_action: nextAction,
    should_call_booking: false,
    booking_request: null,
    reason,
    warnings: [],
  };
}

function readServiceInterest(input: RuntimePolicyInput): string | null {
  return readNonEmpty(input.ai_output?.slot_updates.service_interest)
    ?? readNonEmpty(input.case_context.current_case?.collected.service_interest)
    ?? readNonEmpty(input.booking_context.active_hold?.service_interest)
    ?? readNonEmpty(input.booking_context.active_hold?.service)
    ?? null;
}

function normalizeTimeOfDay(value: RuntimeAIOutput['booking']['time_of_day']): TimeOfDay {
  return value ?? 'any';
}

function readPatientName(meta: RuntimeTurnInput['meta'] | undefined): string | null {
  const parts = [readNonEmpty(meta?.first_name), readNonEmpty(meta?.last_name)].filter((part): part is string => part !== undefined);

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' ');
}

function readNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function buildPolicyMetadata(input: RuntimePolicyInput, policyAction: string): Record<string, unknown> {
  return {
    source: 'runtime_policy',
    policy_action: policyAction,
    clinic_timezone: input.clinic.timezone,
    current_time_iso: input.current_time_iso ?? null,
  };
}

function readDatePart(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : undefined;
}
