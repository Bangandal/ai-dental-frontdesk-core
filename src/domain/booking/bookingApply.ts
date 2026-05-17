import type { ScheduleSlot } from '../../adapters/schedule/ScheduleAdapter.js';
import {
  AppointmentLifecycleService,
  type AppointmentLifecycleError,
} from '../appointments/appointmentLifecycle.js';
import type {
  AppointmentRepository,
  ExternalAppointmentRecord,
} from '../appointments/appointmentRepository.js';
import { selectHumanFriendlySlotOptions } from './selectHumanFriendlySlotOptions.js';

export type BookingAction = 'none' | 'propose_slot' | 'propose_options' | 'confirm_slot' | 'cancel_hold';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

export interface PreferredTimeWindow {
  startTime: string | null;
  endTime: string | null;
}

export interface BookingApplyRequest {
  clinicId: string;
  contactId: string;
  caseId?: string | null;
  bookingAction: BookingAction;
  serviceInterest?: string | null;
  preferredDateIso?: string | null;
  preferredWeekday?: string | null;
  timeOfDay: TimeOfDay;
  preferredTimeWindow?: PreferredTimeWindow;
  exactTime?: string | null;
  activeHoldId?: string | null;
  selectedSlotStartAt?: string | null;
  selectedSlotEndAt?: string | null;
  selectedSlotProviderMetadata?: Record<string, unknown> | null;
  patientName?: string | null;
  channel?: string | null;
  traceId?: string | null;
  durationMinutes: number;
  metadata: Record<string, unknown>;
}

export type BookingApplyResponse =
  | NoBookingActionResponse
  | ProposedSlotResponse
  | ProposedOptionsResponse
  | NoSlotsResponse
  | ConfirmedSlotResponse
  | BookingFailureResponse;

export interface NoBookingActionResponse {
  booking_action: 'none';
  booking_status: 'none';
  should_notify_admin: false;
  reason: 'no_booking_action';
}

export interface ProposedSlotResponse {
  booking_action: 'propose_slot';
  booking_status: 'awaiting_patient_confirmation';
  hold_id: string;
  appointment_id: string;
  proposed_slot: BookingSlotPayload;
  proposed_slots: BookingSlotPayload[];
  should_notify_admin: false;
  reason: 'slot_proposed';
}

export interface ProposedOptionsResponse {
  booking_action: 'propose_options';
  booking_status: 'awaiting_slot_choice';
  proposed_slot: null;
  proposed_slots: BookingSlotPayload[];
  should_notify_admin: false;
  reason: 'slot_options_available';
}

export interface NoSlotsResponse {
  booking_action: 'propose_slot' | 'propose_options';
  booking_status: 'no_slots';
  proposed_slot: null;
  proposed_slots: [];
  should_notify_admin: false;
  reply_text_override: string;
  reason: 'no_slots_available' | 'stale_slot_unavailable';
}

export interface ConfirmedSlotResponse {
  booking_action: 'confirm_slot';
  booking_status: 'booked_pending_admin_confirmation';
  appointment_id: string;
  appointment: BookingAppointmentPayload;
  should_notify_admin: true;
  reason: 'appointment_confirmed';
}

export interface BookingFailureResponse {
  booking_action: 'confirm_slot' | 'cancel_hold';
  booking_status: 'external_write_failed' | 'not_implemented';
  appointment_id?: string;
  appointment?: BookingAppointmentPayload;
  proposed_slot?: null;
  proposed_slots?: [];
  should_notify_admin: true;
  reply_text_override: string;
  reason: string;
}

export interface BookingSlotPayload {
  start_at: string;
  end_at: string;
  label: string;
  cell_range: string | null;
  sheet_name: string | null;
  service_interest: string | null;
  option_id?: string;
  provider_metadata?: Record<string, unknown>;
}

export interface BookingAppointmentPayload extends BookingSlotPayload {
  appointment_id: string;
  case_id: string | null;
  status: string;
}

const noSlotsReply = 'Свободных слотов по вашему запросу сейчас не нашёл. Могу предложить другой день или передать администратору для ручной проверки.';
const confirmFailureReply = 'Не удалось автоматически подтвердить запись. Я передам администратору для ручной проверки.';

export class BookingApplyService {
  constructor(
    private readonly appointmentLifecycle: AppointmentLifecycleService,
    private readonly repository: AppointmentRepository,
  ) {}

