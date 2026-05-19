import { z } from 'zod';

import { runtimePlannerToolNames, runtimeTurnTypes } from './runtimeV2Contracts.js';

const bookingRequestSchema = z.object({
  service: z.string().min(1).optional(),
  service_aliases: z.array(z.string().min(1)).default([]),
  preferred_date_iso: z.string().min(1).optional(),
  preferred_time_text: z.string().min(1).optional(),
  patient_name: z.string().min(1).optional(),
}).strict();

const memoryUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
}).strict();

export const runtimeTurnPlannerOutputSchema = z.object({
  turn_type: z.enum(runtimeTurnTypes),
  kb_needed: z.boolean(),
  availability_needed: z.boolean(),
  booking_write_requested: z.boolean(),
  admin_notify_requested: z.boolean(),
  tools_requested: z.array(z.enum(runtimePlannerToolNames)).default([]),
  kb_queries: z.array(z.string().min(1)).default([]),
  booking_request: bookingRequestSchema.nullable(),
  reply_strategy: z.string().min(1),
  memory_updates: z.array(memoryUpdateSchema).default([]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
}).strict();

export type RuntimeTurnPlannerOutput = z.infer<typeof runtimeTurnPlannerOutputSchema>;
