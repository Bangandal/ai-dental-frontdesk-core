import { z } from 'zod';

import { runtimeAIOutputSchema, type RuntimeAIOutput } from './runtimeContracts.js';

export interface RuntimeAIExtractionInput {
  trace_id: string;
  prompt_version: string;
  system_prompt: string;
  context: Record<string, unknown>;
}

export interface RuntimeAIClient {
  readonly provider?: string;
  readonly model?: string;
  extract(input: RuntimeAIExtractionInput): Promise<RuntimeAIOutput>;
}

export const RUNTIME_AI_SAFE_FALLBACK_REPLY = 'Підкажіть, будь ласка, чим можемо допомогти — записом чи питанням по клініці?';

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
      availability_query: {
        search_type: 'unknown',
        date_iso: null,
        weekday: null,
        relative_day: null,
        time_window: null,
        exact_time: null,
        flexibility: 'unknown',
      },
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
      faq_topic: 'unknown',
      patient_scope: 'unknown',
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
      code: readErrorStringProperty(error, 'code') ?? 'ai_extraction_failed',
      message: error.message,
      name: error.name,
      provider: readErrorStringProperty(error, 'provider'),
      model: readErrorStringProperty(error, 'model'),
    };
  }

  return {
    code: 'ai_extraction_failed',
    message: 'Unknown AI extraction failure.',
  };
}

function readErrorStringProperty(error: Error, property: string): string | undefined {
  if (property in error) {
    const value = (error as Error & Record<string, unknown>)[property];

    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }

  return undefined;
}
