import { z } from 'zod';

export const runtimeMetaSchema = z.object({
  message_id: z.union([z.string(), z.number()]).optional(),
  update_id: z.union([z.string(), z.number()]).optional(),
  username: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  language_code: z.string().nullable().optional(),
});

export const runtimeTurnInputSchema = z.object({
  clinic_code: z.string().min(1),
  channel: z.literal('telegram'),
  external_user_id: z.string().min(1),
  chat_id: z.string().min(1),
  text: z.string().min(1),
  meta: runtimeMetaSchema.optional(),
});

export const runtimeSideEffectSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
}).passthrough();

export const runtimeTurnResultSchema = z.object({
  trace_id: z.string().uuid(),
  reply_text: z.string(),
  clinic_id: z.string().nullable(),
  contact_id: z.string().nullable(),
  case_id: z.string().nullable(),
  booking_result: z.record(z.unknown()).nullable(),
  side_effects: z.array(runtimeSideEffectSchema),
  debug: z.record(z.unknown()).optional(),
});

export const runtimeAIOutputSchema = z.object({
  reply_text: z.string(),
  slot_updates: z.object({
    name: z.string().nullable().optional(),
    service_interest: z.string().nullable().optional(),
    problem: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    preferred_time: z.string().nullable().optional(),
    preferred_contact: z.string().nullable().optional(),
  }).default({}),
  requested_action: z.enum([
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
  ]),
  conversation_intent: z.enum([
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
  ]),
  booking: z.object({
    preferred_date_iso: z.string().nullable().optional(),
    preferred_weekday: z.string().nullable().optional(),
    time_of_day: z.enum(['morning', 'afternoon', 'evening', 'any']).nullable().optional(),
    patient_confirmed_proposed_slot: z.boolean().default(false),
    patient_rejected_proposed_slot: z.boolean().default(false),
    selected_hold_id: z.string().nullable().optional(),
  }).default({}),
  booking_result: z.record(z.unknown()).nullable().default(null),
  handoff_recommended: z.boolean().default(false),
  kb_used: z.boolean().default(false),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type RuntimeMeta = z.infer<typeof runtimeMetaSchema>;
export type RuntimeTurnInput = z.infer<typeof runtimeTurnInputSchema>;
export type RuntimeSideEffect = z.infer<typeof runtimeSideEffectSchema>;
export type RuntimeTurnResult = z.infer<typeof runtimeTurnResultSchema>;
export type RuntimeAIOutput = z.infer<typeof runtimeAIOutputSchema>;
export type AIOutput = RuntimeAIOutput;
