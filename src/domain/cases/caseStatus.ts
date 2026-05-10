export const CaseStatus = {
  Open: 'open',
  AppointmentBookedPendingAdminConfirmation: 'appointment_booked_pending_admin_confirmation',
  HandedOff: 'handed_off',
  Closed: 'closed',
} as const;

export type CaseStatus = typeof CaseStatus[keyof typeof CaseStatus];
