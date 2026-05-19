import type {
  RuntimeBookingContext,
  RuntimeCaseContext,
  RuntimeClinicRecord,
  RuntimeContactRecord,
  RuntimeConvoStateRecord,
} from './runtimeTurnService.js';
import type { RuntimeTurnInput } from './runtimeContracts.js';
import { getClinicLocalDateIso, getClinicLocalDateTimeIso } from './runtimeDateNormalizer.js';

export const RUNTIME_PROMPT_VERSION = 'runtime-ai-extraction-v1';

export interface BuildRuntimePromptInput {
  traceId: string;
  clinic: RuntimeClinicRecord;
  contact: RuntimeContactRecord;
  turn: RuntimeTurnInput;
  convoState: RuntimeConvoStateRecord;
  caseContext: RuntimeCaseContext;
  bookingContext: RuntimeBookingContext;
  now?: Date;
}

export interface RuntimePrompt {
  prompt_version: string;
  system_prompt: string;
  context: Record<string, unknown>;
}

export function buildRuntimePrompt(input: BuildRuntimePromptInput): RuntimePrompt {
  const now = input.now ?? new Date();
  const currentDateIso = getClinicLocalDateIso(input.clinic.timezone, now);
  const currentDateTimeIso = getClinicLocalDateTimeIso(input.clinic.timezone, now);

  return {
    prompt_version: RUNTIME_PROMPT_VERSION,
    system_prompt: RUNTIME_SYSTEM_PROMPT,
    context: {
      trace_id: input.traceId,
      channel: input.turn.channel,
      user_text: input.turn.text,
      current_date_iso: currentDateIso,
      current_datetime_iso: currentDateTimeIso,
      clinic_timezone: input.clinic.timezone,
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
          'greeting|faq|booking|availability_request|slot_selection|patient_confirmation|slot_rejected|objection|urgent|correction|off_topic|post_handoff_ack|follow_up|multi_patient_request|reschedule|cancel_appointment|unknown',
        requested_action:
          'continue|ask_slot|answer_faq|handoff|complete_intake|clarify|greeting|stop|check_availability|propose_slot|select_slot|await_confirmation|confirm_slot|reject_slot|create_appointment',
        slot_updates: {
          name: 'string|null',
          service_interest: 'string|null',
          problem: 'string|null',
          phone: 'string|null',
          preferred_time: 'string|null',
          preferred_contact: 'string|null',
        },
        availability_query: {
          search_type: 'nearest_available|specific_date|weekday|relative_day|exact_slot|time_constraint|unknown',
          date_iso: 'YYYY-MM-DD|null',
          weekday: 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|null',
          relative_day: 'today|tomorrow|day_after_tomorrow|null',
          time_window: {
            type: 'morning|afternoon|evening|before|after|between|any',
            start_time: 'HH:mm|null',
            end_time: 'HH:mm|null',
          },
          exact_time: 'HH:mm|null',
          flexibility: 'specific|flexible|nearest|unknown',
        },
        slot_selection: {
          selected_option_id: 'string|null',
          selected_start_at: 'ISO datetime string|null',
          selected_time: 'HH:mm|null',
          selection_confidence: 'high|medium|low|unknown',
        },
        booking: {
          preferred_date_iso: 'string|null',
          preferred_weekday: 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|null',
          time_of_day: 'morning|afternoon|evening|any|null',
          patient_confirmed_proposed_slot: 'boolean',
          patient_rejected_proposed_slot: 'boolean',
          selected_hold_id: 'string|null',
        },
        faq_topic: 'price|address|insurance|services|contacts|hours|other|unknown',
        patient_scope: 'self|another_person|multiple_people|unknown',
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
  'Use convo_state.state.runtime.last_proposed_slots to semantically extract the patient choice among previously offered slot options into slot_selection.',
  'If the patient clearly chose an offered option number, fill slot_selection.selected_option_id with that stored option ID.',
  'If the patient refers to a specific offered time, fill slot_selection.selected_time in HH:mm.',
  'If the patient refers to a specific offered start datetime, fill slot_selection.selected_start_at with that exact stored ISO datetime.',
  'If uncertain, set slot_selection.selection_confidence to low or unknown and leave uncertain fields null.',
  'Do not confirm booking directly from slot selection. Do not invent option IDs, start datetimes, or slot times. Do not claim a slot is booked.',
  'Use case_context.current_case to continue an existing case and reuse already collected service interest when relevant.',
  'For Telegram, do not ask for a phone number unless the patient explicitly requests a callback.',
  'Use context.current_date_iso and context.clinic_timezone when interpreting explicit dates.',
  'If the patient gives explicit dates like DD.MM, DD.MM.YYYY, DD-MM, DD/MM, or YYYY-MM-DD, resolve them to booking.preferred_date_iso in YYYY-MM-DD when confident.',
  'Ambiguous bare numbers and broad day-of-month phrases like “на 18”, “на 18 число”, “18 числа”, or “18-го” must be left as preferred_date_iso null.',
  'booking.preferred_weekday is only for weekday names: monday, tuesday, wednesday, thursday, friday, saturday, sunday.',
  'Never put an ISO date, numeric date, or day-of-month into booking.preferred_weekday.',
  'If unsure about a date, leave booking.preferred_date_iso null and let backend policy ask a clarifying question.',
  'Extract appointment nouns and service phrases into slot_updates.service_interest whenever present, even when the user does not use words like service or услуга.',
  'For exact booking phrases with a service plus date/time, fill slot_updates.service_interest with the appointment noun phrase and fill the typed date/time fields.',
  'Examples: “Хочу записаться на консультацию стоматолога 23.05 на 08:00” -> service_interest “консультация стоматолога”, availability_query.search_type exact_slot, date_iso resolved, exact_time “08:00”.',
  'Examples: “Хочу на консультацию 23.05 в 08:00” -> service_interest “консультация”, exact_slot date/time. “На чистку завтра утром” -> service_interest “чистка”, relative_day tomorrow and morning window.',
  'Do not require extra wording like “услуга” to extract service_interest from booking or availability phrases.',
  'If booking interest has no date or time, set requested_action to ask_slot and draft a brief question for day/time.',
  'If the patient gives date/time or asks availability for a date, set requested_action to check_availability or propose_slot, but do not execute it.',
  'For availability or booking time questions, always fill availability_query with typed semantic fields; use null for fields that do not apply. Numeric day-month dates like 16.05, 16.05.2026, 16-05, and 16/05 must be resolved into availability_query.date_iso using context.current_date_iso and context.clinic_timezone.',
  'For “когда есть свободно?” or equivalent open availability requests, set availability_query.search_type to nearest_available and availability_query.flexibility to flexible, not nearest.',
  'Set availability_query.flexibility to nearest only when the patient explicitly asks for the soonest, earliest, nearest, or as-soon-as-possible appointment.',
  'Generic broad availability questions like “когда есть свободно?”, “какие есть варианты?”, and “когда можно записаться?” must not be treated as nearest by default; use flexibility flexible unless another typed non-nearest value is more precise.',
  'For weekday requests, set availability_query.search_type to weekday and fill availability_query.weekday.',
  'For today, tomorrow, or day after tomorrow requests, set availability_query.search_type to relative_day and fill availability_query.relative_day.',
  'For “до 10”, set availability_query.search_type to time_constraint and availability_query.time_window to { type: "before", start_time: null, end_time: "10:00" }.',
  'For “после обеда”, use a typed afternoon window, or an after window only when the user gave a concrete HH:mm boundary.',
  'For exact HH:mm requests, fill availability_query.exact_time in HH:mm and use search_type exact_slot when a date/day is also specified.',
  'If availability meaning is uncertain, set availability_query.search_type to unknown and leave date, weekday, relative_day, time_window, and exact_time null.',
  'If active_hold exists and the patient confirms it, set requested_action to confirm_slot, booking.patient_confirmed_proposed_slot true, and selected_hold_id to active_hold.hold_id.',
  'If active_hold exists and the patient rejects it, set requested_action to reject_slot, booking.patient_rejected_proposed_slot true, and selected_hold_id to active_hold.hold_id.',
  'Set faq_topic from semantic meaning only: price, insurance, address, other, or unknown.',
  'For price questions, extract the named service phrase into slot_updates.service_interest even when the patient does not say “service” or “услуга”.',
  'Price examples: “Сколько стоит чистка?” -> service_interest “чистка”; “цена чистки зубов” -> “чистка зубов”; “сколько стоит консультация?” -> “консультация”; “сколько стоит отбеливание?” -> “отбеливание”.',
  'Set patient_scope from semantic meaning only: self, another_person, multiple_people, or unknown.',
].join('\n');
