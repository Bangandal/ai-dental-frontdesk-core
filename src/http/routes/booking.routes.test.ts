import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type {
  CancelHoldRequest,
  CheckAvailabilityRequest,
  ConfirmAppointmentRequest,
  ConfirmAppointmentResponse,
  HoldSlotRequest,
  HoldSlotResponse,
  ScheduleAdapter,
  ScheduleSlot,
} from '../../adapters/schedule/ScheduleAdapter.js';
import { AppointmentLifecycleService } from '../../domain/appointments/appointmentLifecycle.js';
import type {
  AppointmentRepository,
  ClinicIntegrationRecord,
  ConfirmExternalAppointmentInput,
  ExternalAppointmentRecord,
  HoldExternalAppointmentInput,
} from '../../domain/appointments/appointmentRepository.js';
import { AppointmentStatus } from '../../domain/appointments/appointmentStatus.js';
import { BookingApplyService } from '../../domain/booking/bookingApply.js';
import { registerBookingRoutes } from './booking.routes.js';

const clinicId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const caseId = '33333333-3333-4333-8333-333333333333';
const traceId = '44444444-4444-4444-8444-444444444444';

const morningSlot: ScheduleSlot = {
  startAt: '2026-05-11T13:00:00.000Z',
  endAt: '2026-05-11T13:30:00.000Z',
  timezone: 'America/New_York',
  provider: 'google_sheets',
  metadata: {
    cell_range: 'AM4',
    sheet_name: 'Schedule',
  },
};

const afternoonSlot: ScheduleSlot = {
  startAt: '2026-05-11T18:00:00.000Z',
  endAt: '2026-05-11T18:30:00.000Z',
  timezone: 'America/New_York',
  provider: 'google_sheets',
  metadata: {
    cell_range: 'AM24',
    sheet_name: 'Schedule',
  },
};

const tenSlot: ScheduleSlot = {
  ...morningSlot,
  startAt: '2026-05-11T14:00:00.000Z',
  endAt: '2026-05-11T14:30:00.000Z',
  metadata: { cell_range: 'AM8', sheet_name: 'Schedule' },
};

const elevenSlot: ScheduleSlot = {
  ...morningSlot,
  startAt: '2026-05-11T15:00:00.000Z',
  endAt: '2026-05-11T15:30:00.000Z',
  metadata: { cell_range: 'AM12', sheet_name: 'Schedule' },
};

const thirteenSlot: ScheduleSlot = {
  ...afternoonSlot,
  startAt: '2026-05-11T17:00:00.000Z',
  endAt: '2026-05-11T17:30:00.000Z',
  metadata: { cell_range: 'AM20', sheet_name: 'Schedule' },
};

const fifteenSlot: ScheduleSlot = {
  ...afternoonSlot,
  startAt: '2026-05-11T19:00:00.000Z',
  endAt: '2026-05-11T19:30:00.000Z',
  metadata: { cell_range: 'AM28', sheet_name: 'Schedule' },
};

const sixteenSlot: ScheduleSlot = {
  ...afternoonSlot,
  startAt: '2026-05-11T20:00:00.000Z',
  endAt: '2026-05-11T20:30:00.000Z',
  metadata: { cell_range: 'AM32', sheet_name: 'Schedule' },
};

const basePayload = {
  clinicId,
  contactId,
  caseId,
  bookingAction: 'propose_slot',
  serviceInterest: 'Cleaning',
  preferredDateIso: '2026-05-11',
  timeOfDay: 'morning',
  activeHoldId: null,
  patientName: 'Jane Patient',
  channel: 'telegram',
  traceId,
  durationMinutes: 30,
  metadata: {},
} as const;

