import { z } from 'zod';

export const plannerIntentSchema = z.enum([
  'greeting',
  'faq',
  'booking',
  'availability_request',
  'patient_confirmation',
  'slot_rejected',
  'objection',
  'urgent',
  'correction',
  'off_topic',
  'post_handoff_ack',
  'follow_up',
  'multi_patient_request',
  'reschedule',
  'cancel_appointment',
  'unknown',
]);

export const plannerActionSchema = z.enum([
  'continue',
  'ask_slot',
  'answer_faq',
  'handoff',
  'complete_intake',
  'clarify',
  'greeting',
  'stop',
  'check_availability',
  'propose_slot',
  'await_confirmation',
  'confirm_slot',
  'reject_slot',
  'create_appointment',
]);

export const plannerSlotsSchema = z.object({
  name: z.string().nullable().optional(),
  service_interest: z.string().nullable().optional(),
  problem: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  preferred_time: z.string().nullable().optional(),
  preferred_contact: z.string().nullable().optional(),
}).default({});

export const plannerBookingHintsSchema = z.object({
  preferred_date_iso: z.string().nullable().optional(),
  preferred_weekday: z.string().nullable().optional(),
  time_of_day: z.enum(['morning', 'afternoon', 'evening', 'any']).nullable().optional(),
  patient_confirmed_proposed_slot: z.boolean().default(false),
  patient_rejected_proposed_slot: z.boolean().default(false),
  selected_hold_id: z.string().nullable().optional(),
}).default({});

export const plannerOutputSchema = z.object({
  reply_text: z.string().min(1),
  requested_action: plannerActionSchema,
  conversation_intent: plannerIntentSchema,
  slot_updates: plannerSlotsSchema,
  booking: plannerBookingHintsSchema,
  booking_result: z.record(z.unknown()).nullable().default(null),
  handoff_recommended: z.boolean().default(false),
  kb_used: z.boolean().default(false),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type PlannerIntent = z.infer<typeof plannerIntentSchema>;
export type PlannerAction = z.infer<typeof plannerActionSchema>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
