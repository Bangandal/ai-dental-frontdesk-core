import type { BookingApplyRequest, BookingApplyResponse } from '../booking/bookingApply.js';
import type { RuntimeAIOutput } from './runtimeContracts.js';
import type { RuntimeBookingContext, RuntimeConvoStateRecord } from './runtimeTurnService.js';
import type { RuntimeProposedSlotMemory } from './runtimeSlotChoiceResolver.js';

export type RuntimeCaseMemoryType = 'booking' | 'faq_price' | 'mixed' | 'unknown';
export type RuntimeCaseMemoryStatus = 'collecting' | 'awaiting_slot_choice' | 'awaiting_confirmation' | 'answered' | 'closed';
export type RuntimeCaseMemorySlotSource = 'ai' | 'case_memory' | 'faq_price_followup' | 'booking_turn' | 'normalizer';

export interface RuntimeCaseMemorySlotValue {
  value: string;
  source: RuntimeCaseMemorySlotSource;
  updated_at: string;
  trace_id: string;
}

export interface RuntimeCaseMemoryQuestion {
  purpose: 'collect_missing_slot';
  slot: 'service_interest' | 'preferred_datetime';
  topic: 'price' | 'booking';
  asked_at: string;
  trace_id: string;
}

export interface RuntimeCaseMemoryCase {
  id: string;
  type: RuntimeCaseMemoryType;
  status: RuntimeCaseMemoryStatus;
  collected: {
    service_interest?: RuntimeCaseMemorySlotValue;
    preferred_date_iso?: RuntimeCaseMemorySlotValue;
    exact_time?: RuntimeCaseMemorySlotValue;
  };
  last_assistant_question?: RuntimeCaseMemoryQuestion;
  proposed_slots: RuntimeProposedSlotMemory[];
  active_hold: Record<string, unknown> | null;
  last_intent: string | null;
  updated_at: string;
}

export interface RuntimeCaseMemory {
  current_case_id: 'local_current';
  cases: RuntimeCaseMemoryCase[];
}

export interface RuntimeResolvedTurnContext {
  ai_intent: string | null;
  ai_requested_action: string | null;
  ai_service_interest: string | null;
  memory_service_interest: string | null;
  resolved_service_interest: string | null;
  service_interest_source: 'ai' | 'case_memory' | 'none';
  availability_query: RuntimeAIOutput['availability_query'] | null;
  resolved_date_iso: string | null;
  resolved_exact_time: string | null;
  active_hold: RuntimeBookingContext['active_hold'];
  last_proposed_slots_count: number;
  pending_question: RuntimeCaseMemoryQuestion | null;
  current_case_type: RuntimeCaseMemoryType;
  current_status: RuntimeCaseMemoryStatus;
  warnings: string[];
}

export interface RuntimeContextResolution {
  ai_output: RuntimeAIOutput;
  case_memory_before: RuntimeCaseMemory;
  case_memory_after: RuntimeCaseMemory;
  resolved_turn_context: RuntimeResolvedTurnContext;
  changed: boolean;
}

const currentCaseId = 'local_current' as const;

