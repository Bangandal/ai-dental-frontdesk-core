import type {
  RuntimeBookingContext,
  RuntimeCaseContext,
  RuntimeClinicRecord,
  RuntimeContactRecord,
  RuntimeConvoStateRecord,
} from './runtimeTurnService.js';
import type { RuntimeTurnInput } from './runtimeContracts.js';

export const RUNTIME_PROMPT_VERSION = 'runtime-ai-extraction-v1';

export interface BuildRuntimePromptInput {
  traceId: string;
  clinic: RuntimeClinicRecord;
  contact: RuntimeContactRecord;
  turn: RuntimeTurnInput;
  convoState: RuntimeConvoStateRecord;
  caseContext: RuntimeCaseContext;
  bookingContext: RuntimeBookingContext;
}

export interface RuntimePrompt {
  prompt_version: string;
  system_prompt: string;
  context: Record<string, unknown>;
}

export function buildRuntimePrompt(input: BuildRuntimePromptInput): RuntimePrompt {
  return {
    prompt_version: RUNTIME_PROMPT_VERSION,
    system_prompt: RUNTIME_SYSTEM_PROMPT,
    context: {
      trace_id: input.traceId,
      channel: input.turn.channel,
      user_text: input.turn.text,
      clinic: {
        id: input.clinic.id,
        code: input.clinic.code,
        name: input.clinic.name,
        timezone: input.clinic.timezone,
        settings: input.clinic.settings,
      },
      contact: {
        id: input.contact.id,
        channel: input.contact.channel,
        external_user_id: input.contact.externalUserId,
      },
      inbound_meta: input.turn.meta ?? {},
      convo_state: {
        state: input.convoState.state,
        state_version: input.convoState.stateVersion,
      },
      case_context: input.caseContext,
      booking_context: input.bookingContext,
      output_contract: {
        reply_draft: 'string|null',
        conversation_intent:
          'greeting|faq|booking|availability_request|patient_confirmation|slot_rejected|objection|urgent|correction|off_topic|post_handoff_ack|follow_up|multi_patient_request|reschedule|cancel_appointment|unknown',
        requested_action:
          'continue|ask_slot|answer_faq|handoff|complete_intake|clarify|greeting|stop|check_availability|propose_slot|await_confirmation|confirm_slot|reject_slot|create_appointment',
        slot_updates: {
          name: 'string|null',
          service_interest: 'string|null',
          problem: 'string|null',
          phone: 'string|null',
          preferred_time: 'string|null',
          preferred_contact: 'string|null',
        },
        booking: {
          preferred_date_iso: 'string|null',
          preferred_weekday: 'string|null',
          time_of_day: 'morning|afternoon|evening|any|null',
          patient_confirmed_proposed_slot: 'boolean',
          patient_rejected_proposed_slot: 'boolean',
          selected_hold_id: 'string|null',
        },
        handoff_recommended: 'boolean',
        kb_used: 'boolean',
        confidence: 'high|medium|low',
      },
    },
  };
}

const RUNTIME_SYSTEM_PROMPT = [
  'You are a semantic extraction component for a dental clinic runtime.',
  'Return only valid JSON matching the provided output contract. Do not include markdown.',
  'AI is semantic perception only. Backend policy and booking_result are authoritative.',
  'Do not confirm bookings, create appointments, send notifications, mutate cases, or claim that a slot exists.',
  'Do not invent appointment slots, prices, services, doctors, policies, or unavailable facts.',
  'Use booking_context.active_hold to detect patient confirmations or rejections of a proposed held slot.',
  'Use case_context.current_case to continue an existing case and reuse already collected service interest when relevant.',
  'For Telegram, do not ask for a phone number unless the patient explicitly requests a callback.',
  'If booking interest has no date or time, set requested_action to ask_slot and draft a brief question for day/time.',
  'If the patient gives date/time or asks availability for a date, set requested_action to check_availability or propose_slot, but do not execute it.',
  'If active_hold exists and the patient confirms it, set requested_action to confirm_slot, booking.patient_confirmed_proposed_slot true, and selected_hold_id to active_hold.hold_id.',
  'If active_hold exists and the patient rejects it, set requested_action to reject_slot, booking.patient_rejected_proposed_slot true, and selected_hold_id to active_hold.hold_id.',
].join('\n');
