import type {
  CancelHoldRequest,
  CheckAvailabilityRequest,
  CheckAvailabilityResponse,
  ConfirmAppointmentRequest,
  ConfirmAppointmentResponse,
  HoldSlotRequest,
  HoldSlotResponse,
  ScheduleAdapter,
} from '../ScheduleAdapter.js';
import { findAvailableSlots } from './findAvailableSlots.js';
import type { GoogleSheetsScheduleConfig, ScheduleGrid } from './parseScheduleGrid.js';

export interface GoogleSheetsScheduleAdapterOptions {
  config: GoogleSheetsScheduleConfig;
  grid?: ScheduleGrid;
}

export class GoogleSheetsScheduleAdapter implements ScheduleAdapter {
  private readonly config: GoogleSheetsScheduleConfig;
  private readonly grid: ScheduleGrid;

  constructor(configOrOptions: GoogleSheetsScheduleConfig | GoogleSheetsScheduleAdapterOptions, grid: ScheduleGrid = []) {
    if ('config' in configOrOptions) {
      this.config = configOrOptions.config;
      this.grid = configOrOptions.grid ?? grid;
      return;
    }

    this.config = configOrOptions;
    this.grid = grid;
  }

  async getAvailableSlots(request: CheckAvailabilityRequest): Promise<CheckAvailabilityResponse> {
    const requestGrid = request.providerMetadata?.grid;
    const grid = isScheduleGrid(requestGrid) ? requestGrid : this.grid;

    return {
      slots: findAvailableSlots(grid, this.config, request),
    };
  }

  async holdSlot(_request: HoldSlotRequest): Promise<HoldSlotResponse> {
    return {
      ok: false,
      reason: 'Google Sheets schedule adapter is read-only; holdSlot is not implemented yet.',
    };
  }

  async confirmAppointment(_request: ConfirmAppointmentRequest): Promise<ConfirmAppointmentResponse> {
    return {
      ok: false,
      reason: 'Google Sheets schedule adapter is read-only; confirmAppointment is not implemented yet.',
    };
  }

  async cancelHold(_request: CancelHoldRequest): Promise<{ ok: boolean; reason?: string }> {
    return {
      ok: false,
      reason: 'Google Sheets schedule adapter is read-only; cancelHold is not implemented yet.',
    };
  }
}

function isScheduleGrid(value: unknown): value is ScheduleGrid {
  return Array.isArray(value) && value.every((row) => Array.isArray(row));
}
