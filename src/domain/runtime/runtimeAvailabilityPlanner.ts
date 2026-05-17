import type { BookingApplyRequest, TimeOfDay } from '../booking/bookingApply.js';
import type { RuntimeAIOutput, RuntimeTurnInput } from './runtimeContracts.js';
import type { RuntimeBookingContext, RuntimeCaseContext, RuntimeClinicRecord } from './runtimeTurnService.js';
import { resolveRuntimeReplyLanguage } from './runtimeReplyLanguage.js';
import { runtimeReplyTemplate } from './runtimeReplyTemplates.js';

export type RuntimeAvailabilityBookingAction = 'propose_slot' | 'confirm_slot' | 'cancel_hold';

export interface RuntimeAvailabilityPlannerInput {
  ai_output: RuntimeAIOutput;
  clinic: RuntimeClinicRecord;
  contact_id: string;
  channel: RuntimeTurnInput['channel'];
  meta?: RuntimeTurnInput['meta'];
  trace_id: string;
  current_clinic_date_iso: string;
  current_time_iso?: string;
  case_context: RuntimeCaseContext;
  booking_context: RuntimeBookingContext;
}

export interface RuntimeAvailabilityPlannerOutput {
  should_call_booking: boolean;
  booking_action: RuntimeAvailabilityBookingAction | null;
  booking_request: BookingApplyRequest | null;
  reason: string;
  warnings: string[];
  reply_text?: string;
}

type Weekday = NonNullable<NonNullable<RuntimeAIOutput['availability_query']>['weekday']>;

type AvailabilityQuery = NonNullable<RuntimeAIOutput['availability_query']>;
type AvailabilitySearchType = AvailabilityQuery['search_type'];

const weekdayIndexes: Record<Weekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const relativeDayOffsets: Record<NonNullable<NonNullable<RuntimeAIOutput['availability_query']>['relative_day']>, number> = {
  today: 0,
  tomorrow: 1,
  day_after_tomorrow: 2,
};

export function planRuntimeAvailability(input: RuntimeAvailabilityPlannerInput): RuntimeAvailabilityPlannerOutput {
  const serviceInterest = readServiceInterest(input);
  const language = resolveRuntimeReplyLanguage({ meta: input.meta, clinic: input.clinic });
  const warnings: string[] = [];
  const availabilityQuery = input.ai_output.availability_query;
  const searchType = availabilityQuery?.search_type ?? 'unknown';
  const usingFallback = availabilityQuery === null || searchType === 'unknown';
  const fallback = buildFallbackAvailabilityQuery(input.ai_output);
  const effectiveQuery = usingFallback ? fallback : availabilityQuery;
  if (effectiveQuery === null || effectiveQuery.search_type === 'unknown') {
    return {
      should_call_booking: false,
      booking_action: null,
      booking_request: null,
      reason: 'availability_query_unknown',
      warnings,
      reply_text: runtimeReplyTemplate(language, 'availability_query_unknown'),
    };
  }

  const effectiveSearchType = effectiveQuery.search_type;

  if (usingFallback && fallback !== null) {
    warnings.push('availability_query_fallback_from_booking');
  }

  const preferredDateIso = resolvePreferredDateIso(effectiveQuery, input.current_clinic_date_iso, warnings);
  const timeValidation = validateTimeConstraints(effectiveQuery, effectiveSearchType);

  if (!timeValidation.ok) {
    return askClarification(timeValidation.reason, warnings, language);
  }

  if (serviceInterest === null) {
    return {
      should_call_booking: false,
      booking_action: null,
      booking_request: null,
      reason: 'missing_service_for_availability',
      warnings,
      reply_text: runtimeReplyTemplate(language, 'missing_service_for_availability'),
    };
  }

  const timeOfDay = resolveTimeOfDay(effectiveQuery, input.ai_output.booking.time_of_day);
  const preferredTimeWindow = timeValidation.preferredTimeWindow;
  const exactTime = timeValidation.exactTime;

  if (effectiveSearchType === 'specific_date' && preferredDateIso === null) {
    return askClarification('specific_date_missing_date', warnings, language);
  }

  if (effectiveSearchType === 'weekday' && preferredDateIso === null) {
    return askClarification('availability_query_unknown', warnings, language);
  }

  if (effectiveSearchType === 'relative_day' && preferredDateIso === null) {
    return askClarification('availability_query_unknown', warnings, language);
  }

  if (effectiveSearchType === 'exact_slot' && !isValidDateIso(effectiveQuery.date_iso)) {
    return askClarification('exact_slot_missing_date', warnings, language);
  }

  if (preferredDateIso !== null && isPastDateIso(preferredDateIso, input.current_clinic_date_iso)) {
    return askClarification(
      effectiveSearchType === 'exact_slot' ? 'exact_slot_date_in_past' : 'availability_date_in_past',
      warnings,
      language,
    );
  }

  return {
    should_call_booking: true,
    booking_action: 'propose_slot',
    booking_request: {
      clinicId: input.clinic.id,
      contactId: input.contact_id,
      caseId: input.case_context.current_case_id,
      bookingAction: 'propose_slot',
      serviceInterest,
      preferredDateIso,
      preferredWeekday: effectiveQuery.weekday,
      timeOfDay,
      preferredTimeWindow: preferredTimeWindow ?? undefined,
      exactTime,
      activeHoldId: null,
      patientName: readPatientName(input.meta),
      channel: input.channel,
      traceId: input.trace_id,
      durationMinutes: 30,
      metadata: buildPlannerMetadata(input, effectiveQuery, usingFallback, preferredDateIso),
    },
    reason: buildReason(effectiveSearchType, usingFallback),
    warnings,
  };
}

