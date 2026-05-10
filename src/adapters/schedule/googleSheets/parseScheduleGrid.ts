export type ScheduleGrid = ReadonlyArray<ReadonlyArray<unknown>>;

export interface GoogleSheetsScheduleConfig {
  timeColumn: string;
  dateHeaderRow: number;
  firstTimeRow: number;
  timezone: string;
  slotMinutes: number;
  enabledScheduleDays: readonly string[];
  defaultDoctorId: string;
  adminConfirmationRequired: boolean;
  spreadsheetId: string;
  readRange: string;
  writeMode: 'cell' | 'append';
  serviceAccountJsonEnvVar?: string;
  sheetName?: string;
}

export interface ParsedScheduleCell {
  date: string;
  time: string;
  startAt: string;
  endAt: string;
  timezone: string;
  value: string;
  isAvailable: boolean;
  rowNumber: number;
  columnName: string;
  cellRange: string;
  sheetName?: string;
}

export function parseScheduleGrid(
  grid: ScheduleGrid,
  config: GoogleSheetsScheduleConfig,
): ParsedScheduleCell[] {
  const timeColumnIndex = columnNameToIndex(config.timeColumn);
  const dateHeaderRowIndex = toZeroBasedRow(config.dateHeaderRow, 'dateHeaderRow');
  const firstTimeRowIndex = toZeroBasedRow(config.firstTimeRow, 'firstTimeRow');
  const headerRow = grid[dateHeaderRowIndex] ?? [];
  const dateColumns = headerRow
    .map((value, columnIndex) => ({ date: parseDateHeader(value), columnIndex }))
    .filter((entry): entry is { date: string; columnIndex: number } =>
      entry.columnIndex !== timeColumnIndex && entry.date !== undefined,
    );

  const cells: ParsedScheduleCell[] = [];

  for (let rowIndex = firstTimeRowIndex; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const time = parseTimeCell(row[timeColumnIndex]);

    if (time === undefined) {
      continue;
    }

    for (const { date, columnIndex } of dateColumns) {
      const value = normalizeCellValue(row[columnIndex]);
      const startAt = zonedDateTimeToUtcIso(date, time, config.timezone);
      const endAt = addMinutesIso(startAt, config.slotMinutes);
      const rowNumber = rowIndex + 1;
      const columnName = indexToColumnName(columnIndex);

      cells.push({
        date,
        time,
        startAt,
        endAt,
        timezone: config.timezone,
        value,
        isAvailable: value.length === 0,
        rowNumber,
        columnName,
        cellRange: `${columnName}${rowNumber}`,
        sheetName: config.sheetName,
      });
    }
  }

  return cells;
}

export function columnNameToIndex(columnName: string): number {
  const normalized = columnName.trim().toUpperCase();

  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error(`Invalid column name: ${columnName}`);
  }

  return [...normalized].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

export function indexToColumnName(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid column index: ${index}`);
  }

  let current = index + 1;
  let columnName = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    columnName = String.fromCharCode(65 + remainder) + columnName;
    current = Math.floor((current - 1) / 26);
  }

  return columnName;
}

function toZeroBasedRow(rowNumber: number, fieldName: string): number {
  if (!Number.isInteger(rowNumber) || rowNumber < 1) {
    throw new Error(`${fieldName} must be a 1-based row number`);
  }

  return rowNumber - 1;
}

function parseDateHeader(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const raw = String(value).trim();

  if (raw.length === 0) {
    return undefined;
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (isoMatch) {
    return formatDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const europeanDotMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  if (europeanDotMatch) {
    return formatDateParts(Number(europeanDotMatch[3]), Number(europeanDotMatch[2]), Number(europeanDotMatch[1]));
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(raw);
  if (slashMatch) {
    const now = new Date();
    const yearPart = slashMatch[3];
    const year = yearPart === undefined
      ? now.getUTCFullYear()
      : Number(yearPart.length === 2 ? `20${yearPart}` : yearPart);

    return formatDateParts(year, Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return undefined;
}

function parseTimeCell(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const raw = String(value).trim();

  if (raw.length === 0) {
    return undefined;
  }

  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap]m)?$/i.exec(raw);
  if (!match) {
    return undefined;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3]?.toLowerCase();

  if (minute > 59 || hour > 23 || (meridiem !== undefined && (hour < 1 || hour > 12))) {
    return undefined;
  }

  if (meridiem === 'pm' && hour < 12) {
    hour += 12;
  }

  if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  return `${pad(hour)}:${pad(minute)}`;
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function zonedDateTimeToUtcIso(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), timezone);
  const firstPass = utcGuess - offsetMs;
  const correctedOffsetMs = getTimeZoneOffsetMs(new Date(firstPass), timezone);

  return new Date(utcGuess - correctedOffsetMs).toISOString();
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return zonedAsUtc - date.getTime();
}

function addMinutesIso(isoDate: string, minutes: number): string {
  return new Date(new Date(isoDate).getTime() + minutes * 60_000).toISOString();
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
