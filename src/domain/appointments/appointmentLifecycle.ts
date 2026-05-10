import type {
  CheckAvailabilityRequest,
  CheckAvailabilityResponse,
  ConfirmAppointmentRequest,
  HoldSlotRequest,
  ScheduleAdapter,
} from '../../adapters/schedule/ScheduleAdapter.js';
import { GoogleSheetsScheduleAdapter } from '../../adapters/schedule/googleSheets/GoogleSheetsScheduleAdapter.js';
import type { GoogleSheetsScheduleConfig } from '../../adapters/schedule/googleSheets/parseScheduleGrid.js';
import type {
  AppointmentRepository,
  ClinicIntegrationRecord,
  ExternalAppointmentRecord,
} from './appointmentRepository.js';

export interface HoldAppointmentRequest extends HoldSlotRequest {
  clinicId: string;
  contactId: string;
  dedupeKey: string;
}

export interface ConfirmBookedAppointmentRequest extends ConfirmAppointmentRequest {
  clinicId: string;
  dedupeKey: string;
}

export interface HoldAppointmentResponse {
  appointment_id: string;
  status: string;
  dedupe_key: string;
  provider_metadata: Record<string, unknown>;
}

export interface ConfirmBookedAppointmentResponse {
  appointment_id: string;
  status: string;
  provider_metadata: Record<string, unknown>;
}

export type AppointmentLifecycleResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppointmentLifecycleError };

export interface AppointmentLifecycleError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export type ScheduleAdapterFactory = (integration: ClinicIntegrationRecord) => ScheduleAdapter;

export interface AppointmentLifecycleDependencies {
  repository: AppointmentRepository;
  scheduleAdapterFactory?: ScheduleAdapterFactory;
}

export class AppointmentLifecycleService {
  private readonly repository: AppointmentRepository;
  private readonly scheduleAdapterFactory: ScheduleAdapterFactory;

  constructor(dependencies: AppointmentLifecycleDependencies) {
    this.repository = dependencies.repository;
    this.scheduleAdapterFactory = dependencies.scheduleAdapterFactory ?? createScheduleAdapter;
  }

  async checkAvailability(
    request: CheckAvailabilityRequest & { clinicId: string },
  ): Promise<AppointmentLifecycleResult<CheckAvailabilityResponse>> {
    const integration = await this.repository.getActiveScheduleIntegration(request.clinicId);

    if (integration === null) {
      return notFound('schedule_integration_not_found', 'No active schedule integration is configured for this clinic.');
    }

    const adapter = this.scheduleAdapterFactory(integration);
    const response = await adapter.getAvailableSlots(request);

    return { ok: true, data: response };
  }

  async holdAppointment(
    request: HoldAppointmentRequest,
  ): Promise<AppointmentLifecycleResult<HoldAppointmentResponse>> {
    const integration = await this.repository.getActiveScheduleIntegration(request.clinicId);

    if (integration === null) {
      return notFound('schedule_integration_not_found', 'No active schedule integration is configured for this clinic.');
    }

    const appointment = await this.repository.upsertHeldExternalAppointment({
      clinicId: request.clinicId,
      contactId: request.contactId,
      caseId: request.caseId,
      leadId: request.leadId,
      externalProvider: request.slot.provider || integration.provider,
      service: request.service,
      patientName: request.patientName,
      dedupeKey: request.dedupeKey,
      slot: request.slot,
      meta: {
        provider_metadata: request.slot.metadata,
      },
    });

    return {
      ok: true,
      data: toHoldResponse(appointment),
    };
  }

