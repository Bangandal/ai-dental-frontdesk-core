export const runtimeTurnTypes = [
  'greeting',
  'pure_faq',
  'booking_request',
  'availability_request',
  'mixed_faq_booking',
  'slot_selection',
  'confirmation',
  'cancel_reschedule',
  'post_booking',
  'admin_request',
  'fallback',
  'unknown',
] as const;

export type RuntimeTurnType = (typeof runtimeTurnTypes)[number];

export const runtimePlannerToolNames = [
  'kb.search',
  'availability.check',
  'hold.create',
  'booking.confirm',
  'admin.notify',
] as const;

export type RuntimePlannerToolName = (typeof runtimePlannerToolNames)[number];