export function resolveRuntimeTurnContext(input: {
  aiOutput: RuntimeAIOutput;
  convoState: RuntimeConvoStateRecord;
  bookingContext: RuntimeBookingContext;
  traceId: string;
  nowIso: string;
  pendingPriceFollowup: boolean;
}): RuntimeContextResolution {
  const caseMemoryBefore = readRuntimeCaseMemory(input.convoState.state);
  let caseMemoryAfter = cloneCaseMemory(caseMemoryBefore);
  let currentCase = ensureCurrentCase(caseMemoryAfter, input.nowIso);
  const aiServiceInterest = readNonEmpty(input.aiOutput.slot_updates.service_interest);
  const memoryServiceInterest = readNonEmpty(currentCase.collected.service_interest?.value);
  const shouldUseMemory = shouldResolveServiceFromMemory(input.aiOutput)
    && aiServiceInterest === null
    && memoryServiceInterest !== null;
  const resolvedServiceInterest = aiServiceInterest ?? (shouldUseMemory ? memoryServiceInterest : null);
  const serviceInterestSource = aiServiceInterest !== null ? 'ai' : shouldUseMemory ? 'case_memory' : 'none';
  let memoryChanged = false;
  const resolvedAiOutput = shouldUseMemory
    ? {
      ...input.aiOutput,
      slot_updates: {
        ...input.aiOutput.slot_updates,
        service_interest: memoryServiceInterest,
      },
    }
    : input.aiOutput;

  if (aiServiceInterest !== null && isMeaningfulTurn(input.aiOutput)) {
    memoryChanged = true;
    currentCase = upsertServiceInterest({
      caseMemory: caseMemoryAfter,
      value: aiServiceInterest,
      source: input.pendingPriceFollowup ? 'faq_price_followup' : isBookingOrAvailabilityTurn(input.aiOutput) ? 'booking_turn' : 'ai',
      traceId: input.traceId,
      nowIso: input.nowIso,
    });
  }

  if (memoryChanged) {
    const dateResult = upsertDateAndTime({
      currentCase,
      aiOutput: resolvedAiOutput,
      traceId: input.traceId,
      nowIso: input.nowIso,
    });
    currentCase = dateResult.currentCase;
    currentCase.type = resolveCaseType(currentCase.type, resolvedAiOutput);
    currentCase.status = resolveCaseStatus(currentCase.status, resolvedAiOutput);
    currentCase.last_intent = resolvedAiOutput.conversation_intent;
    currentCase.updated_at = input.nowIso;
  }

  const runtimeState = readRecord(input.convoState.state.runtime);
  const lastProposedSlots = readProposedSlotMemory(runtimeState.last_proposed_slots);
  const proposedSlotsCount = currentCase.proposed_slots.length > 0 ? currentCase.proposed_slots.length : lastProposedSlots.length;
  const resolvedContext: RuntimeResolvedTurnContext = {
    ai_intent: resolvedAiOutput.conversation_intent,
    ai_requested_action: resolvedAiOutput.requested_action,
    ai_service_interest: aiServiceInterest,
    memory_service_interest: memoryServiceInterest,
    resolved_service_interest: resolvedServiceInterest,
    service_interest_source: serviceInterestSource,
    availability_query: resolvedAiOutput.availability_query,
    resolved_date_iso: readNonEmpty(resolvedAiOutput.availability_query?.date_iso) ?? readNonEmpty(resolvedAiOutput.booking.preferred_date_iso) ?? readNonEmpty(currentCase.collected.preferred_date_iso?.value),
    resolved_exact_time: readNonEmpty(resolvedAiOutput.availability_query?.exact_time) ?? readNonEmpty(currentCase.collected.exact_time?.value),
    active_hold: input.bookingContext.active_hold,
    last_proposed_slots_count: proposedSlotsCount,
    pending_question: currentCase.last_assistant_question ?? null,
    current_case_type: currentCase.type,
    current_status: currentCase.status,
    warnings: [],
  };

  return {
    ai_output: resolvedAiOutput,
    case_memory_before: caseMemoryBefore,
    case_memory_after: caseMemoryAfter,
    resolved_turn_context: resolvedContext,
    changed: memoryChanged && JSON.stringify(caseMemoryBefore) !== JSON.stringify(caseMemoryAfter),
  };
}

