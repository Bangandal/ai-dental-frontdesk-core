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
import { findAvailableSlotsWithWarnings } from './findAvailableSlots.js';
import type { GoogleSheetsScheduleConfig, ScheduleGrid } from './parseScheduleGrid.js';

export interface GoogleSheetsScheduleAdapterOptions {
  config: GoogleSheetsScheduleConfig;
  grid?: ScheduleGrid;
  sheetsClient?: GoogleSheetsValuesClient;
  env?: NodeJS.ProcessEnv;
}

export interface GoogleSheetsValuesClient {
  spreadsheets: {
    values: {
      get(request: GoogleSheetsGetRequest): Promise<{ data: { values?: unknown[][] | null } }>;
      update(request: GoogleSheetsUpdateRequest): Promise<unknown>;
      append(request: GoogleSheetsAppendRequest): Promise<unknown>;
    };
  };
}

interface GoogleSheetsGetRequest {
  spreadsheetId: string;
  range: string;
}

interface GoogleSheetsUpdateRequest {
  spreadsheetId: string;
  range: string;
  valueInputOption: 'USER_ENTERED';
  requestBody: {
    values: string[][];
  };
}

interface GoogleSheetsAppendRequest extends GoogleSheetsUpdateRequest {
  insertDataOption: 'OVERWRITE';
}

type GoogleSheetsClientResult =
  | { ok: true; client: GoogleSheetsValuesClient }
  | { ok: false; reason: string };

const defaultServiceAccountJsonEnvVar = 'GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON';
const googleSheetsScope = 'https://www.googleapis.com/auth/spreadsheets';

export class GoogleSheetsScheduleAdapter implements ScheduleAdapter {
  private readonly config: GoogleSheetsScheduleConfig;
  private readonly grid: ScheduleGrid;
  private readonly sheetsClient?: GoogleSheetsValuesClient;
  private readonly env: NodeJS.ProcessEnv;

  constructor(configOrOptions: GoogleSheetsScheduleConfig | GoogleSheetsScheduleAdapterOptions, grid: ScheduleGrid = []) {
    if ('config' in configOrOptions) {
      this.config = configOrOptions.config;
      this.grid = configOrOptions.grid ?? grid;
      this.sheetsClient = configOrOptions.sheetsClient;
      this.env = configOrOptions.env ?? process.env;
      return;
    }

    this.config = configOrOptions;
    this.grid = grid;
    this.env = process.env;
  }

  async getAvailableSlots(request: CheckAvailabilityRequest): Promise<CheckAvailabilityResponse> {
    const requestGrid = request.providerMetadata?.grid;

    if (isScheduleGrid(requestGrid)) {
      return findAvailableSlotsWithWarnings(requestGrid, this.config, request);
    }

    const grid = await this.readGridFromGoogleSheets();
    return findAvailableSlotsWithWarnings(grid, this.config, request);
  }

  async holdSlot(_request: HoldSlotRequest): Promise<HoldSlotResponse> {
    return {
      ok: false,
      reason: 'Google Sheets schedule adapter does not create external holds; Postgres remains the source of truth for held appointments.',
    };
  }