function buildFallbackAvailabilityQuery(aiOutput: RuntimeAIOutput): AvailabilityQuery | null {
  const preferredDateIso = readNonEmpty(aiOutput.booking.preferred_date_iso) ?? null;
  const preferredWeekday = readWeekday(aiOutput.booking.preferred_weekday);
  const timeOfDay = aiOutput.booking.time_of_day;

  if (preferredDateIso !== null) {
    return {
      search_type: 'specific_date',
      date_iso: preferredDateIso,
      weekday: null,
      relative_day: null,
      time_window: timeOfDay === null ? null : { type: timeOfDay, start_time: null, end_time: null },
      exact_time: null,
      flexibility: 'unknown',
    };
  }

  if (preferredWeekday !== null) {
    return {
      search_type: 'weekday',
      date_iso: null,
      weekday: preferredWeekday,
      relative_day: null,
      time_window: timeOfDay === null ? null : { type: timeOfDay, start_time: null, end_time: null },
      exact_time: null,
      flexibility: 'unknown',
    };
  }

  if (timeOfDay !== null) {
    return {
      search_type: 'time_constraint',
      date_iso: null,
      weekday: null,
      relative_day: null,
      time_window: { type: timeOfDay, start_time: null, end_time: null },
      exact_time: null,
      flexibility: 'unknown',
    };
  }

  return null;
}

function resolvePreferredDateIso(
  query: AvailabilityQuery,
  currentDateIso: string,
  warnings: string[],
): string | null {
  if (query.date_iso !== null) {
    if (isValidDateIso(query.date_iso)) {
      return query.date_iso;
    }

    warnings.push(`invalid_availability_date_iso:${query.date_iso}`);
    return null;
  }

  if (query.relative_day !== null) {
    return addDays(currentDateIso, relativeDayOffsets[query.relative_day]);
  }

  if (query.weekday !== null) {
    return resolveNearestWeekday(currentDateIso, query.weekday);
  }

  return null;
}

function resolveNearestWeekday(currentDateIso: string, weekday: Weekday): string | null {
  const current = parseDateIsoParts(currentDateIso);

  if (current === null) {
    return null;
  }

  const currentDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const currentWeekday = currentDate.getUTCDay();
  const targetWeekday = weekdayIndexes[weekday];
  const offset = (targetWeekday - currentWeekday + 7) % 7;

  return addDays(currentDateIso, offset);
}