export function readRuntimeCaseMemory(state: Record<string, unknown>): RuntimeCaseMemory {
  const runtimeState = readRecord(state.runtime);
  const rawMemory = readRecord(runtimeState.case_memory);
  const rawCases = Array.isArray(rawMemory.cases) ? rawMemory.cases : [];
  const cases = rawCases.flatMap((item): RuntimeCaseMemoryCase[] => {
    const record = readRecord(item);
    const id = readNonEmpty(record.id);
    if (id === null) {
      return [];
    }
    const collected = readRecord(record.collected);
    return [{
      id,
      type: readCaseType(record.type),
      status: readCaseStatus(record.status),
      collected: {
        service_interest: readSlotValue(collected.service_interest),
        preferred_date_iso: readSlotValue(collected.preferred_date_iso),
        exact_time: readSlotValue(collected.exact_time),
      },
      last_assistant_question: readQuestion(record.last_assistant_question),
      proposed_slots: readProposedSlotMemory(record.proposed_slots),
      active_hold: readNullableRecord(record.active_hold),
      last_intent: readNonEmpty(record.last_intent),
      updated_at: readNonEmpty(record.updated_at) ?? new Date(0).toISOString(),
    }];
  });

  const memory: RuntimeCaseMemory = {
    current_case_id: currentCaseId,
    cases,
  };
  ensureCurrentCase(memory, new Date(0).toISOString());
  return memory;
}

export function writeRuntimeCaseMemory(state: Record<string, unknown>, caseMemory: RuntimeCaseMemory): Record<string, unknown> {
  return {
    ...state,
    runtime: {
      ...readRecord(state.runtime),
      case_memory: caseMemory,
    },
  };
}

export function mirrorPendingQuestion(input: {
  state: Record<string, unknown>;
  slot: 'service_interest' | 'preferred_datetime';
  topic: 'price' | 'booking';
  askedAt: string;
  traceId: string;
}): { state: Record<string, unknown>; case_memory: RuntimeCaseMemory } {
  const caseMemory = cloneCaseMemory(readRuntimeCaseMemory(input.state));
  const currentCase = ensureCurrentCase(caseMemory, input.askedAt);
  currentCase.last_assistant_question = {
    purpose: 'collect_missing_slot',
    slot: input.slot,
    topic: input.topic,
    asked_at: input.askedAt,
    trace_id: input.traceId,
  };
  currentCase.type = input.topic === 'price'
    ? currentCase.type === 'booking' || currentCase.type === 'mixed' ? 'mixed' : 'faq_price'
    : resolveTypeWithBooking(currentCase.type);
  currentCase.status = 'collecting';
  currentCase.updated_at = input.askedAt;
  return { state: writeRuntimeCaseMemory(input.state, caseMemory), case_memory: caseMemory };
}

export function mirrorProposedSlots(input: {
  state: Record<string, unknown>;
  proposedSlots: RuntimeProposedSlotMemory[];
  status: RuntimeCaseMemoryStatus;
  updatedAt: string;
}): { state: Record<string, unknown>; case_memory: RuntimeCaseMemory } {
  const caseMemory = cloneCaseMemory(readRuntimeCaseMemory(input.state));
  const currentCase = ensureCurrentCase(caseMemory, input.updatedAt);
  currentCase.proposed_slots = input.proposedSlots;
  currentCase.status = input.status;
  currentCase.type = resolveTypeWithBooking(currentCase.type);
  currentCase.updated_at = input.updatedAt;
  return { state: writeRuntimeCaseMemory(input.state, caseMemory), case_memory: caseMemory };
}

export function buildRuntimeStateUpdate(runtimeState: Record<string, unknown>): Record<string, unknown> {
  return { ...runtimeState };
}

export function proposedSlotsFromBookingResult(input: {
  bookingResult: BookingApplyResponse;
  bookingRequest: BookingApplyRequest;
}): RuntimeProposedSlotMemory[] {
  if (input.bookingResult.booking_status !== 'awaiting_slot_choice') {
    return [];
  }

  return input.bookingResult.proposed_slots.slice(0, 3).map((slot, index): RuntimeProposedSlotMemory => ({
    option_id: slot.option_id ?? String(index + 1),
    start_at: slot.start_at,
    end_at: slot.end_at,
    label: slot.label,
    cell_range: slot.cell_range,
    sheet_name: slot.sheet_name,
    service_interest: slot.service_interest,
    preferred_date_iso: input.bookingRequest.preferredDateIso ?? null,
    time_of_day: input.bookingRequest.timeOfDay,
    exact_time: input.bookingRequest.exactTime ?? null,
    provider_metadata: slot.provider_metadata ?? {},
  }));
}

