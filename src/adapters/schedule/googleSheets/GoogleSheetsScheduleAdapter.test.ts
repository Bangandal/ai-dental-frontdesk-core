import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsScheduleAdapter, type GoogleSheetsValuesClient } from './GoogleSheetsScheduleAdapter.js';
import { columnNameToIndex, parseScheduleGrid, type GoogleSheetsScheduleConfig, type ScheduleGrid } from './parseScheduleGrid.js';

const config: GoogleSheetsScheduleConfig = {
  timeColumn: 'B',
  dateHeaderRow: 1,
  firstTimeRow: 2,
  timezone: 'America/New_York',
  slotMinutes: 15,
  sheetName: 'Schedule',
  enabledScheduleDays: ['monday', 'saturday'],
  defaultDoctorId: 'dr_primary',
  adminConfirmationRequired: true,
  spreadsheetId: 'spreadsheet_123',
  readRange: 'A1:AP14',
  writeMode: 'cell',
};

function buildMockGrid(): ScheduleGrid {
  const grid: string[][] = Array.from({ length: 14 }, () => Array.from({ length: 42 }, () => ''));
  const timeColumn = columnNameToIndex('B');
  const dateColumns = ['AM', 'AN', 'AO'].map(columnNameToIndex);

  grid[0][dateColumns[0]] = '2026-05-11'; // Monday
  grid[0][dateColumns[1]] = '2026-05-12'; // Tuesday
  grid[0][dateColumns[2]] = '2026-05-16'; // Saturday

  for (let row = 1; row < grid.length; row += 1) {
    const minutesAfterEleven = (row - 1) * 15;
    const hour = 11 + Math.floor(minutesAfterEleven / 60);
    const minute = minutesAfterEleven % 60;
    grid[row][timeColumn] = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  grid[1][dateColumns[0]] = 'occupied';
  grid[3][dateColumns[0]] = 'occupied';
  grid[5][dateColumns[0]] = 'occupied';

  return grid;
}

describe('GoogleSheetsScheduleAdapter', () => {
  it('returns Monday slots when Monday is enabled in config', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({ config, grid: buildMockGrid() });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-11T00:00:00.000Z',
      to: '2026-05-12T00:00:00.000Z',
    });

    expect(response.warnings).toEqual([]);
    expect(response.slots).toHaveLength(10);
    expect(response.slots.map((slot) => slot.metadata.cell_range)).toEqual([
      'AM3',
      'AM5',
      'AM7',
      'AM8',
      'AM9',
      'AM10',
      'AM11',
      'AM12',
      'AM13',
      'AM14',
    ]);
    expect(response.slots[0]).toMatchObject({
      startAt: '2026-05-11T15:15:00.000Z',
      endAt: '2026-05-11T15:30:00.000Z',
      timezone: 'America/New_York',
      provider: 'google_sheets',
    });
  });

  it('returns Saturday slots when Saturday is enabled in config', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({ config, grid: buildMockGrid() });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-16T00:00:00.000Z',
      to: '2026-05-17T00:00:00.000Z',
    });

    expect(response.warnings).toEqual([]);
    expect(response.slots).toHaveLength(13);
    expect(response.slots[0]?.metadata.cell_range).toBe('AO2');
    expect(response.slots.at(-1)?.metadata.cell_range).toBe('AO14');
  });

  it('ignores Tuesday slots when Tuesday is disabled in config', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({ config, grid: buildMockGrid() });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-11T00:00:00.000Z',
      to: '2026-05-17T00:00:00.000Z',
    });

    expect(response.slots.map((slot) => slot.metadata.column_name)).toEqual([
      'AM',
      'AM',
      'AM',
      'AM',
      'AM',
      'AM',
      'AM',
      'AM',
      'AM',
      'AM',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
      'AO',
    ]);
    expect(response.slots).not.toContainEqual(expect.objectContaining({
      metadata: expect.objectContaining({ column_name: 'AN' }),
    }));
  });

  it('returns requested_day_not_enabled warning when the request only targets Tuesday', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({ config, grid: buildMockGrid() });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-12T00:00:00.000Z',
      to: '2026-05-13T00:00:00.000Z',
    });

    expect(response.slots).toEqual([]);
    expect(response.warnings).toEqual([expect.objectContaining({
      code: 'requested_day_not_enabled',
      details: expect.objectContaining({
        requested_disabled_days: ['tuesday'],
        enabled_schedule_days: ['monday', 'saturday'],
      }),
    })]);
  });

  it('attaches the same doctor metadata to Monday and Saturday slots', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({ config, grid: buildMockGrid() });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-11T00:00:00.000Z',
      to: '2026-05-17T00:00:00.000Z',
    });

    const mondaySlot = response.slots.find((slot) => slot.metadata.column_name === 'AM');
    const saturdaySlot = response.slots.find((slot) => slot.metadata.column_name === 'AO');

    expect(mondaySlot?.metadata).toMatchObject({
      doctor_id: 'dr_primary',
      admin_confirmation_required: true,
    });
    expect(saturdaySlot?.metadata).toMatchObject({
      doctor_id: 'dr_primary',
      admin_confirmation_required: true,
    });
  });

  it('makes Tuesday available when Tuesday is added to enabledScheduleDays config', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({
      config: {
        ...config,
        enabledScheduleDays: ['monday', 'tuesday', 'saturday'],
      },
      grid: buildMockGrid(),
    });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-12T00:00:00.000Z',
      to: '2026-05-13T00:00:00.000Z',
    });

    expect(response.warnings).toEqual([]);
    expect(response.slots).toHaveLength(13);
    expect(response.slots[0]?.metadata.cell_range).toBe('AN2');
    expect(response.slots.at(-1)?.metadata.cell_range).toBe('AN14');
  });

  it('parses occupied cells as unavailable', () => {
    const occupiedCells = parseScheduleGrid(buildMockGrid(), config).filter((cell) => !cell.isAvailable);

    expect(occupiedCells.map((cell) => cell.cellRange)).toEqual(['AM2', 'AM4', 'AM6']);
    expect(occupiedCells.map((cell) => cell.time)).toEqual(['11:00', '11:30', '12:00']);
  });

  it('uses providerMetadata.grid without Google credentials', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({
      config,
      env: {},
    });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-11T00:00:00.000Z',
      to: '2026-05-12T00:00:00.000Z',
      providerMetadata: {
        grid: buildMockGrid(),
      },
    });

    expect(response.warnings).toEqual([]);
    expect(response.slots).toHaveLength(10);
    expect(response.slots[0]?.metadata.cell_range).toBe('AM3');
  });

  it('reads availability from Google Sheets when no providerMetadata.grid is supplied', async () => {
    const sheetsClient = buildMockSheetsClient({
      getValues: buildMockGrid(),
    });
    const adapter = new GoogleSheetsScheduleAdapter({ config, sheetsClient });

    const response = await adapter.getAvailableSlots({
      from: '2026-05-16T00:00:00.000Z',
      to: '2026-05-17T00:00:00.000Z',
    });

    expect(sheetsClient.spreadsheets.values.get).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheet_123',
      range: "'Schedule'!A1:AP14",
    });
    expect(response.warnings).toEqual([]);
    expect(response.slots).toHaveLength(13);
    expect(response.slots[0]?.metadata.cell_range).toBe('AO2');
  });

  it('writes a confirmed appointment to the selected Google Sheets cell', async () => {
    const sheetsClient = buildMockSheetsClient();
    const adapter = new GoogleSheetsScheduleAdapter({ config, sheetsClient });
    const slot = (await adapter.getAvailableSlots({
      from: '2026-05-11T00:00:00.000Z',
      to: '2026-05-12T00:00:00.000Z',
      providerMetadata: { grid: buildMockGrid() },
    })).slots[0];

    const response = await adapter.confirmAppointment({
      slot,
      patientName: 'Jane Patient',
      service: 'Cleaning',
    });

    expect(response).toEqual({
      ok: true,
      appointmentId: 'spreadsheet_123:Schedule:AM3',
      providerMetadata: {
        spreadsheetId: 'spreadsheet_123',
        sheetName: 'Schedule',
        cell_range: 'AM3',
      },
    });
    expect(sheetsClient.spreadsheets.values.update).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheet_123',
      range: "'Schedule'!AM3",
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['Jane Patient | Cleaning | AI pending']],
      },
    });
  });

  it('returns ok false when the Google Sheets write fails', async () => {
    const sheetsClient = buildMockSheetsClient({
      updateRejects: new Error('permission denied'),
    });
    const adapter = new GoogleSheetsScheduleAdapter({ config, sheetsClient });
    const slot = (await adapter.getAvailableSlots({ providerMetadata: { grid: buildMockGrid() } })).slots[0];

    await expect(adapter.confirmAppointment({
      slot,
      patientName: 'Jane Patient',
      service: 'Cleaning',
    })).resolves.toEqual({
      ok: false,
      reason: 'google_sheets_write_failed',
    });
  });

  it('writes only minimal appointment display text to Google Sheets', async () => {
    const sheetsClient = buildMockSheetsClient();
    const adapter = new GoogleSheetsScheduleAdapter({ config, sheetsClient });
    const slot = {
      ...(await adapter.getAvailableSlots({ providerMetadata: { grid: buildMockGrid() } })).slots[0],
      metadata: {
        ...(await adapter.getAvailableSlots({ providerMetadata: { grid: buildMockGrid() } })).slots[0].metadata,
        state_json: { secret: 'do-not-write' },
        llm_confidence: 0.97,
        trace_id: 'trace_123',
      },
    };

    await adapter.confirmAppointment({
      slot,
      patientName: 'Jane Patient',
      service: 'Root canal',
      contactId: 'contact_123',
      caseId: 'case_123',
      leadId: 'lead_123',
      holdId: 'hold_123',
    });

    expect(sheetsClient.spreadsheets.values.update).toHaveBeenCalledTimes(1);
    const updateRequest = vi.mocked(sheetsClient.spreadsheets.values.update).mock.calls[0]?.[0];
    expect(updateRequest?.requestBody.values).toEqual([['Jane Patient | Root canal | AI pending']]);
    expect(JSON.stringify(updateRequest?.requestBody.values)).not.toContain('do-not-write');
    expect(JSON.stringify(updateRequest?.requestBody.values)).not.toContain('trace_123');
    expect(JSON.stringify(updateRequest?.requestBody.values)).not.toContain('0.97');
  });

  it('keeps hold and cancel methods disabled because Postgres owns holds', async () => {
    const adapter = new GoogleSheetsScheduleAdapter({ config, grid: buildMockGrid() });
    const slots = await adapter.getAvailableSlots({});

    await expect(adapter.holdSlot({ slot: slots.slots[0] })).resolves.toMatchObject({ ok: false });
    await expect(adapter.cancelHold({ holdId: 'hold_123' })).resolves.toMatchObject({ ok: false });
  });
});


interface MockSheetsClientOptions {
  getValues?: ScheduleGrid;
  updateRejects?: Error;
}

function buildMockSheetsClient(options: MockSheetsClientOptions = {}): GoogleSheetsValuesClient {
  return {
    spreadsheets: {
      values: {
        get: vi.fn().mockResolvedValue({ data: { values: options.getValues ?? [] } }),
        update: options.updateRejects === undefined
          ? vi.fn().mockResolvedValue({ data: {} })
          : vi.fn().mockRejectedValue(options.updateRejects),
        append: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
}
