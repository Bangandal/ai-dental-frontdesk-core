import { z } from 'zod';

export const runtimeFaqTopicSchema = z.enum([
  'price',
  'address',
  'insurance',
  'services',
  'contacts',
  'hours',
  'other',
  'unknown',
]);

export const runtimeFaqAnswerModeSchema = z.enum(['kb_answer', 'clarification', 'safe_fallback', 'smalltalk']);

export const runtimeFaqAgentOutputSchema = z.object({
  route: z.literal('faq'),
  reply_text: z.string().min(1),
  faq_topic: runtimeFaqTopicSchema,
  answer_mode: runtimeFaqAnswerModeSchema,
  used_kb: z.boolean(),
  used_chunk_ids: z.array(z.string().min(1)),
  needs_clarification: z.boolean(),
  booking_intent: z.boolean(),
  booking_intent_level: z.enum(['none', 'soft', 'explicit']),
  should_ask_booking: z.boolean(),
  memory_updates: z.object({
    last_faq_topic: z.string().nullable().optional(),
    service_interest: z.string().nullable().optional(),
    last_user_goal: z.string().nullable().optional(),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.used_kb && value.used_chunk_ids.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'used_chunk_ids must be non-empty when used_kb=true',
      path: ['used_chunk_ids'],
    });
  }
});

export type RuntimeFaqAgentOutput = z.infer<typeof runtimeFaqAgentOutputSchema>;