function ensureCurrentCase(caseMemory: RuntimeCaseMemory, nowIso: string): RuntimeCaseMemoryCase {
  const existing = caseMemory.cases.find((candidate) => candidate.id === currentCaseId);
  if (existing !== undefined) {
    return existing;
  }
  const created: RuntimeCaseMemoryCase = {
    id: currentCaseId,
    type: 'unknown',
    status: 'collecting',
    collected: {},
    proposed_slots: [],
    active_hold: null,
    last_intent: null,
    updated_at: nowIso,
  };
  caseMemory.cases.unshift(created);
  return created;
}

function upsertServiceInterest(input: {
  caseMemory: RuntimeCaseMemory;
  value: string;
  source: RuntimeCaseMemorySlotSource;
  traceId: string;
  nowIso: string;
}): RuntimeCaseMemoryCase {
  const currentCase = ensureCurrentCase(input.caseMemory, input.nowIso);
  currentCase.collected.service_interest = {
    value: input.value,
    source: input.source,
    updated_at: input.nowIso,
    trace_id: input.traceId,
  };
  return currentCase;
}

function upsertDateAndTime(input: {
  currentCase: RuntimeCaseMemoryCase;
  aiOutput: RuntimeAIOutput;
  traceId: string;
  nowIso: string;
}): { currentCase: RuntimeCaseMemoryCase; changed: boolean } {
  let changed = false;
  const preferredDate = readNonEmpty(input.aiOutput.availability_query?.date_iso) ?? readNonEmpty(input.aiOutput.booking.preferred_date_iso);
  if (preferredDate !== null) {
    changed = true;
    input.currentCase.collected.preferred_date_iso = {
      value: preferredDate,
      source: readNonEmpty(input.aiOutput.availability_query?.date_iso) !== null ? 'normalizer' : 'ai',
      updated_at: input.nowIso,
      trace_id: input.traceId,
    };
  }
  const exactTime = readNonEmpty(input.aiOutput.availability_query?.exact_time);
  if (exactTime !== null) {
    changed = true;
    input.currentCase.collected.exact_time = {
      value: exactTime,
      source: 'ai',
      updated_at: input.nowIso,
      trace_id: input.traceId,
    };
  }
  return { currentCase: input.currentCase, changed };
}

function shouldResolveServiceFromMemory(aiOutput: RuntimeAIOutput): boolean {
  return isBookingOrAvailabilityTurn(aiOutput);
}

function isBookingOrAvailabilityTurn(aiOutput: RuntimeAIOutput): boolean {
  return aiOutput.conversation_intent === 'booking'
    || aiOutput.conversation_intent === 'availability_request'
    || aiOutput.requested_action === 'check_availability'
    || aiOutput.requested_action === 'propose_slot'
    || aiOutput.requested_action === 'ask_slot'
    || hasAvailabilityQuery(aiOutput);
}

function hasAvailabilityQuery(aiOutput: RuntimeAIOutput): boolean {
  return aiOutput.availability_query !== null && aiOutput.availability_query.search_type !== 'unknown';
}

function isMeaningfulTurn(aiOutput: RuntimeAIOutput): boolean {
  return aiOutput.conversation_intent !== 'unknown' || aiOutput.requested_action !== 'clarify' || aiOutput.faq_topic !== 'unknown';
}

function resolveCaseType(current: RuntimeCaseMemoryType, aiOutput: RuntimeAIOutput): RuntimeCaseMemoryType {
  if (aiOutput.faq_topic === 'price') {
    return current === 'booking' || current === 'mixed' ? 'mixed' : 'faq_price';
  }
  if (isBookingOrAvailabilityTurn(aiOutput)) {
    return resolveTypeWithBooking(current);
  }
  return current;
}