  async apply(request: BookingApplyRequest): Promise<BookingApplyResponse> {
    if (request.bookingAction === 'none') {
      return {
        booking_action: 'none',
        booking_status: 'none',
        should_notify_admin: false,
        reason: 'no_booking_action',
      };
    }

    if (request.bookingAction === 'propose_options') {
      return this.proposeOptions(request);
    }

    if (request.bookingAction === 'propose_slot') {
      return this.proposeSlot(request);
    }

    if (request.bookingAction === 'confirm_slot') {
      return this.confirmSlot(request);
    }

    return {
      booking_action: 'cancel_hold',
      booking_status: 'not_implemented',
      proposed_slot: null,
      proposed_slots: [],
      should_notify_admin: true,
      reply_text_override: confirmFailureReply,
      reason: 'cancel_hold_not_implemented',
    };
  }

  private async proposeOptions(request: BookingApplyRequest): Promise<ProposedOptionsResponse | NoSlotsResponse> {
    const candidateSlots = await this.findCandidateSlots(request);

    if (candidateSlots.length === 0) {
      return noSlotsResponse('propose_options');
    }

    return {
      booking_action: 'propose_options',
      booking_status: 'awaiting_slot_choice',
      proposed_slot: null,
      proposed_slots: selectHumanFriendlySlotOptions(candidateSlots, {
        maxOptions: readSaneIntegerMetadata(request.metadata, 'max_options', 3),
        proposalStepMinutes: readSaneIntegerMetadata(request.metadata, 'proposal_step_minutes', 60),
        fallbackProposalStepMinutes: 30,
      }).map((slot, index) => ({
        ...toBookingSlotPayload(slot, request.serviceInterest ?? null),
        option_id: String(index + 1),
        provider_metadata: slot.metadata,
      })),
      should_notify_admin: false,
      reason: 'slot_options_available',
    };
  }

  private async proposeSlot(request: BookingApplyRequest): Promise<ProposedSlotResponse | NoSlotsResponse> {
    const candidateSlots = await this.findCandidateSlots(request);
    const selectedSlot = selectSlotForHold(candidateSlots, request);

    if (selectedSlot === undefined) {
      return noSlotsResponse('propose_slot', request.selectedSlotStartAt === undefined || request.selectedSlotStartAt === null ? 'no_slots_available' : 'stale_slot_unavailable');
    }

    const dedupeKey = buildDedupeKey(request, selectedSlot);
    const hold = await this.appointmentLifecycle.holdAppointment({
      clinicId: request.clinicId,
      contactId: request.contactId,
      caseId: request.caseId ?? undefined,
      dedupeKey,
      slot: selectedSlot,
      patientName: request.patientName ?? undefined,
      service: request.serviceInterest ?? undefined,
    });

    if (!hold.ok) {
      return noSlotsResponse('propose_slot');
    }

    const proposedSlot = toBookingSlotPayload(selectedSlot, request.serviceInterest ?? null);
    const proposedSlots = candidateSlots.map((slot) => toBookingSlotPayload(slot, request.serviceInterest ?? null));

    return {
      booking_action: 'propose_slot',
      booking_status: 'awaiting_patient_confirmation',
      hold_id: dedupeKey,
      appointment_id: hold.data.appointment_id,
      proposed_slot: proposedSlot,
      proposed_slots: proposedSlots,
      should_notify_admin: false,
      reason: 'slot_proposed',
    };
  }


  private async findCandidateSlots(request: BookingApplyRequest): Promise<ScheduleSlot[]> {
    const availability = await this.appointmentLifecycle.checkAvailability({
      clinicId: request.clinicId,
      ...buildAvailabilityRange(request),
      durationMinutes: request.durationMinutes,
      service: request.serviceInterest ?? undefined,
    });

    if (!availability.ok) {
      return [];
    }

    const effectiveFrom = buildEffectiveFrom(request);

    return availability.data.slots.filter((slot) => (
      isSlotOnOrAfterEffectiveFrom(slot, effectiveFrom)
      && isSlotInRequestedTimeOfDay(slot, request.timeOfDay)
      && isSlotInRequestedTimeConstraints(slot, request)
    ));
  }

  private async confirmSlot(request: BookingApplyRequest): Promise<ConfirmedSlotResponse | BookingFailureResponse> {
    const appointment = await this.findHeldAppointment(request);

    if (appointment === null) {
      return confirmFailure('appointment_not_found');
    }

    const confirmation = await this.appointmentLifecycle.confirmAppointment({
      clinicId: request.clinicId,
      dedupeKey: appointment.dedupeKey,
      holdId: appointment.dedupeKey,
      slot: appointmentToScheduleSlot(appointment),
      patientName: appointment.patientName ?? request.patientName ?? undefined,
      service: appointment.service ?? request.serviceInterest ?? undefined,
    });

    if (!confirmation.ok) {
      return confirmFailure(confirmation.error.code, appointmentFromLifecycleError(confirmation.error, appointment));
    }

    const confirmed = {
      ...appointment,
      status: confirmation.data.status,
      meta: {
        ...appointment.meta,
        provider_metadata: confirmation.data.provider_metadata,
      },
    };

    return {
      booking_action: 'confirm_slot',
      booking_status: 'booked_pending_admin_confirmation',
      appointment_id: confirmation.data.appointment_id,
      appointment: toBookingAppointmentPayload(confirmed, request.serviceInterest ?? appointment.service ?? null),
      should_notify_admin: true,
      reason: 'appointment_confirmed',
    };
  }