  async confirmAppointment(
    request: ConfirmBookedAppointmentRequest,
  ): Promise<AppointmentLifecycleResult<ConfirmBookedAppointmentResponse>> {
    const appointment = await this.repository.findExternalAppointmentByDedupeKey(request.clinicId, request.dedupeKey);

    if (appointment === null) {
      return notFound('appointment_not_found', 'No appointment hold exists for this dedupe key.');
    }

    if (appointment.status === 'booked_pending_admin_confirmation') {
      return {
        ok: true,
        data: toConfirmResponse(appointment),
      };
    }

    const integration = await this.repository.getActiveScheduleIntegration(request.clinicId);

    if (integration === null) {
      return notFound('schedule_integration_not_found', 'No active schedule integration is configured for this clinic.');
    }

    const adapter = this.scheduleAdapterFactory(integration);

    try {
      const externalWrite = await adapter.confirmAppointment({
        holdId: request.holdId,
        slot: request.slot,
        patientName: appointment.patientName ?? request.patientName,
        service: appointment.service ?? request.service,
      });

      if (!externalWrite.ok) {
        const failed = await this.repository.markExternalWriteFailed(
          appointment.id,
          externalWrite.reason ?? 'External schedule adapter rejected the appointment confirmation.',
        );

        return externalWriteFailed(failed, externalWrite.reason);
      }

      const confirmed = await this.repository.markBookedPendingAdminConfirmation({
        appointmentId: appointment.id,
        externalRecordId: externalWrite.appointmentId,
        providerMetadata: {
          ...request.slot.metadata,
          external_appointment_id: externalWrite.appointmentId,
        },
      });

      return {
        ok: true,
        data: toConfirmResponse(confirmed),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'External schedule adapter failed.';
      const failed = await this.repository.markExternalWriteFailed(appointment.id, reason);

      return externalWriteFailed(failed, reason);
    }
  }
}

export function createScheduleAdapter(integration: ClinicIntegrationRecord): ScheduleAdapter {
  if (integration.provider === 'google_sheets') {
    return new GoogleSheetsScheduleAdapter(parseGoogleSheetsConfig(integration.config));
  }

  throw new Error(`Unsupported schedule integration provider: ${integration.provider}`);
}

function parseGoogleSheetsConfig(config: Record<string, unknown>): GoogleSheetsScheduleConfig {
  const timeColumn = readString(config, 'timeColumn');
  const dateHeaderRow = readNumber(config, 'dateHeaderRow');
  const firstTimeRow = readNumber(config, 'firstTimeRow');
  const timezone = readString(config, 'timezone');
  const slotMinutes = readNumber(config, 'slotMinutes');
  const sheetName = readOptionalString(config, 'sheetName');

  return {
    timeColumn,
    dateHeaderRow,
    firstTimeRow,
    timezone,
    slotMinutes,
    ...(sheetName === undefined ? {} : { sheetName }),
  };
}

function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Google Sheets schedule config is missing string field: ${key}`);
  }

  return value;
}

function readOptionalString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Google Sheets schedule config field must be a string: ${key}`);
  }

  return value;
}

function readNumber(config: Record<string, unknown>, key: string): number {
  const value = config[key];

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Google Sheets schedule config is missing positive integer field: ${key}`);
  }

  return value;
}

function toHoldResponse(appointment: ExternalAppointmentRecord): HoldAppointmentResponse {
  return {
    appointment_id: appointment.id,
    status: appointment.status,
    dedupe_key: appointment.dedupeKey,
    provider_metadata: getProviderMetadata(appointment),
  };
}

function toConfirmResponse(appointment: ExternalAppointmentRecord): ConfirmBookedAppointmentResponse {
  return {
    appointment_id: appointment.id,
    status: appointment.status,
    provider_metadata: getProviderMetadata(appointment),
  };
}

function getProviderMetadata(appointment: ExternalAppointmentRecord): Record<string, unknown> {
  const metadata = appointment.meta.provider_metadata;

  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  return {
    cell_range: appointment.cellRange,
    sheet_name: appointment.sheetName,
    external_record_id: appointment.externalRecordId,
  };
}

function notFound(code: string, message: string): AppointmentLifecycleResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      statusCode: 404,
    },
  };
}

function externalWriteFailed(
  appointment: ExternalAppointmentRecord,
  reason: string | undefined,
): AppointmentLifecycleResult<ConfirmBookedAppointmentResponse> {
  return {
    ok: false,
    error: {
      code: 'external_write_failed',
      message: 'External schedule write failed; appointment was retained with failed_external_write status.',
      statusCode: 502,
      details: {
        appointment_id: appointment.id,
        status: appointment.status,
        reason,
        provider_metadata: getProviderMetadata(appointment),
      },
    },
  };
}
