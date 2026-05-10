import type { CheckAvailabilityRequest, ScheduleSlot } from '../ScheduleAdapter.js';
import { parseScheduleGrid, type GoogleSheetsScheduleConfig, type ParsedScheduleCell, type ScheduleGrid } from './parseScheduleGrid.js';

export interface AvailableSlotSearchResult {
  slots: ScheduleSlot[];
  warnings: AvailabilityWarning[];
}

export interface AvailabilityWarning {
  code: 'requested_day_not_enabled';
  message: string;
  details?: Record<string, unknown>;
}

export function findAvailableSlots(
  grid: ScheduleGrid,
  config: GoogleSheetsScheduleConfig,
  request: CheckAvailabilityRequest = {},
): ScheduleSlot[] {
  return findAvailableSlotsWithWarnings(grid, config, request).slots;
}

export function findAvailableSlotsWithWarnings(
  grid: ScheduleGrid,
  config: GoogleSheetsScheduleConfig,
  request: CheckAvailabilityRequest = {},
): AvailableSlotSearchResult {
  const from = request.from === undefined ? undefined : new Date(request.from).getTime();
  const to = request.to === undefined ? undefined : new Date(request.to).getTime();
  const enabledScheduleDays = normalizeEnabledScheduleDays(config.enabledScheduleDays);
  const allInRangeCells = parseScheduleGrid(grid, config)
    .filter((cell) => {
      const startAt = new Date(cell.startAt).getTime();
      return (from === undefined || startAt >= from) && (to === undefined || startAt < to);
    });
  const enabledCells = allInRangeCells.filter((cell) => isCellOnEnabledDay(cell, enabledScheduleDays));
  const warnings = buildWarnings(allInRangeCells, enabledCells, enabledScheduleDays, request);

  return {
    slots: enabledCells
      .filter((cell) => cell.isAvailable)
      .map((cell) => ({
        startAt: cell.startAt,
        endAt: cell.endAt,
        timezone: cell.timezone,
        provider: 'google_sheets',
        metadata: {
          cell_range: cell.cellRange,
          sheet_name: cell.sheetName,
          row_number: cell.rowNumber,
          column_name: cell.columnName,
          doctor_id: config.defaultDoctorId,
          admin_confirmation_required: config.adminConfirmationRequired,
        },
      })),
    warnings,
  };
}

function buildWarnings(
  allInRangeCells: ParsedScheduleCell[],
  enabledCells: ParsedScheduleCell[],
  enabledScheduleDays: ReadonlySet<number>,
  request: CheckAvailabilityRequest,
): AvailabilityWarning[] {
  if (request.from === undefined || request.to === undefined || allInRangeCells.length === 0 || enabledCells.length > 0) {
    return [];
  }

  const requestedDisabledDays = new Set(
    allInRangeCells
      .map((cell) => getUtcWeekdayIndex(cell.date))
      .filter((weekdayIndex) => !enabledScheduleDays.has(weekdayIndex))
      .map(weekdayIndexToName),
  );

  if (requestedDisabledDays.size === 0) {
    return [];
  }

  return [{
    code: 'requested_day_not_enabled',
    message: 'The requested availability range only includes weekdays that are not enabled for this schedule integration.',
    details: {
      requested_disabled_days: [...requestedDisabledDays],
      enabled_schedule_days: [...enabledScheduleDays].map(weekdayIndexToName),
    },
  }];
}

function isCellOnEnabledDay(cell: ParsedScheduleCell, enabledScheduleDays: ReadonlySet<number>): boolean {
  return enabledScheduleDays.has(getUtcWeekdayIndex(cell.date));
}

function normalizeEnabledScheduleDays(enabledScheduleDays: readonly string[]): ReadonlySet<number> {
  return new Set(enabledScheduleDays.map(parseWeekdayName));
}

function parseWeekdayName(value: string): number {
  const normalized = value.trim().toLowerCase();
  const weekdayIndex = weekdayNameToIndex[normalized];

  if (weekdayIndex === undefined) {
    throw new Error(`Invalid enabled schedule day: ${value}`);
  }

  return weekdayIndex;
}

function getUtcWeekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function weekdayIndexToName(index: number): string {
  return weekdayNames[index] ?? 'unknown';
}

const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const weekdayNameToIndex = Object.fromEntries(weekdayNames.map((name, index) => [name, index]));
