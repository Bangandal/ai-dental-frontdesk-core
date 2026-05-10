export interface ScheduleSlot {
  startAt: string;
  endAt: string;
  timezone: string;
  provider: string;
  metadata: {
    cell_range?: string;
    [key: string]: unknown;
  };
}

export interface CheckAvailabilityRequest {
  clinicId?: string;
  from?: string;
  to?: string;
  durationMinutes?: number;
  service?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface CheckAvailabilityResponse {
  slots: ScheduleSlot[];
}

export interface HoldSlotRequest {
  slot: ScheduleSlot;
  contactId?: string;
  caseId?: string;
  leadId?: string;
  patientName?: string;
  service?: string;
}

export interface HoldSlotResponse {
  ok: boolean;
  holdId?: string;
  expiresAt?: string;
  reason?: string;
}

export interface ConfirmAppointmentRequest {
  holdId?: string;
  slot: ScheduleSlot;
  contactId?: string;
  caseId?: string;
  leadId?: string;
  patientName?: string;
  service?: string;
}

export interface ConfirmAppointmentResponse {
  ok: boolean;
  appointmentId?: string;
  reason?: string;
}

export interface CancelHoldRequest {
  holdId: string;
  reason?: string;
}

export interface ScheduleAdapter {
  getAvailableSlots(request: CheckAvailabilityRequest): Promise<CheckAvailabilityResponse>;
  holdSlot(request: HoldSlotRequest): Promise<HoldSlotResponse>;
  confirmAppointment(request: ConfirmAppointmentRequest): Promise<ConfirmAppointmentResponse>;
  cancelHold(request: CancelHoldRequest): Promise<{ ok: boolean; reason?: string }>;
}
