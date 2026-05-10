import type { CaseRecord, CaseRepository } from './caseRepository.js';

const BOOKED_PENDING_ADMIN_STATUS = 'appointment_booked_pending_admin_confirmation';

export interface ResolveCaseInput {
  clinic_id: string;
  contact_id: string;
  conversation_intent: string;
  requested_action?: string;
  slot_updates?: Record<string, unknown>;
  booking?: Record<string, unknown>;
  current_text?: string;
}

export interface ResolveCaseResponse {
  case_id: string;
  action: 'attached_to_existing_case' | 'created_new_case' | 'updated_existing_case';
  status: string;
  case_type: string;
  topic?: string | null;
  reason: string;
}

export async function resolveCase(
  input: ResolveCaseInput,
  repository: CaseRepository,
): Promise<ResolveCaseResponse> {
  const recentCases = await repository.listRecentCases(input.clinic_id, input.contact_id);
  const latestCase = recentCases[0];

  if (isPostHandoffAcknowledgement(input) && latestCase !== undefined) {
    const updated = await touchCase(latestCase, input, repository, 'post_handoff_ack');
    return toResponse(updated, 'attached_to_existing_case', 'post_handoff_follow_up_attached');
  }

  if (isAppointmentConfirmation(input) && latestCase !== undefined) {
    const updated = await repository.updateCase({
      caseId: latestCase.id,
      status: BOOKED_PENDING_ADMIN_STATUS,
      currentStage: 'admin_confirmation_pending',
      collected: collectStructuredUpdates(input),
      meta: { last_case_resolution: 'appointment_confirmed' },
    });

    return toResponse(updated, 'updated_existing_case', 'appointment_booked_pending_admin_confirmation');
  }

  if (isMultiPatientRequest(input)) {
    const created = await createResolvedCase(input, repository, {
      caseType: 'multi_patient_request',
      reason: 'multi_patient_request_created_new_case',
    });

    return created;
  }

  if (latestCase === undefined) {
    if (isBookingOrAvailabilityRequest(input)) {
      return createResolvedCase(input, repository, {
        caseType: 'appointment_booking',
        reason: 'first_booking_case_created',
      });
    }

    return createResolvedCase(input, repository, {
      caseType: inferCaseType(input),
      reason: 'first_case_created',
    });
  }

  if (isBookedOrHandedOff(latestCase) && isDifferentServiceQuestion(input, latestCase)) {
    return createResolvedCase(input, repository, {
      caseType: 'informational',
      reason: 'new_topic_after_booked_case_created',
    });
  }

  const updated = await touchCase(latestCase, input, repository, 'attached_to_current_case');
  return toResponse(updated, 'attached_to_existing_case', 'latest_relevant_case_attached');
}

function isBookingOrAvailabilityRequest(input: ResolveCaseInput): boolean {
  return ['booking', 'availability_request', 'appointment_booking'].includes(input.conversation_intent)
    || ['check_availability', 'hold_slot', 'book_appointment'].includes(input.requested_action ?? '');
}

function isAppointmentConfirmation(input: ResolveCaseInput): boolean {
  const bookingStatus = readString(input.booking, 'status');

  return ['confirm_slot', 'confirm_appointment', 'appointment_confirmed'].includes(input.requested_action ?? '')
    || ['confirmed', 'booked', 'booked_pending_admin_confirmation'].includes(bookingStatus ?? '');
}

function isMultiPatientRequest(input: ResolveCaseInput): boolean {
  return input.conversation_intent === 'multi_patient_request'
    || input.requested_action === 'create_related_patient_case'
    || readString(input.slot_updates, 'patient_context') === 'someone_else'
    || readString(input.slot_updates, 'patient_relationship') !== undefined;
}

function isPostHandoffAcknowledgement(input: ResolveCaseInput): boolean {
  return ['post_handoff_ack', 'follow_up'].includes(input.conversation_intent)
    || ['acknowledge_handoff', 'follow_up_existing_case'].includes(input.requested_action ?? '');
}