function resolveTypeWithBooking(current: RuntimeCaseMemoryType): RuntimeCaseMemoryType {
  return current === 'faq_price' || current === 'mixed' ? 'mixed' : 'booking';
}

function resolveCaseStatus(current: RuntimeCaseMemoryStatus, aiOutput: RuntimeAIOutput): RuntimeCaseMemoryStatus {
  if (aiOutput.faq_topic === 'price' && aiOutput.requested_action === 'answer_faq') {
    return 'answered';
  }
  if (isBookingOrAvailabilityTurn(aiOutput)) {
    return current === 'awaiting_slot_choice' || current === 'awaiting_confirmation' ? current : 'collecting';
  }
  return current;
}

function cloneCaseMemory(value: RuntimeCaseMemory): RuntimeCaseMemory {
  return JSON.parse(JSON.stringify(value)) as RuntimeCaseMemory;
}

function readSlotValue(value: unknown): RuntimeCaseMemorySlotValue | undefined {
  const record = readRecord(value);
  const slotValue = readNonEmpty(record.value);
  const source = readSlotSource(record.source);
  const updatedAt = readNonEmpty(record.updated_at);
  const traceId = readNonEmpty(record.trace_id);
  if (slotValue === null || source === null || updatedAt === null || traceId === null) {
    return undefined;
  }
  return { value: slotValue, source, updated_at: updatedAt, trace_id: traceId };
}

function readQuestion(value: unknown): RuntimeCaseMemoryQuestion | undefined {
  const record = readRecord(value);
  const slot = record.slot === 'service_interest' || record.slot === 'preferred_datetime' ? record.slot : null;
  const topic = record.topic === 'price' || record.topic === 'booking' ? record.topic : null;
  const askedAt = readNonEmpty(record.asked_at);
  const traceId = readNonEmpty(record.trace_id);
  if (record.purpose !== 'collect_missing_slot' || slot === null || topic === null || askedAt === null || traceId === null) {
    return undefined;
  }
  return { purpose: 'collect_missing_slot', slot, topic, asked_at: askedAt, trace_id: traceId };
}

function readCaseType(value: unknown): RuntimeCaseMemoryType {
  return value === 'booking' || value === 'faq_price' || value === 'mixed' || value === 'unknown' ? value : 'unknown';
}

function readCaseStatus(value: unknown): RuntimeCaseMemoryStatus {
  return value === 'collecting' || value === 'awaiting_slot_choice' || value === 'awaiting_confirmation' || value === 'answered' || value === 'closed' ? value : 'collecting';
}

function readSlotSource(value: unknown): RuntimeCaseMemorySlotSource | null {
  return value === 'ai' || value === 'case_memory' || value === 'faq_price_followup' || value === 'booking_turn' || value === 'normalizer' ? value : null;
}

function readProposedSlotMemory(value: unknown): RuntimeProposedSlotMemory[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): RuntimeProposedSlotMemory[] => {
    const record = readRecord(item);
    const optionId = readNonEmpty(record.option_id);
    const startAt = readNonEmpty(record.start_at);
    const endAt = readNonEmpty(record.end_at);
    const label = readNonEmpty(record.label);
    if (optionId === null || startAt === null || endAt === null || label === null) {
      return [];
    }
    return [{
      option_id: optionId,
      start_at: startAt,
      end_at: endAt,
      label,
      cell_range: readNonEmpty(record.cell_range),
      sheet_name: readNonEmpty(record.sheet_name),
      service_interest: readNonEmpty(record.service_interest),
      preferred_date_iso: readNonEmpty(record.preferred_date_iso),
      time_of_day: readNonEmpty(record.time_of_day),
      exact_time: readNonEmpty(record.exact_time),
      provider_metadata: readRecord(record.provider_metadata),
    }];
  });
}

function readNullableRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readRecord(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