type TimeValidationResult =
  | { ok: true; exactTime: string | null; preferredTimeWindow: { startTime: string | null; endTime: string | null } | null }
  | { ok: false; reason: 'exact_slot_missing_time' | 'exact_slot_invalid_time' | 'time_window_missing_or_invalid' | 'time_window_invalid_range' };

function validateTimeConstraints(query: AvailabilityQuery, searchType: AvailabilitySearchType): TimeValidationResult {
  const exactTime = query.exact_time;

  if (exactTime !== null && parseTimeToMinutes(exactTime) === null) {
    return { ok: false, reason: searchType === 'exact_slot' ? 'exact_slot_invalid_time' : 'time_window_missing_or_invalid' };
  }

  if (searchType === 'exact_slot' && exactTime === null) {
    return { ok: false, reason: 'exact_slot_missing_time' };
  }

  const window = query.time_window;

  if (window === null) {
    return { ok: true, exactTime, preferredTimeWindow: null };
  }

  if (window.type === 'before') {
    return validateBeforeWindow(window.end_time, exactTime);
  }

  if (window.type === 'after') {
    return validateAfterWindow(window.start_time, exactTime);
  }

  if (window.type === 'between') {
    return validateBetweenWindow(window.start_time, window.end_time, exactTime);
  }

  return { ok: true, exactTime, preferredTimeWindow: null };
}

function validateBeforeWindow(endTime: string | null, exactTime: string | null): TimeValidationResult {
  if (parseTimeToMinutes(endTime) === null) {
    return { ok: false, reason: 'time_window_missing_or_invalid' };
  }

  return { ok: true, exactTime, preferredTimeWindow: { startTime: null, endTime } };
}

function validateAfterWindow(startTime: string | null, exactTime: string | null): TimeValidationResult {
  if (parseTimeToMinutes(startTime) === null) {
    return { ok: false, reason: 'time_window_missing_or_invalid' };
  }

  return { ok: true, exactTime, preferredTimeWindow: { startTime, endTime: null } };
}

function validateBetweenWindow(startTime: string | null, endTime: string | null, exactTime: string | null): TimeValidationResult {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return { ok: false, reason: 'time_window_missing_or_invalid' };
  }

  if (startMinutes > endMinutes) {
    return { ok: false, reason: 'time_window_invalid_range' };
  }

  return { ok: true, exactTime, preferredTimeWindow: { startTime, endTime } };
}

function resolveTimeOfDay(
  query: AvailabilityQuery,
  fallbackTimeOfDay: RuntimeAIOutput['booking']['time_of_day'],
): TimeOfDay {
  if (query.time_window !== null) {
    if (query.time_window.type === 'morning' || query.time_window.type === 'afternoon' || query.time_window.type === 'evening') {
      return query.time_window.type;
    }

    if (query.time_window.type === 'before') {
      return timeOfDayFromBoundary(query.time_window.end_time, 'morning');
    }

    if (query.time_window.type === 'after') {
      return timeOfDayFromBoundary(query.time_window.start_time, 'afternoon');
    }

    if (query.time_window.type === 'between') {
      return timeOfDayFromBoundary(query.time_window.start_time, fallbackTimeOfDay ?? 'any');
    }

    return 'any';
  }

  if (query.exact_time !== null) {
    return timeOfDayFromBoundary(query.exact_time, fallbackTimeOfDay ?? 'any');
  }

  return fallbackTimeOfDay ?? 'any';
}

function timeOfDayFromBoundary(value: string | null, fallback: TimeOfDay): TimeOfDay {
  const hour = parseHourMinute(value);

  if (hour === null) {
    return fallback;
  }

  if (hour < 12) {
    return 'morning';
  }

  if (hour < 17) {
    return 'afternoon';
  }

  return 'evening';
}

