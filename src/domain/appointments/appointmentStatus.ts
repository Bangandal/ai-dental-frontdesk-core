export const AppointmentStatus = {
  Proposed: 'proposed',
  Held: 'held',
  BookedPendingAdminConfirmation: 'booked_pending_admin_confirmation',
  FailedExternalWrite: 'failed_external_write',
  Canceled: 'canceled',
  Expired: 'expired',
  AdminConfirmed: 'admin_confirmed',
} as const;

export type AppointmentStatus = typeof AppointmentStatus[keyof typeof AppointmentStatus];