  async confirmAppointment(request: ConfirmAppointmentRequest): Promise<ConfirmAppointmentResponse> {
    const configValidation = validateGoogleSheetsConfig(this.config);
    if (!configValidation.ok) {
      return configValidation;
    }

    const cellRange = readStringMetadata(request.slot.metadata, 'cell_range');
    if (cellRange === undefined) {
      return {
        ok: false,
        reason: 'google_sheets_missing_slot_cell_range',
      };
    }

    const sheetName = readStringMetadata(request.slot.metadata, 'sheet_name') ?? this.config.sheetName;
    if (sheetName === undefined || sheetName.length === 0) {
      return {
        ok: false,
        reason: 'google_sheets_missing_sheet_name',
      };
    }

    const clientResult = await this.getGoogleSheetsClient();
    if (!clientResult.ok) {
      return clientResult;
    }

    const appointmentText = formatMinimalAppointmentText(request);
    const qualifiedRange = qualifyRange(sheetName, cellRange);

    try {
      if (this.config.writeMode === 'append') {
        await clientResult.client.spreadsheets.values.append({
          spreadsheetId: this.config.spreadsheetId,
          range: qualifiedRange,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'OVERWRITE',
          requestBody: {
            values: [[appointmentText]],
          },
        });
      } else {
        await clientResult.client.spreadsheets.values.update({
          spreadsheetId: this.config.spreadsheetId,
          range: qualifiedRange,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[appointmentText]],
          },
        });
      }
    } catch {
      return {
        ok: false,
        reason: 'google_sheets_write_failed',
      };
    }

    return {
      ok: true,
      appointmentId: `${this.config.spreadsheetId}:${sheetName}:${cellRange}`,
      providerMetadata: {
        spreadsheetId: this.config.spreadsheetId,
        sheetName,
        cell_range: cellRange,
      },
    };
  }

  async cancelHold(_request: CancelHoldRequest): Promise<{ ok: boolean; reason?: string }> {
    return {
      ok: false,
      reason: 'Google Sheets schedule adapter does not create external holds; cancelHold is not implemented for this provider.',
    };
  }

  private async readGridFromGoogleSheets(): Promise<ScheduleGrid> {
    const configValidation = validateGoogleSheetsConfig(this.config);
    if (!configValidation.ok) {
      return this.grid;
    }

    const clientResult = await this.getGoogleSheetsClient();
    if (!clientResult.ok) {
      return this.grid;
    }

    try {
      const response = await clientResult.client.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: qualifyRange(this.config.sheetName, this.config.readRange),
      });

      const values = response.data.values;
      return isScheduleGrid(values) ? values : [];
    } catch {
      return this.grid;
    }
  }

  private async getGoogleSheetsClient(): Promise<GoogleSheetsClientResult> {
    if (this.sheetsClient !== undefined) {
      return { ok: true, client: this.sheetsClient };
    }

    const credentialsResult = readServiceAccountCredentials(this.config, this.env);
    if (!credentialsResult.ok) {
      return credentialsResult;
    }

    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: credentialsResult.credentials,
      scopes: [googleSheetsScope],
    });

    return {
      ok: true,
      client: google.sheets({ version: 'v4', auth }) as unknown as GoogleSheetsValuesClient,
    };
  }
}

function validateGoogleSheetsConfig(config: GoogleSheetsScheduleConfig): { ok: true } | { ok: false; reason: string } {
  if (typeof config.spreadsheetId !== 'string' || config.spreadsheetId.length === 0) {
    return { ok: false, reason: 'google_sheets_missing_spreadsheet_id' };
  }

  if (typeof config.readRange !== 'string' || config.readRange.length === 0) {
    return { ok: false, reason: 'google_sheets_missing_read_range' };
  }

  if (config.writeMode !== 'cell' && config.writeMode !== 'append') {
    return { ok: false, reason: 'google_sheets_invalid_write_mode' };
  }

  return { ok: true };
}

function readServiceAccountCredentials(
  config: GoogleSheetsScheduleConfig,
  env: NodeJS.ProcessEnv,
): { ok: true; credentials: Record<string, unknown> } | { ok: false; reason: string } {
  const envVarName = config.serviceAccountJsonEnvVar ?? defaultServiceAccountJsonEnvVar;
  const rawCredentials = env[envVarName];

  if (rawCredentials === undefined || rawCredentials.trim().length === 0) {
    return { ok: false, reason: `google_sheets_missing_credentials:${envVarName}` };
  }

  let credentials: unknown;
  try {
    credentials = JSON.parse(rawCredentials);
  } catch {
    return { ok: false, reason: `google_sheets_invalid_credentials_json:${envVarName}` };
  }

  if (!isServiceAccountCredentials(credentials)) {
    return { ok: false, reason: `google_sheets_invalid_service_account_credentials:${envVarName}` };
  }

  return { ok: true, credentials };
}

function isServiceAccountCredentials(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const credentials = value as Record<string, unknown>;
  return credentials.type === 'service_account'
    && typeof credentials.client_email === 'string'
    && credentials.client_email.length > 0
    && typeof credentials.private_key === 'string'
    && credentials.private_key.length > 0;
}

function formatMinimalAppointmentText(request: ConfirmAppointmentRequest): string {
  return `${normalizeDisplayValue(request.patientName)} | ${normalizeDisplayValue(request.service)} | AI pending`;
}

function normalizeDisplayValue(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? 'Unknown' : normalized;
}

function readStringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function qualifyRange(sheetName: string | undefined, range: string): string {
  if (sheetName === undefined || sheetName.length === 0 || range.includes('!')) {
    return range;
  }

  return `'${sheetName.replaceAll("'", "''")}'!${range}`;
}

function isScheduleGrid(value: unknown): value is ScheduleGrid {
  return Array.isArray(value) && value.every((row) => Array.isArray(row));
}
