import type { ScheduleSlot } from '../../adapters/schedule/ScheduleAdapter.js';
import { AppointmentStatus } from './appointmentStatus.js';

export interface ClinicIntegrationRecord {
  id: string;
  clinicId: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
}

export interface ExternalAppointmentRecord {
  id: string;
  clinicId: string;
  contactId: string;
  caseId?: string | null;
  leadId?: string | null;
  externalProvider: string;
  externalCalendarId?: string | null;
  spreadsheetId?: string | null;
  sheetName?: string | null;
  cellRange?: string | null;
  externalRecordId?: string | null;
  service?: string | null;
  patientName?: string | null;
  doctor?: string | null;
  startAt: string;
  endAt: string;
  status: string;
  dedupeKey: string;
  meta: Record<string, unknown>;
}

export interface HoldExternalAppointmentInput {
  clinicId: string;
  contactId: string;
  caseId?: string;
  leadId?: string;
  externalProvider: string;
  service?: string;
  patientName?: string;
  dedupeKey: string;
  slot: ScheduleSlot;
  meta?: Record<string, unknown>;
}

export interface ConfirmExternalAppointmentInput {
  appointmentId: string;
  externalRecordId?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface AppointmentRepository {
  getActiveScheduleIntegration(clinicId: string): Promise<ClinicIntegrationRecord | null>;
  upsertHeldExternalAppointment(input: HoldExternalAppointmentInput): Promise<ExternalAppointmentRecord>;
  findExternalAppointmentByDedupeKey(clinicId: string, dedupeKey: string): Promise<ExternalAppointmentRecord | null>;
  findLatestHeldAppointmentForContactOrCase(
    clinicId: string,
    contactId: string,
    caseId?: string | null,
  ): Promise<ExternalAppointmentRecord | null>;
  markExternalWriteFailed(appointmentId: string, reason: string): Promise<ExternalAppointmentRecord>;
  markBookedPendingAdminConfirmation(input: ConfirmExternalAppointmentInput): Promise<ExternalAppointmentRecord>;
}

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export class PgAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: Queryable) {}

  async getActiveScheduleIntegration(clinicId: string): Promise<ClinicIntegrationRecord | null> {
    const result = await this.db.query<ClinicIntegrationRow>(
      `select id, clinic_id, provider, name, config
       from core.clinic_integrations
       where clinic_id = $1
         and is_active = true
       order by created_at asc
       limit 1`,
      [clinicId],
    );

    return result.rows[0] === undefined ? null : mapClinicIntegration(result.rows[0]);
  }

  async upsertHeldExternalAppointment(input: HoldExternalAppointmentInput): Promise<ExternalAppointmentRecord> {
    const result = await this.db.query<ExternalAppointmentRow>(
      `insert into core.external_appointments (
         clinic_id,
         contact_id,
         case_id,
         lead_id,
         external_provider,
         external_calendar_id,
         spreadsheet_id,
         sheet_name,
         cell_range,
         service,
         patient_name,
         start_at,
         end_at,
         status,
         dedupe_key,
         meta
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
       on conflict (clinic_id, dedupe_key) do update
       set updated_at = now()
       returning *`,
      [
        input.clinicId,
        input.contactId,
        input.caseId ?? null,
        input.leadId ?? null,
        input.externalProvider,
        getStringMetadata(input.slot, 'external_calendar_id'),
        getStringMetadata(input.slot, 'spreadsheet_id'),
        getStringMetadata(input.slot, 'sheet_name'),
        getStringMetadata(input.slot, 'cell_range'),
        input.service ?? null,
        input.patientName ?? null,
        input.slot.startAt,
        input.slot.endAt,
        AppointmentStatus.Held,
        input.dedupeKey,
        JSON.stringify(input.meta ?? {}),
      ],
    );

    return mapExternalAppointment(result.rows[0]);
  }

  async findExternalAppointmentByDedupeKey(
    clinicId: string,
    dedupeKey: string,
  ): Promise<ExternalAppointmentRecord | null> {
    const result = await this.db.query<ExternalAppointmentRow>(
      `select *
       from core.external_appointments
       where clinic_id = $1
         and dedupe_key = $2
       limit 1`,
      [clinicId, dedupeKey],
    );

    return result.rows[0] === undefined ? null : mapExternalAppointment(result.rows[0]);
  }

  async findLatestHeldAppointmentForContactOrCase(
    clinicId: string,
    contactId: string,
    caseId?: string | null,
  ): Promise<ExternalAppointmentRecord | null> {
    const result = await this.db.query<ExternalAppointmentRow>(
      `select *
       from core.external_appointments
       where clinic_id = $1
         and status = $3
         and (
           contact_id = $2
           or ($4::uuid is not null and case_id = $4::uuid)
         )
       order by created_at desc
       limit 1`,
      [clinicId, contactId, AppointmentStatus.Held, caseId ?? null],
    );

    return result.rows[0] === undefined ? null : mapExternalAppointment(result.rows[0]);
  }

  async markExternalWriteFailed(appointmentId: string, reason: string): Promise<ExternalAppointmentRecord> {
    const result = await this.db.query<ExternalAppointmentRow>(
      `update core.external_appointments
       set status = $3,
           meta = meta || $2::jsonb,
           updated_at = now()
       where id = $1
       returning *`,
      [appointmentId, JSON.stringify({ external_write_error: reason }), AppointmentStatus.FailedExternalWrite],
    );

    return mapExternalAppointment(result.rows[0]);
  }

  async markBookedPendingAdminConfirmation(
    input: ConfirmExternalAppointmentInput,
  ): Promise<ExternalAppointmentRecord> {
    const result = await this.db.query<ExternalAppointmentRow>(
      `update core.external_appointments
       set status = $4,
           external_record_id = coalesce($2, external_record_id),
           last_sync_at = now(),
           meta = meta || $3::jsonb,
           updated_at = now()
       where id = $1
       returning *`,
      [
        input.appointmentId,
        input.externalRecordId ?? null,
        JSON.stringify({ provider_metadata: input.providerMetadata ?? {} }),
        AppointmentStatus.BookedPendingAdminConfirmation,
      ],
    );

    return mapExternalAppointment(result.rows[0]);
  }
}