  private async findHeldAppointment(request: BookingApplyRequest): Promise<ExternalAppointmentRecord | null> {
    if (request.activeHoldId !== null && request.activeHoldId !== undefined && request.activeHoldId.length > 0) {
      const appointment = await this.repository.findExternalAppointmentByDedupeKey(request.clinicId, request.activeHoldId);
      return appointment?.status === 'held' ? appointment : null;
    }

    return this.repository.findLatestHeldAppointmentForContactOrCase(request.clinicId, request.contactId, request.caseId);
  }
}


function selectSlotForHold(candidateSlots: ScheduleSlot[], request: BookingApplyRequest): ScheduleSlot | undefined {
  if (request.selectedSlotStartAt === null || request.selectedSlotStartAt === undefined) {
    return candidateSlots[0];
  }

  return candidateSlots.find((slot) => (
    slot.startAt === request.selectedSlotStartAt
    && (request.selectedSlotEndAt === null || request.selectedSlotEndAt === undefined || slot.endAt === request.selectedSlotEndAt)
  ));
}

function noSlotsResponse(bookingAction: 'propose_slot' | 'propose_options' = 'propose_slot', reason: 'no_slots_available' | 'stale_slot_unavailable' = 'no_slots_available'): NoSlotsResponse {
  return {
    booking_action: bookingAction,
    booking_status: 'no_slots',
    proposed_slot: null,
    proposed_slots: [],
    should_notify_admin: false,
    reply_text_override: noSlotsReply,
    reason,
  };
}

function confirmFailure(reason: string, appointment?: BookingAppointmentPayload): BookingFailureResponse {
  return {
    booking_action: 'confirm_slot',
    booking_status: 'external_write_failed',
    ...(appointment === undefined ? {} : { appointment_id: appointment.appointment_id, appointment }),
    should_notify_admin: true,
    reply_text_override: confirmFailureReply,
    reason,
  };
}

function appointmentFromLifecycleError(
  error: AppointmentLifecycleError,
  fallback: ExternalAppointmentRecord,
): BookingAppointmentPayload {
  const details = error.details;
  const status = typeof details?.status === 'string' ? details.status : fallback.status;

  return toBookingAppointmentPayload({ ...fallback, status }, fallback.service ?? null);
}

