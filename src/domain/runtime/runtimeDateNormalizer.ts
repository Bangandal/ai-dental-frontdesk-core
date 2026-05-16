import type { RuntimeAIOutput } from './runtimeContracts.js';

export type RuntimeDateNormalizationSource = 'ai' | 'user_text_explicit_date' | 'none';

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

  let source: RuntimeDateNormalizationSource = 'none';

  if (isValidDateIso(normalized.booking.preferred_date_iso)) {
    source = 'ai';
  } else {
    if (normalized.booking.preferred_date_iso !== null) {
      warnings.push(`preferred_date_iso_invalid:${normalized.booking.preferred_date_iso}`);
    }

    normalized.booking.preferred_date_iso = extractExplicitDate(input.user_text, input.current_date_iso);

    if (normalized.booking.preferred_date_iso !== null) {
      source = 'user_text_explicit_date';
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
  return extractIsoDate(userText)
    ?? extractExplicitDayMonthYear(userText)
    ?? extractExplicitDayMonth(userText, currentDateIso);
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
  const current = parseDateIsoParts(currentDateIso);

  if (current === null) {
    return null;
  }

  for (const match of userText.matchAll(pattern)) {
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
