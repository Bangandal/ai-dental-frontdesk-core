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
  const requestedDurationMinutes = normalizeDurationMinutes(request.durationMinutes, config.slotMinutes);
  const requiredConsecutiveCells = Math.ceil(requestedDurationMinutes / config.slotMinutes);
  const parsedCells = parseScheduleGrid(grid, config);
  const allInRangeCells = parsedCells
    .filter((cell) => {
      const startAt = new Date(cell.startAt).getTime();
      return (from === undefined || startAt >= from) && (to === undefined || startAt < to);
    });
  const enabledCells = allInRangeCells.filter((cell) => isCellOnEnabledDay(cell, enabledScheduleDays));
  const warnings = buildWarnings(allInRangeCells, enabledCells, enabledScheduleDays, request);
  const cellsByColumnAndRow = indexCellsByColumnAndRow(parsedCells);

  return {
    slots: enabledCells
      .filter((cell) => hasConsecutiveAvailability(cell, cellsByColumnAndRow, requiredConsecutiveCells, config.slotMinutes))
      .sort(compareScheduleCellsChronologically)
      .map((cell) => ({
        startAt: cell.startAt,
        endAt: addMinutesIso(cell.startAt, requestedDurationMinutes),
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

function normalizeDurationMinutes(durationMinutes: number | undefined, fallbackMinutes: number): number {
  if (durationMinutes === undefined) {
    return fallbackMinutes;
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return fallbackMinutes;
  }

  return durationMinutes;
}

function indexCellsByColumnAndRow(cells: ParsedScheduleCell[]): Map<string, ParsedScheduleCell> {
  return new Map(cells.map((cell) => [cellKey(cell.date, cell.columnName, cell.rowNumber), cell]));
}

function hasConsecutiveAvailability(
  cell: ParsedScheduleCell,
  cellsByColumnAndRow: ReadonlyMap<string, ParsedScheduleCell>,
  requiredConsecutiveCells: number,
  slotMinutes: number,
): boolean {
  if (!cell.isAvailable) {
    return false;
  }

  for (let offset = 1; offset < requiredConsecutiveCells; offset += 1) {
    const nextCell = cellsByColumnAndRow.get(cellKey(cell.date, cell.columnName, cell.rowNumber + offset));

    if (nextCell === undefined || !nextCell.isAvailable || !isExpectedConsecutiveTime(cell, nextCell, offset, slotMinutes)) {
      return false;
    }
  }

  return true;
}

function isExpectedConsecutiveTime(
  startCell: ParsedScheduleCell,
  nextCell: ParsedScheduleCell,
  offset: number,
  slotMinutes: number,
): boolean {
  return new Date(nextCell.startAt).getTime() === new Date(startCell.startAt).getTime() + offset * slotMinutes * 60_000;
}

function cellKey(date: string, columnName: string, rowNumber: number): string {
  return `${date}:${columnName}:${rowNumber}`;
}

function addMinutesIso(isoDate: string, minutes: number): string {
  return new Date(new Date(isoDate).getTime() + minutes * 60_000).toISOString();
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

function compareScheduleCellsChronologically(left: ParsedScheduleCell, right: ParsedScheduleCell): number {
  return new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
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