function buildAvailabilityRange(request: BookingApplyRequest): { from?: string; to?: string } {
  const effectiveFrom = buildEffectiveFrom(request);

  if (request.preferredDateIso === null || request.preferredDateIso === undefined) {
    if (request.bookingAction !== 'propose_options' || effectiveFrom === undefined) {
      return {};
    }

    const from = new Date(effectiveFrom);
    const searchWindowDays = readClampedNumberMetadata(request.metadata, 'search_window_days', 14, 1, 30);
    const to = new Date(from.getTime() + searchWindowDays * 24 * 60 * 60_000);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  const from = new Date(`${request.preferredDateIso}T00:00:00.000Z`);
  const dateTo = new Date(from.getTime() + 24 * 60 * 60_000);

  return {
    from: effectiveFrom ?? from.toISOString(),
    to: dateTo.toISOString(),
  };
}

function buildEffectiveFrom(request: BookingApplyRequest): string | undefined {
  if (request.bookingAction !== 'propose_options') {
    return undefined;
  }

  const metadataNow = readValidIsoMetadata(request.metadata, 'current_time_iso') ?? new Date().toISOString();

  if (request.preferredDateIso === null || request.preferredDateIso === undefined) {
    return metadataNow;
  }

  const currentClinicDateIso = readStringMetadata(request.metadata, 'current_clinic_date_iso') ?? metadataNow.slice(0, 10);

  if (request.preferredDateIso === currentClinicDateIso) {
    return metadataNow;
  }

  return undefined;
}

function isSlotOnOrAfterEffectiveFrom(slot: ScheduleSlot, effectiveFrom: string | undefined): boolean {
  if (effectiveFrom === undefined) {
    return true;
  }

  const slotStartMs = Date.parse(slot.startAt);
  const effectiveFromMs = Date.parse(effectiveFrom);

  return Number.isFinite(slotStartMs) && Number.isFinite(effectiveFromMs) && slotStartMs >= effectiveFromMs;
}

function buildDedupeKey(request: BookingApplyRequest, slot: ScheduleSlot): string {
  const cellRange = readStringMetadata(slot.metadata, 'cell_range') ?? 'no_cell';
  return [
    'booking',
    request.clinicId,
    request.contactId,
    request.caseId ?? 'no_case',
    slot.startAt,
    cellRange,
  ].join(':');
}

function isSlotInRequestedTimeOfDay(slot: ScheduleSlot, timeOfDay: TimeOfDay): boolean {
  if (timeOfDay === 'any') {
    return true;
  }

  const hour = getSlotLocalHour(slot);

  if (timeOfDay === 'morning') {
    return hour >= 5 && hour < 12;
  }

  if (timeOfDay === 'afternoon') {
    return hour >= 12 && hour < 17;
  }

  return hour >= 17 && hour < 22;
}

function isSlotInRequestedTimeConstraints(slot: ScheduleSlot, request: BookingApplyRequest): boolean {
  const slotMinutes = getSlotLocalMinutes(slot);
  const exactMinutes = parseTimeToMinutes(request.exactTime ?? null);

  if (exactMinutes !== null) {
    return slotMinutes === exactMinutes;
  }

  const window = request.preferredTimeWindow;

  if (window === undefined) {
    return true;
  }

  const startMinutes = parseTimeToMinutes(window.startTime);
  const endMinutes = parseTimeToMinutes(window.endTime);

  if (startMinutes !== null && slotMinutes < startMinutes) {
    return false;
  }

  if (endMinutes !== null) {
    if (startMinutes === null) {
      return slotMinutes < endMinutes;
    }

    return slotMinutes <= endMinutes;
  }

  return true;
}

function getSlotLocalHour(slot: ScheduleSlot): number {
  return Math.floor(getSlotLocalMinutes(slot) / 60);
}

function getSlotLocalMinutes(slot: ScheduleSlot): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: slot.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(slot.startAt));
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;

  if (hour === undefined || minute === undefined) {
    const fallback = new Date(slot.startAt);
    return fallback.getUTCHours() * 60 + fallback.getUTCMinutes();
  }

  return Number(hour) * 60 + Number(minute);
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const match = /^(\d{1,2}):(\d{2})$/u.exec(value);

  if (match === null) {
    return null;
  }

  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '', 10);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function toBookingSlotPayload(slot: ScheduleSlot, serviceInterest: string | null): BookingSlotPayload {
  return {
    start_at: slot.startAt,
    end_at: slot.endAt,
    label: formatSlotLabel(slot),
    cell_range: readStringMetadata(slot.metadata, 'cell_range') ?? null,
    sheet_name: readStringMetadata(slot.metadata, 'sheet_name') ?? null,
    service_interest: serviceInterest,
  };
}

function toBookingAppointmentPayload(
  appointment: ExternalAppointmentRecord,
  serviceInterest: string | null,
): BookingAppointmentPayload {
  const slot = appointmentToScheduleSlot(appointment);

  return {
    appointment_id: appointment.id,
    case_id: appointment.caseId ?? null,
    ...toBookingSlotPayload(slot, serviceInterest),
    status: appointment.status,
  };
}

function appointmentToScheduleSlot(appointment: ExternalAppointmentRecord): ScheduleSlot {
  const storedSlot = readStoredSlot(appointment.meta);

  if (storedSlot !== undefined) {
    return storedSlot;
  }

  const providerMetadata = readProviderMetadata(appointment);
  return {
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    timezone: readStringMetadata(providerMetadata, 'timezone') ?? 'UTC',
    provider: appointment.externalProvider,
    metadata: providerMetadata,
  };
}

function readValidIsoMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = readStringMetadata(metadata, key);

  if (value === undefined) {
    return undefined;
  }

  const time = Date.parse(value);

  if (!Number.isFinite(time)) {
    return undefined;
  }

  return value;
}

function readSaneIntegerMetadata(metadata: Record<string, unknown>, key: string, fallback: number): number {
  const value = metadata[key];

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 10) {
    return fallback;
  }

  return value;
}

function readClampedNumberMetadata(
  metadata: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = metadata[key];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function readStoredSlot(meta: Record<string, unknown>): ScheduleSlot | undefined {
  const value = meta.slot;

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const slot = value as Record<string, unknown>;
  if (
    typeof slot.startAt !== 'string'
    || typeof slot.endAt !== 'string'
    || typeof slot.timezone !== 'string'
    || typeof slot.provider !== 'string'
    || slot.metadata === null
    || typeof slot.metadata !== 'object'
    || Array.isArray(slot.metadata)
  ) {
    return undefined;
  }

  return {
    startAt: slot.startAt,
    endAt: slot.endAt,
    timezone: slot.timezone,
    provider: slot.provider,
    metadata: slot.metadata as Record<string, unknown>,
  };
}

function readProviderMetadata(appointment: ExternalAppointmentRecord): Record<string, unknown> {
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

function formatSlotLabel(slot: ScheduleSlot): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: slot.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(slot.startAt));
}

function readStringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
