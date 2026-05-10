import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type {
  ConfirmAppointmentRequest,
  ConfirmAppointmentResponse,
  HoldSlotRequest,
  HoldSlotResponse,
  ScheduleAdapter,
} from '../../adapters/schedule/ScheduleAdapter.js';
import { AppointmentLifecycleService } from '../../domain/appointments/appointmentLifecycle.js';
import type {
  AppointmentRepository,
  ClinicIntegrationRecord,
  ConfirmExternalAppointmentInput,
  ExternalAppointmentRecord,
  HoldExternalAppointmentInput,
} from '../../domain/appointments/appointmentRepository.js';
import { registerAppointmentRoutes } from './appointments.routes.js';
import { registerAvailabilityRoutes } from './availability.routes.js';

const clinicId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const caseId = '33333333-3333-4333-8333-333333333333';

const slot = {
  startAt: '2026-05-11T15:15:00.000Z',
  endAt: '2026-05-11T15:30:00.000Z',
  timezone: 'America/New_York',
  provider: 'google_sheets',
  metadata: {
    cell_range: 'AM3',
    sheet_name: 'Schedule',
  },
};

describe('appointment lifecycle routes', () => {
  it('checks availability through the active schedule adapter', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter();
    const app = Fastify();
    const appointmentLifecycle = new AppointmentLifecycleService({
      repository,
      scheduleAdapterFactory: () => adapter,
    });

    await app.register(registerAvailabilityRoutes, { appointmentLifecycle });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/availability/check',
        payload: { clinicId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ slots: [slot] });
      expect(adapter.availabilityCalls).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('holds appointments idempotently by dedupeKey without external writes', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter();
    const app = Fastify();
    const appointmentLifecycle = new AppointmentLifecycleService({
      repository,
      scheduleAdapterFactory: () => adapter,
    });

    await app.register(registerAppointmentRoutes, { appointmentLifecycle });

    try {
      const payload = {
        clinicId,
        contactId,
        caseId,
        dedupeKey: 'hold-1',
        slot,
        patientName: 'Jane Patient',
        service: 'Cleaning',
      };

      const first = await app.inject({ method: 'POST', url: '/appointments/hold', payload });
      const retry = await app.inject({ method: 'POST', url: '/appointments/hold', payload });

      expect(first.statusCode).toBe(200);
      expect(retry.statusCode).toBe(200);
      expect(first.json()).toEqual(retry.json());
      expect(repository.appointments).toHaveLength(1);
      expect(repository.appointments[0]?.status).toBe('held');
      expect(adapter.confirmCalls).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('confirms through the schedule adapter and updates the appointment mirror', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter();
    const service = new AppointmentLifecycleService({
      repository,
      scheduleAdapterFactory: () => adapter,
    });
    const app = Fastify();

    await app.register(registerAppointmentRoutes, { appointmentLifecycle: service });
    await service.holdAppointment({ clinicId, contactId, dedupeKey: 'confirm-1', slot });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/appointments/confirm',
        payload: { clinicId, dedupeKey: 'confirm-1', slot },
      });
      const retry = await app.inject({
        method: 'POST',
        url: '/appointments/confirm',
        payload: { clinicId, dedupeKey: 'confirm-1', slot },
      });

      expect(response.statusCode).toBe(200);
      expect(retry.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        appointment_id: 'appt_1',
        status: 'booked_pending_admin_confirmation',
        provider_metadata: {
          cell_range: 'AM3',
          external_appointment_id: 'external_123',
        },
      });
      expect(retry.json()).toEqual(response.json());
      expect(repository.appointments[0]?.status).toBe('booked_pending_admin_confirmation');
      expect(adapter.confirmCalls).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('keeps the DB row and returns a structured error when external confirmation fails', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ confirmOk: false });
    const service = new AppointmentLifecycleService({
      repository,
      scheduleAdapterFactory: () => adapter,
    });
    const app = Fastify();

    await app.register(registerAppointmentRoutes, { appointmentLifecycle: service });
    await service.holdAppointment({ clinicId, contactId, dedupeKey: 'confirm-fail', slot });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/appointments/confirm',
        payload: { clinicId, dedupeKey: 'confirm-fail', slot },
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({
        error: {
          code: 'external_write_failed',
          details: {
            appointment_id: 'appt_1',
            status: 'failed_external_write',
          },
        },
      });
      expect(repository.appointments[0]?.status).toBe('failed_external_write');
      expect(adapter.confirmCalls).toBe(1);
    } finally {
      await app.close();
    }
  });
});

