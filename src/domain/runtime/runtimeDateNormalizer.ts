import type { RuntimeAIOutput } from './runtimeContracts.js';

export type RuntimeDateNormalizationSource = 'ai' | 'user_text_explicit_date' | 'user_text_day_of_month' | 'user_text_relative_day' | 'none';

export interface RuntimeDateNormalizationDebug {
  before: {
    preferred_date_iso: string | null;
    preferred_weekday: string | null;
    time_of_day: RuntimeAIOutput['booking']['time_of_day'];
    preferred_time: string | null;
  };
  after: {
    preferred_date_iso: string | null;
    preferred_weekday: string | null;
    time_of_day: RuntimeAIOutput['booking']['time_of_day'];
  };
  source: RuntimeDateNormalizationSource;
  warnings: string[];
}

export interface NormalizeRuntimeAIOutputDatesInput {
  ai_output: RuntimeAIOutput;
  user_text: string;
  clinic_timezone: string;
  current_date_iso: string;
}

export interface NormalizeRuntimeAIOutputDatesResult {
  ai_output: RuntimeAIOutput;
  debug: RuntimeDateNormalizationDebug;
}

const VALID_WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

export function normalizeRuntimeAIOutputDates(input: NormalizeRuntimeAIOutputDatesInput): NormalizeRuntimeAIOutputDatesResult {
  const original = input.ai_output;
  const before = {
    preferred_date_iso: original.booking.preferred_date_iso,
    preferred_weekday: original.booking.preferred_weekday,
    time_of_day: original.booking.time_of_day,
    preferred_time: original.slot_updates.preferred_time,
  };
  const warnings: string[] = [];
  const normalized: RuntimeAIOutput = {
    ...original,
    slot_updates: { ...original.slot_updates },
    booking: { ...original.booking },
  };

  const preferredWeekday = readNonEmpty(normalized.booking.preferred_weekday);

  if (preferredWeekday !== undefined && !VALID_WEEKDAYS.has(preferredWeekday.toLowerCase())) {
    normalized.booking.preferred_weekday = null;
    warnings.push(`preferred_weekday_cleared:${preferredWeekday}`);
  } else if (preferredWeekday !== undefined) {
    normalized.booking.preferred_weekday = preferredWeekday.toLowerCase();
  }

  normalized.booking.time_of_day = normalizeTimeOfDay(
    normalized.booking.time_of_day,
    normalized.slot_updates.preferred_time,
    input.user_text,
  );

  let source: RuntimeDateNormalizationSource = 'none';

  if (isValidDateIso(normalized.booking.preferred_date_iso)) {
    source = 'ai';
  } else {
    if (normalized.booking.preferred_date_iso !== null) {
      warnings.push(`preferred_date_iso_invalid:${normalized.booking.preferred_date_iso}`);
    }

    normalized.booking.preferred_date_iso = null;
    const explicitDate = extractExplicitDate(input.user_text, input.current_date_iso);

    if (explicitDate !== null) {
      normalized.booking.preferred_date_iso = explicitDate;
      source = 'user_text_explicit_date';
    } else {
      const relativeDate = extractRelativeDate(input.user_text, input.current_date_iso);

      if (relativeDate !== null) {
        normalized.booking.preferred_date_iso = relativeDate;
        source = 'user_text_relative_day';
      } else {
        const dayOfMonth = extractDayOfMonth(input.user_text);

        if (dayOfMonth !== null) {
          const resolvedDate = resolveDayOfMonth(input.current_date_iso, dayOfMonth);

          if (resolvedDate !== null) {
            normalized.booking.preferred_date_iso = resolvedDate;
            source = 'user_text_day_of_month';
          } else {
            warnings.push(`day_of_month_out_of_range:${dayOfMonth}`);
          }
        }
      }
    }
  }

  const debug: RuntimeDateNormalizationDebug = {
    before,
    after: {
      preferred_date_iso: normalized.booking.preferred_date_iso,
      preferred_weekday: normalized.booking.preferred_weekday,
      time_of_day: normalized.booking.time_of_day,
    },
    source,
    warnings,
  };

  return { ai_output: normalized, debug };
}