describe('booking apply route', () => {
  it('propose_slot returns awaiting_patient_confirmation and creates a hold', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [morningSlot, afternoonSlot] });
    const app = await buildTestApp(repository, adapter);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: basePayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_action: 'propose_slot',
        booking_status: 'awaiting_patient_confirmation',
        appointment_id: 'appt_1',
        hold_id: `booking:${clinicId}:${contactId}:${caseId}:2026-05-11T13:00:00.000Z:AM4`,
        proposed_slot: {
          start_at: morningSlot.startAt,
          end_at: morningSlot.endAt,
          cell_range: 'AM4',
          sheet_name: 'Schedule',
          service_interest: 'Cleaning',
        },
        should_notify_admin: false,
        reason: 'slot_proposed',
      });
      expect(response.json().proposed_slots).toHaveLength(1);
      expect(repository.appointments).toHaveLength(1);
      expect(repository.appointments[0]?.status).toBe(AppointmentStatus.Held);
      expect(adapter.lastAvailabilityRequest).toMatchObject({
        clinicId,
        durationMinutes: 30,
        service: 'Cleaning',
        from: '2026-05-11T00:00:00.000Z',
        to: '2026-05-12T00:00:00.000Z',
      });
    } finally {
      await app.close();
    }
  });



  it('propose_options returns up to 3 options without creating holds or notifying admin', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [tenSlot, elevenSlot, afternoonSlot, fifteenSlot] });
    const app = await buildTestApp(repository, adapter);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          bookingAction: 'propose_options',
          timeOfDay: 'any',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_action: 'propose_options',
        booking_status: 'awaiting_slot_choice',
        proposed_slot: null,
        should_notify_admin: false,
        reason: 'slot_options_available',
      });
      expect(response.json().proposed_slots.map((slot: { option_id: string }) => slot.option_id)).toEqual(['1', '2', '3']);
      expect(repository.appointments).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('selected available slot re-checks availability and creates a hold for exact selected slot only', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [morningSlot, afternoonSlot] });
    const app = await buildTestApp(repository, adapter);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          bookingAction: 'propose_slot',
          timeOfDay: 'any',
          selectedSlotStartAt: afternoonSlot.startAt,
          selectedSlotEndAt: afternoonSlot.endAt,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_status: 'awaiting_patient_confirmation',
        proposed_slot: { start_at: afternoonSlot.startAt },
      });
      expect(repository.appointments).toHaveLength(1);
      expect(repository.appointments[0]?.startAt).toBe(afternoonSlot.startAt);
    } finally {
      await app.close();
    }
  });

  it('selected unavailable slot returns stale_slot_unavailable and does not silently choose another slot', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [morningSlot] });
    const app = await buildTestApp(repository, adapter);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          bookingAction: 'propose_slot',
          timeOfDay: 'any',
          selectedSlotStartAt: afternoonSlot.startAt,
          selectedSlotEndAt: afternoonSlot.endAt,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_status: 'no_slots',
        proposed_slot: null,
        proposed_slots: [],
        reason: 'stale_slot_unavailable',
      });
      expect(repository.appointments).toHaveLength(0);
    } finally {
      await app.close();
    }
  });


  it('enforces before time window and does not propose 10:00 or 11:00', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [elevenSlot, tenSlot, morningSlot] });
    const app = await buildTestApp(repository, adapter);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          timeOfDay: 'any',
          preferredTimeWindow: { startTime: null, endTime: '10:00' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_status: 'awaiting_patient_confirmation',
        proposed_slot: { start_at: morningSlot.startAt },
      });
      expect(response.json().proposed_slots).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('enforces after time window and does not propose 13:00', async () => {
    const app = await buildTestApp(new InMemoryAppointmentRepository(), new MockScheduleAdapter({ slots: [thirteenSlot, afternoonSlot] }));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          timeOfDay: 'any',
          preferredTimeWindow: { startTime: '14:00', endTime: null },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ proposed_slot: { start_at: afternoonSlot.startAt } });
      expect(response.json().proposed_slots.map((slot: { start_at: string }) => slot.start_at)).toEqual([afternoonSlot.startAt]);
    } finally {
      await app.close();
    }
  });

  it('enforces between time window inclusively', async () => {
    const app = await buildTestApp(new InMemoryAppointmentRepository(), new MockScheduleAdapter({ slots: [thirteenSlot, afternoonSlot, fifteenSlot, sixteenSlot] }));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          timeOfDay: 'any',
          preferredTimeWindow: { startTime: '14:00', endTime: '16:00' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().proposed_slots.map((slot: { start_at: string }) => slot.start_at)).toEqual([
        afternoonSlot.startAt,
        fifteenSlot.startAt,
        sixteenSlot.startAt,
      ]);
    } finally {
      await app.close();
    }
  });

  it('enforces exactTime and only proposes a matching start HH:mm', async () => {
    const app = await buildTestApp(new InMemoryAppointmentRepository(), new MockScheduleAdapter({ slots: [thirteenSlot, afternoonSlot, fifteenSlot] }));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          timeOfDay: 'any',
          exactTime: '14:00',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ proposed_slot: { start_at: afternoonSlot.startAt } });
      expect(response.json().proposed_slots.map((slot: { start_at: string }) => slot.start_at)).toEqual([afternoonSlot.startAt]);
    } finally {
      await app.close();
    }
  });

  it('returns no_slots when exactTime has no matching slot', async () => {
    const app = await buildTestApp(new InMemoryAppointmentRepository(), new MockScheduleAdapter({ slots: [thirteenSlot, fifteenSlot] }));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          timeOfDay: 'any',
          exactTime: '14:00',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_status: 'no_slots',
        proposed_slot: null,
        proposed_slots: [],
      });
    } finally {
      await app.close();
    }
  });

  it('propose_slot no slots returns no_slots', async () => {
    const app = await buildTestApp(new InMemoryAppointmentRepository(), new MockScheduleAdapter({ slots: [] }));

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: basePayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        booking_action: 'propose_slot',
        booking_status: 'no_slots',
        proposed_slot: null,
        proposed_slots: [],
        should_notify_admin: false,
        reply_text_override: 'Свободных слотов по вашему запросу сейчас не нашёл. Могу предложить другой день или передать администратору для ручной проверки.',
        reason: 'no_slots_available',
      });
    } finally {
      await app.close();
    }
  });

  it('confirm_slot confirms the latest held appointment when activeHoldId is missing', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [morningSlot, afternoonSlot] });
    const app = await buildTestApp(repository, adapter);

    try {
      await repository.upsertHeldExternalAppointment({
        clinicId,
        contactId,
        caseId,
        externalProvider: morningSlot.provider,
        service: 'Cleaning',
        patientName: 'Jane Patient',
        dedupeKey: 'older-hold',
        slot: morningSlot,
        meta: { provider_metadata: morningSlot.metadata, slot: morningSlot },
      });
      await repository.upsertHeldExternalAppointment({
        clinicId,
        contactId,
        caseId,
        externalProvider: afternoonSlot.provider,
        service: 'Cleaning',
        patientName: 'Jane Patient',
        dedupeKey: 'latest-hold',
        slot: afternoonSlot,
        meta: { provider_metadata: afternoonSlot.metadata, slot: afternoonSlot },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          bookingAction: 'confirm_slot',
          activeHoldId: null,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_action: 'confirm_slot',
        booking_status: 'booked_pending_admin_confirmation',
        appointment_id: 'appt_2',
        appointment: {
          appointment_id: 'appt_2',
          case_id: caseId,
          start_at: afternoonSlot.startAt,
          end_at: afternoonSlot.endAt,
          cell_range: 'AM24',
          sheet_name: 'Schedule',
          service_interest: 'Cleaning',
          status: AppointmentStatus.BookedPendingAdminConfirmation,
        },
        should_notify_admin: true,
        reason: 'appointment_confirmed',
      });
      expect(adapter.confirmCalls).toBe(1);
      expect(repository.appointments[1]?.status).toBe(AppointmentStatus.BookedPendingAdminConfirmation);
    } finally {
      await app.close();
    }
  });

  it('confirm_slot writes through the adapter and returns booked_pending_admin_confirmation', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [morningSlot] });
    const app = await buildTestApp(repository, adapter);

    try {
      const proposeResponse = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: basePayload,
      });
      const holdId = proposeResponse.json().hold_id;

      const confirmResponse = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          bookingAction: 'confirm_slot',
          activeHoldId: holdId,
        },
      });

      expect(confirmResponse.statusCode).toBe(200);
      expect(confirmResponse.json()).toMatchObject({
        booking_action: 'confirm_slot',
        booking_status: 'booked_pending_admin_confirmation',
        appointment_id: 'appt_1',
        appointment: {
          appointment_id: 'appt_1',
          start_at: morningSlot.startAt,
          end_at: morningSlot.endAt,
          status: AppointmentStatus.BookedPendingAdminConfirmation,
        },
        should_notify_admin: true,
        reason: 'appointment_confirmed',
      });
      expect(adapter.confirmCalls).toBe(1);
      expect(adapter.lastConfirmRequest).toMatchObject({
        patientName: 'Jane Patient',
        service: 'Cleaning',
        slot: expect.objectContaining({ metadata: expect.objectContaining({ cell_range: 'AM4' }) }),
      });
    } finally {
      await app.close();
    }
  });

  it('confirm_slot failures return an n8n-compatible external_write_failed payload', async () => {
    const repository = new InMemoryAppointmentRepository();
    const adapter = new MockScheduleAdapter({ slots: [morningSlot], confirmOk: false });
    const app = await buildTestApp(repository, adapter);

    try {
      const proposeResponse = await app.inject({ method: 'POST', url: '/booking/apply', payload: basePayload });
      const confirmResponse = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          bookingAction: 'confirm_slot',
          activeHoldId: proposeResponse.json().hold_id,
        },
      });

      expect(confirmResponse.statusCode).toBe(200);
      expect(confirmResponse.json()).toMatchObject({
        booking_action: 'confirm_slot',
        booking_status: 'external_write_failed',
        appointment_id: 'appt_1',
        should_notify_admin: true,
        reply_text_override: 'Не удалось автоматически подтвердить запись. Я передам администратору для ручной проверки.',
        reason: 'external_write_failed',
      });
    } finally {
      await app.close();
    }
  });

  it('none returns no booking action', async () => {
    const app = await buildTestApp(new InMemoryAppointmentRepository(), new MockScheduleAdapter());

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/booking/apply',
        payload: {
          ...basePayload,
          bookingAction: 'none',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        booking_action: 'none',
        booking_status: 'none',
        should_notify_admin: false,
        reason: 'no_booking_action',
      });
    } finally {
      await app.close();
    }
  });

  it('keeps output shape compatible with n8n Attach Booking Decision', async () => {
    const app = await buildTestApp(new InMemoryAppointmentRepository(), new MockScheduleAdapter({ slots: [morningSlot] }));

    try {
      const response = await app.inject({ method: 'POST', url: '/booking/apply', payload: basePayload });
      const payload = response.json();

      expect(Object.keys(payload).sort()).toEqual([
        'appointment_id',
        'booking_action',
        'booking_status',
        'hold_id',
        'proposed_slot',
        'proposed_slots',
        'reason',
        'should_notify_admin',
      ]);
      expect(payload.proposed_slot).toEqual(expect.objectContaining({
        start_at: expect.any(String),
        end_at: expect.any(String),
        label: expect.any(String),
        cell_range: expect.any(String),
        sheet_name: expect.any(String),
        service_interest: expect.any(String),
      }));
      expect(Array.isArray(payload.proposed_slots)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

async function buildTestApp(
  repository: InMemoryAppointmentRepository,
  adapter: MockScheduleAdapter,
): Promise<FastifyInstance> {
  const app = Fastify();
  const appointmentLifecycle = new AppointmentLifecycleService({
    repository,
    scheduleAdapterFactory: () => adapter,
  });
  const bookingApplyService = new BookingApplyService(appointmentLifecycle, repository);

  await app.register(registerBookingRoutes, { bookingApplyService });

  return app;
}

class MockScheduleAdapter implements ScheduleAdapter {
  availabilityCalls = 0;
  confirmCalls = 0;
  lastAvailabilityRequest?: CheckAvailabilityRequest;
  lastConfirmRequest?: ConfirmAppointmentRequest;

  constructor(private readonly options: { slots?: ScheduleSlot[]; confirmOk?: boolean } = {}) {}

  async getAvailableSlots(request: CheckAvailabilityRequest): Promise<{ slots: ScheduleSlot[] }> {
    this.availabilityCalls += 1;
    this.lastAvailabilityRequest = request;
    return { slots: this.options.slots ?? [morningSlot] };
  }

  async holdSlot(_request: HoldSlotRequest): Promise<HoldSlotResponse> {
    return { ok: false, reason: 'not implemented in mock' };
  }

  async confirmAppointment(request: ConfirmAppointmentRequest): Promise<ConfirmAppointmentResponse> {
    this.confirmCalls += 1;
    this.lastConfirmRequest = request;

    if (this.options.confirmOk === false) {
      return { ok: false, reason: 'mock external failure' };
    }

    return {
      ok: true,
      appointmentId: `external:${request.slot.metadata.cell_range ?? 'unknown'}`,
      providerMetadata: request.slot.metadata,
    };
  }

  async cancelHold(_request: CancelHoldRequest): Promise<{ ok: boolean; reason?: string }> {
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
    config: {},
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
      status: AppointmentStatus.Held,
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

  async findLatestHeldAppointmentForContactOrCase(
    requestClinicId: string,
    requestContactId: string,
    requestCaseId?: string | null,
  ): Promise<ExternalAppointmentRecord | null> {
    return [...this.appointments].reverse().find((appointment) => (
      appointment.clinicId === requestClinicId
      && appointment.status === AppointmentStatus.Held
      && (
        appointment.contactId === requestContactId
        || (requestCaseId !== null && requestCaseId !== undefined && appointment.caseId === requestCaseId)
      )
    )) ?? null;
  }

  async markExternalWriteFailed(appointmentId: string, reason: string): Promise<ExternalAppointmentRecord> {
    const appointment = this.getAppointment(appointmentId);
    appointment.status = AppointmentStatus.FailedExternalWrite;
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
    appointment.status = AppointmentStatus.BookedPendingAdminConfirmation;
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