function buildPlannerMetadata(
  input: RuntimeAvailabilityPlannerInput,
  query: AvailabilityQuery,
  usedFallback: boolean,
  resolvedDateIso: string | null,
): Record<string, unknown> {
  return {
    source: 'runtime_availability_planner',
    policy_action: 'propose_slot',
    clinic_timezone: input.clinic.timezone,
    current_time_iso: input.current_time_iso ?? null,
    current_clinic_date_iso: input.current_clinic_date_iso,
    availability_query: query,
    resolved_date_iso: resolvedDateIso,
    used_legacy_booking_fallback: usedFallback,
    time_window: query.time_window,
    exact_time: query.exact_time,
    search_window_days: query.search_type === 'nearest_available' || query.search_type === 'time_constraint' ? 14 : null,
  };
}

function buildReason(searchType: AvailabilitySearchType, usedFallback: boolean): string {
  if (usedFallback) {
    return `availability_${searchType}_from_legacy_booking`;
  }

  return `availability_${searchType}`;
}

function askClarification(reason: string, warnings: string[], language: ReturnType<typeof resolveRuntimeReplyLanguage>): RuntimeAvailabilityPlannerOutput {
  return {
    should_call_booking: false,
    booking_action: null,
    booking_request: null,
    reason,
    warnings,
    reply_text: replyTextForPlannerReason(reason, language),
  };
}


function replyTextForPlannerReason(reason: string, language: ReturnType<typeof resolveRuntimeReplyLanguage>): string {
  if (reason === 'specific_date_missing_date'
    || reason === 'exact_slot_missing_date'
    || reason === 'exact_slot_missing_time'
    || reason === 'exact_slot_invalid_time'
    || reason === 'time_window_missing_or_invalid'
    || reason === 'time_window_invalid_range'
    || reason === 'availability_date_in_past'
    || reason === 'exact_slot_date_in_past'
    || reason === 'availability_query_unknown') {
    return runtimeReplyTemplate(language, reason);
  }

  return runtimeReplyTemplate(language, 'availability_query_unknown');
}

function isPastDateIso(value: string, currentDateIso: string): boolean {
  return isValidDateIso(value) && isValidDateIso(currentDateIso) && value < currentDateIso;
}

function readServiceInterest(input: RuntimeAvailabilityPlannerInput): string | null {
  return readNonEmpty(input.ai_output.slot_updates.service_interest)
    ?? readNonEmpty(input.case_context.current_case?.collected.service_interest)
    ?? readNonEmpty(input.booking_context.active_hold?.service_interest)
    ?? readNonEmpty(input.booking_context.active_hold?.service)
    ?? null;
}

function readPatientName(meta: RuntimeTurnInput['meta'] | undefined): string | null {
  const parts = [readNonEmpty(meta?.first_name), readNonEmpty(meta?.last_name)].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? null : parts.join(' ');
}

function readWeekday(value: unknown): Weekday | null {
  const trimmed = readNonEmpty(value)?.toLowerCase();

  if (trimmed === undefined) {
    return null;
  }

  return isWeekday(trimmed) ? trimmed : null;
}

function isWeekday(value: string): value is Weekday {
  return Object.prototype.hasOwnProperty.call(weekdayIndexes, value);
}

function addDays(dateIso: string, days: number): string | null {
  const parts = parseDateIsoParts(dateIso);

  if (parts === null) {
    return null;
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return formatDateIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseHourMinute(value: string | null): number | null {
  const minutes = parseTimeToMinutes(value);

  return minutes === null ? null : Math.floor(minutes / 60);
}

function parseTimeToMinutes(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);

  if (match === null) {
    return null;
  }

  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '', 10);

  return hour * 60 + minute;
}

function parseDateIsoParts(value: string | null): { year: number; month: number; day: number } | null {
  if (value === null) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

  if (match === null) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

function isValidDateIso(value: string | null): boolean {
  return parseDateIsoParts(value) !== null;
}

function formatDateIso(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function readNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