class MockScheduleAdapter implements ScheduleAdapter {
  availabilityCalls = 0;
  confirmCalls = 0;

  constructor(private readonly options: { confirmOk?: boolean } = {}) {}

  async getAvailableSlots(): Promise<{ slots: Array<typeof slot> }> {
    this.availabilityCalls += 1;
    return { slots: [slot] };
  }

  async holdSlot(_request: HoldSlotRequest): Promise<HoldSlotResponse> {
    return { ok: false, reason: 'not implemented in mock' };
  }

  async confirmAppointment(_request: ConfirmAppointmentRequest): Promise<ConfirmAppointmentResponse> {
    this.confirmCalls += 1;

    if (this.options.confirmOk === false) {
      return { ok: false, reason: 'mock external failure' };
    }

    return { ok: true, appointmentId: 'external_123' };
  }

  async cancelHold(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: false, reason: 'not implemented in mock' };
  }
}

class InMemoryAppointmentRepository implements AppointmentRepository {
  appointments: ExternalAppointmentRecord[] = [];

  private readonly integration: ClinicIntegrationRecord = {
    id: 'integration_1',
    clinicId,
    provider: 'google_sheets',
    name: 'Mock Schedule',
    config: {
      timeColumn: 'B',
      dateHeaderRow: 1,
      firstTimeRow: 2,
      timezone: 'America/New_York',
      slotMinutes: 15,
    },
  };

  async getActiveScheduleIntegration(requestClinicId: string): Promise<ClinicIntegrationRecord | null> {
    return requestClinicId === clinicId ? this.integration : null;
  }

  async upsertHeldExternalAppointment(input: HoldExternalAppointmentInput): Promise<ExternalAppointmentRecord> {
    const existing = await this.findExternalAppointmentByDedupeKey(input.clinicId, input.dedupeKey);

    if (existing !== null) {
      return existing;
    }

    const appointment: ExternalAppointmentRecord = {
      id: `appt_${this.appointments.length + 1}`,
      clinicId: input.clinicId,
      contactId: input.contactId,
      caseId: input.caseId ?? null,
      leadId: input.leadId ?? null,
      externalProvider: input.externalProvider,
      sheetName: stringMetadata(input.slot.metadata.sheet_name),
      cellRange: stringMetadata(input.slot.metadata.cell_range),
      service: input.service ?? null,
      patientName: input.patientName ?? null,
      startAt: input.slot.startAt,
      endAt: input.slot.endAt,
      status: 'held',
      dedupeKey: input.dedupeKey,
      meta: input.meta ?? {},
    };

    this.appointments.push(appointment);
    return appointment;
  }

  async findExternalAppointmentByDedupeKey(
    requestClinicId: string,
    dedupeKey: string,
  ): Promise<ExternalAppointmentRecord | null> {
    return this.appointments.find((appointment) => (
      appointment.clinicId === requestClinicId && appointment.dedupeKey === dedupeKey
    )) ?? null;
  }

  async markExternalWriteFailed(appointmentId: string, reason: string): Promise<ExternalAppointmentRecord> {
    const appointment = this.getAppointment(appointmentId);
    appointment.status = 'failed_external_write';
    appointment.meta = {
      ...appointment.meta,
      external_write_error: reason,
    };
    return appointment;
  }

  async markBookedPendingAdminConfirmation(
    input: ConfirmExternalAppointmentInput,
  ): Promise<ExternalAppointmentRecord> {
    const appointment = this.getAppointment(input.appointmentId);
    appointment.status = 'booked_pending_admin_confirmation';
    appointment.externalRecordId = input.externalRecordId;
    appointment.meta = {
      ...appointment.meta,
      provider_metadata: input.providerMetadata ?? {},
    };
    return appointment;
  }

  private getAppointment(appointmentId: string): ExternalAppointmentRecord {
    const appointment = this.appointments.find((candidate) => candidate.id === appointmentId);

    if (appointment === undefined) {
      throw new Error(`Missing appointment: ${appointmentId}`);
    }

    return appointment;
  }
}

function stringMetadata(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
