import { z } from 'zod';

import { runtimeAIOutputSchema, type RuntimeAIOutput } from './runtimeContracts.js';

export interface RuntimeAIExtractionInput {
  trace_id: string;
  prompt_version: string;
  system_prompt: string;
  context: Record<string, unknown>;
}

export interface RuntimeAIClient {
  extract(input: RuntimeAIExtractionInput): Promise<RuntimeAIOutput>;
}

export const RUNTIME_AI_SAFE_FALLBACK_REPLY = 'Извините, не совсем поняла запрос. Уточните, пожалуйста, чем можем помочь?';

export class NoopRuntimeAIClient implements RuntimeAIClient {
  async extract(): Promise<RuntimeAIOutput> {
    return {
      reply_draft: null,
      conversation_intent: 'unknown',
      requested_action: 'clarify',
      slot_updates: {
        name: null,
        service_interest: null,
        problem: null,
        phone: null,
        preferred_time: null,
        preferred_contact: null,
      },
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
      handoff_recommended: false,
      kb_used: false,
      confidence: 'low',
    };
  }
}

export function parseRuntimeAIOutput(output: unknown): RuntimeAIOutput {
  return runtimeAIOutputSchema.parse(output);
}

export function formatRuntimeAIError(error: unknown): Record<string, unknown> {
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid_ai_output',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'ai_extraction_failed',
      message: error.message,
      name: error.name,
    };
  }

  return {
    code: 'ai_extraction_failed',
    message: 'Unknown AI extraction failure.',
  };
}