function isBookedOrHandedOff(caseRecord: CaseRecord): boolean {
  return [BOOKED_PENDING_ADMIN_STATUS, 'booked_pending_admin_confirmation', 'handed_off'].includes(caseRecord.status)
    || ['admin_confirmation_pending', 'handed_off'].includes(caseRecord.currentStage ?? '');
}

function isDifferentServiceQuestion(input: ResolveCaseInput, caseRecord: CaseRecord): boolean {
  if (!isInformationalQuestion(input)) {
    return false;
  }

  const incomingTopic = inferTopic(input);
  const currentTopic = caseRecord.topic ?? readString(caseRecord.collected, 'service') ?? readString(caseRecord.collected, 'topic');

  return incomingTopic !== undefined && incomingTopic !== currentTopic;
}

function isInformationalQuestion(input: ResolveCaseInput): boolean {
  return ['faq', 'informational', 'service_question'].includes(input.conversation_intent)
    || ['answer_question', 'provide_information'].includes(input.requested_action ?? '');
}

async function createResolvedCase(
  input: ResolveCaseInput,
  repository: CaseRepository,
  options: { caseType: string; reason: string },
): Promise<ResolveCaseResponse> {
  const created = await repository.createCase({
    clinicId: input.clinic_id,
    contactId: input.contact_id,
    caseType: options.caseType,
    topic: inferTopic(input),
    status: 'open',
    currentStage: inferCurrentStage(input),
    collected: collectStructuredUpdates(input),
    meta: {
      conversation_intent: input.conversation_intent,
      requested_action: input.requested_action,
      case_resolution_reason: options.reason,
    },
  });

  return toResponse(created, 'created_new_case', options.reason);
}

async function touchCase(
  caseRecord: CaseRecord,
  input: ResolveCaseInput,
  repository: CaseRepository,
  resolution: string,
): Promise<CaseRecord> {
  return repository.updateCase({
    caseId: caseRecord.id,
    topic: caseRecord.topic ?? inferTopic(input),
    currentStage: inferCurrentStage(input) ?? caseRecord.currentStage ?? undefined,
    collected: collectStructuredUpdates(input),
    meta: {
      conversation_intent: input.conversation_intent,
      requested_action: input.requested_action,
      last_case_resolution: resolution,
    },
  });
}

function collectStructuredUpdates(input: ResolveCaseInput): Record<string, unknown> {
  return {
    ...(input.slot_updates ?? {}),
    ...(input.booking === undefined ? {} : { booking: input.booking }),
  };
}

function inferCaseType(input: ResolveCaseInput): string {
  if (isBookingOrAvailabilityRequest(input)) {
    return 'appointment_booking';
  }

  if (isInformationalQuestion(input)) {
    return 'informational';
  }

  return input.conversation_intent;
}

function inferCurrentStage(input: ResolveCaseInput): string | undefined {
  if (isAppointmentConfirmation(input)) {
    return 'admin_confirmation_pending';
  }

  if (isBookingOrAvailabilityRequest(input)) {
    return 'scheduling';
  }

  if (isInformationalQuestion(input)) {
    return 'information_requested';
  }

  return undefined;
}

function inferTopic(input: ResolveCaseInput): string | undefined {
  return readString(input.slot_updates, 'topic')
    ?? readString(input.slot_updates, 'service')
    ?? readString(input.slot_updates, 'treatment')
    ?? readString(input.booking, 'service');
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toResponse(
  caseRecord: CaseRecord,
  action: ResolveCaseResponse['action'],
  reason: string,
): ResolveCaseResponse {
  return {
    case_id: caseRecord.id,
    action,
    status: caseRecord.status,
    case_type: caseRecord.caseType,
    topic: caseRecord.topic,
    reason,
  };
}