type ClinicIntegrationRow = Record<string, unknown> & {
  id: string;
  clinic_id: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
};

type ExternalAppointmentRow = Record<string, unknown> & {
  id: string;
  clinic_id: string;
  contact_id: string;
  case_id: string | null;
  lead_id: string | null;
  external_provider: string;
  external_calendar_id: string | null;
  spreadsheet_id: string | null;
  sheet_name: string | null;
  cell_range: string | null;
  external_record_id: string | null;
  service: string | null;
  patient_name: string | null;
  doctor: string | null;
  start_at: Date | string;
  end_at: Date | string;
  status: string;
  dedupe_key: string;
  meta: Record<string, unknown> | null;
};

function mapClinicIntegration(row: ClinicIntegrationRow): ClinicIntegrationRecord {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    provider: row.provider,
    name: row.name,
    config: row.config,
  };
}

function mapExternalAppointment(row: ExternalAppointmentRow | undefined): ExternalAppointmentRecord {
  if (row === undefined) {
    throw new Error('Expected external appointment row');
  }

  return {
    id: row.id,
    clinicId: row.clinic_id,
    contactId: row.contact_id,
    caseId: row.case_id,
    leadId: row.lead_id,
    externalProvider: row.external_provider,
    externalCalendarId: row.external_calendar_id,
    spreadsheetId: row.spreadsheet_id,
    sheetName: row.sheet_name,
    cellRange: row.cell_range,
    externalRecordId: row.external_record_id,
    service: row.service,
    patientName: row.patient_name,
    doctor: row.doctor,
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    status: row.status,
    dedupeKey: row.dedupe_key,
    meta: row.meta ?? {},
  };
}

function getStringMetadata(slot: ScheduleSlot, key: string): string | null {
  const value = slot.metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
