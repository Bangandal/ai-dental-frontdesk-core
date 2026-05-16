import { z } from 'zod';

export const runtimeConversationIntentValues = [
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
] as const;

export const runtimeRequestedActionValues = [
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
] as const;

export const runtimeTimeOfDayValues = ['morning', 'afternoon', 'evening', 'any'] as const;
export const runtimeConfidenceValues = ['high', 'medium', 'low'] as const;
export const runtimeFaqTopicValues = ['price', 'insurance', 'address', 'other', 'unknown'] as const;
export const runtimePatientScopeValues = ['self', 'another_person', 'multiple_people', 'unknown'] as const;

export const runtimeAIOutputSchema = z.object({
  reply_draft: z.string().nullable(),
  conversation_intent: z.enum(runtimeConversationIntentValues),
  requested_action: z.enum(runtimeRequestedActionValues),
  slot_updates: z.object({
    name: z.string().nullable(),
    service_interest: z.string().nullable(),
    problem: z.string().nullable(),
    phone: z.string().nullable(),
    preferred_time: z.string().nullable(),
    preferred_contact: z.string().nullable(),
  }),
  booking: z.object({
    preferred_date_iso: z.string().nullable(),
    preferred_weekday: z.string().nullable(),
    time_of_day: z.enum(runtimeTimeOfDayValues).nullable(),
    patient_confirmed_proposed_slot: z.boolean(),
    patient_rejected_proposed_slot: z.boolean(),
    selected_hold_id: z.string().nullable(),
  }),
  faq_topic: z.enum(runtimeFaqTopicValues),
  patient_scope: z.enum(runtimePatientScopeValues),
  handoff_recommended: z.boolean(),
  kb_used: z.boolean(),
  confidence: z.enum(runtimeConfidenceValues),
}).strict();

const nullableStringSchema = { type: ['string', 'null'] } as const;

export const runtimeAIOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'reply_draft',
    'conversation_intent',
    'requested_action',
    'slot_updates',
    'booking',
    'faq_topic',
    'patient_scope',
    'handoff_recommended',
    'kb_used',
    'confidence',
  ],
  properties: {
    reply_draft: nullableStringSchema,
    conversation_intent: { type: 'string', enum: runtimeConversationIntentValues },
    requested_action: { type: 'string', enum: runtimeRequestedActionValues },
    slot_updates: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'service_interest', 'problem', 'phone', 'preferred_time', 'preferred_contact'],
      properties: {
        name: nullableStringSchema,
        service_interest: nullableStringSchema,
        problem: nullableStringSchema,
        phone: nullableStringSchema,
        preferred_time: nullableStringSchema,
        preferred_contact: nullableStringSchema,
      },
    },
    booking: {
      type: 'object',
      additionalProperties: false,
      required: [
        'preferred_date_iso',
        'preferred_weekday',
        'time_of_day',
        'patient_confirmed_proposed_slot',
        'patient_rejected_proposed_slot',
        'selected_hold_id',
      ],
      properties: {
        preferred_date_iso: nullableStringSchema,
        preferred_weekday: nullableStringSchema,
        time_of_day: { anyOf: [{ type: 'string', enum: runtimeTimeOfDayValues }, { type: 'null' }] },
        patient_confirmed_proposed_slot: { type: 'boolean' },
        patient_rejected_proposed_slot: { type: 'boolean' },
        selected_hold_id: nullableStringSchema,
      },
    },
    faq_topic: { type: 'string', enum: runtimeFaqTopicValues },
    patient_scope: { type: 'string', enum: runtimePatientScopeValues },
    handoff_recommended: { type: 'boolean' },
    kb_used: { type: 'boolean' },
    confidence: { type: 'string', enum: runtimeConfidenceValues },
  },
} as const;