export function getClinicLocalDateIso(timeZone: string, now: Date = new Date()): string {
  const parts = getClinicLocalDateTimeParts(timeZone, now);

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getClinicLocalDateTimeIso(timeZone: string, now: Date = new Date()): string {
  const parts = getClinicLocalDateTimeParts(timeZone, now);

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function getClinicLocalDateTimeParts(timeZone: string, now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);

  return {
    year: readPart(parts, 'year'),
    month: readPart(parts, 'month'),
    day: readPart(parts, 'day'),
    hour: readPart(parts, 'hour') === '24' ? '00' : readPart(parts, 'hour'),
    minute: readPart(parts, 'minute'),
    second: readPart(parts, 'second'),
  };
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '00';
}

function extractExplicitDate(userText: string, currentDateIso: string): string | null {
  const isoDate = extractIsoDate(userText);

  if (isoDate !== null) {
    return isoDate;
  }

  const explicitDayMonthYear = extractExplicitDayMonthYear(userText);

  if (explicitDayMonthYear !== null) {
    return explicitDayMonthYear;
  }

  return extractExplicitDayMonth(userText, currentDateIso);
}

function extractIsoDate(userText: string): string | null {
  const pattern = /(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/u;
  const match = pattern.exec(userText);

  if (match === null) {
    return null;
  }

  const candidate = `${match[1] ?? ''}-${match[2] ?? ''}-${match[3] ?? ''}`;

  return isValidDateIso(candidate) ? candidate : null;
}

function extractExplicitDayMonthYear(userText: string): string | null {
  const pattern = /(?:^|[^\d])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/u;
  const match = pattern.exec(userText);

  if (match === null) {
    return null;
  }

  const day = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const year = Number.parseInt(match[3] ?? '', 10);
  const candidate = formatDateIso(year, month, day);

  return isValidDateIso(candidate) ? candidate : null;
}

function extractExplicitDayMonth(userText: string, currentDateIso: string): string | null {
  const pattern = /(?:^|[^\d])(\d{1,2})\.(\d{1,2})(?![.\d])/gu;
  const matches = userText.matchAll(pattern);
  const current = parseDateIsoParts(currentDateIso);

  if (current === null) {
    return null;
  }

  for (const match of matches) {
    const day = Number.parseInt(match[1] ?? '', 10);
    const month = Number.parseInt(match[2] ?? '', 10);
    const resolved = resolveDayMonth(current, day, month);

    if (resolved !== null) {
      return resolved;
    }
  }

  return null;
}

function resolveDayMonth(current: { year: number; month: number; day: number }, day: number, month: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) {
    return null;
  }

  let year = current.year;

  if (day > daysInMonth(year, month)) {
    return null;
  }

  let candidate = formatDateIso(year, month, day);

  if (candidate < formatDateIso(current.year, current.month, current.day)) {
    year += 1;

    if (day > daysInMonth(year, month)) {
      return null;
    }

    candidate = formatDateIso(year, month, day);
  }

  return candidate;
}

function extractRelativeDate(userText: string, currentDateIso: string): string | null {
  const lowerText = userText.toLowerCase();

  if (lowerText.includes('послезавтра') || lowerText.includes('післязавтра')) {
    return addDays(currentDateIso, 2);
  }

  if (lowerText.includes('завтра')) {
    return addDays(currentDateIso, 1);
  }

  return null;
}

function extractDayOfMonth(userText: string): number | null {
  const lowerText = userText.toLowerCase();
  const patterns = [
    /(?:^|\s)на\s+(\d{1,2})\s*(?:число|числа)(?=\s|$|[?!.,;:])/u,
    /(?:^|\s)(\d{1,2})\s*(?:число|числа)(?=\s|$|[?!.,;:])/u,
    /(?:^|\s)(\d{1,2})-?го\b/u,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(lowerText);

    if (match?.[1] !== undefined) {
      const day = Number.parseInt(match[1], 10);

      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        return day;
      }
    }
  }

  return null;
}

function resolveDayOfMonth(currentDateIso: string, dayOfMonth: number): string | null {
  const current = parseDateIsoParts(currentDateIso);

  if (current === null) {
    return null;
  }

  let year = current.year;
  let month = current.month;

  if (dayOfMonth < current.day) {
    month += 1;

    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  if (dayOfMonth > daysInMonth(year, month)) {
    return null;
  }

  return formatDateIso(year, month, dayOfMonth);
}

function addDays(dateIso: string, days: number): string | null {
  const parts = parseDateIsoParts(dateIso);

  if (parts === null) {
    return null;
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return formatDateIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
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

function normalizeTimeOfDay(
  existing: RuntimeAIOutput['booking']['time_of_day'],
  preferredTime: string | null,
  userText: string,
): RuntimeAIOutput['booking']['time_of_day'] {
  if (existing !== null) {
    return existing;
  }

  const text = `${preferredTime ?? ''} ${userText}`.toLowerCase();

  if (text.includes('утром') || text.includes('ранком')) {
    return 'morning';
  }

  if (text.includes('днем') || text.includes('днём') || text.includes('вдень')) {
    return 'afternoon';
  }

  if (text.includes('вечером') || text.includes('увечері')) {
    return 'evening';
  }

  return existing;
}

function readNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
