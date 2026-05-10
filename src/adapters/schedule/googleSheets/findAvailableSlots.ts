import type { CheckAvailabilityRequest, ScheduleSlot } from '../ScheduleAdapter.js';
import { parseScheduleGrid, type GoogleSheetsScheduleConfig, type ScheduleGrid } from './parseScheduleGrid.js';

export function findAvailableSlots(
  grid: ScheduleGrid,
  config: GoogleSheetsScheduleConfig,
  request: CheckAvailabilityRequest = {},
): ScheduleSlot[] {
  const from = request.from === undefined ? undefined : new Date(request.from).getTime();
  const to = request.to === undefined ? undefined : new Date(request.to).getTime();

  return parseScheduleGrid(grid, config)
    .filter((cell) => cell.isAvailable)
    .filter((cell) => {
      const startAt = new Date(cell.startAt).getTime();
      return (from === undefined || startAt >= from) && (to === undefined || startAt < to);
    })
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
      },
    }));
}
