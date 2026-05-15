import { z } from 'zod';

import { runtimeAIOutputSchema } from './runtimeAiSchema.js';
export { runtimeAIOutputSchema } from './runtimeAiSchema.js';

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

export type RuntimeMeta = z.infer<typeof runtimeMetaSchema>;
export type RuntimeTurnInput = z.infer<typeof runtimeTurnInputSchema>;
export type RuntimeSideEffect = z.infer<typeof runtimeSideEffectSchema>;
export type RuntimeTurnResult = z.infer<typeof runtimeTurnResultSchema>;
export type RuntimeAIOutput = z.infer<typeof runtimeAIOutputSchema>;
export type AIOutput = RuntimeAIOutput;
