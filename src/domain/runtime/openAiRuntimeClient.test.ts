import { describe, expect, it, vi } from 'vitest';

import {
  OpenAIRuntimeAIClient,
  RuntimeAIProviderError,
  type OpenAIResponsesClient,
} from './openAiRuntimeClient.js';
import type { RuntimeAIExtractionInput } from './runtimeAiClient.js';
import type { RuntimeAIOutput } from './runtimeContracts.js';

const extractionInput: RuntimeAIExtractionInput = {
  trace_id: 'trace-1',
  prompt_version: 'runtime-ai-extraction-v1',
  system_prompt: 'Extract runtime fields.',
  context: { user_text: 'на 16 число есть место?' },
};

describe('OpenAIRuntimeAIClient', () => {
  it('maps a mocked structured response into RuntimeAIOutput', async () => {
    const aiOutput = validAIOutput({
      reply_draft: 'Подскажите, утро или день удобнее?',
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      booking: { preferred_date_iso: '2026-05-16', time_of_day: 'any' },
    });
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(aiOutput) });
    const responsesClient: OpenAIResponsesClient = { create };
    const client = new OpenAIRuntimeAIClient({ model: 'gpt-test-runtime', responsesClient });

    await expect(client.extract(extractionInput)).resolves.toEqual(aiOutput);
    expect(responsesClient.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-test-runtime',
      instructions: extractionInput.system_prompt,
      text: {
        format: expect.objectContaining({
          type: 'json_schema',
          name: 'runtime_ai_output',
          strict: true,
        }),
      },
    }));
    expect(JSON.parse(create.mock.calls[0][0].input)).toMatchObject({
      trace_id: 'trace-1',
      prompt_version: 'runtime-ai-extraction-v1',
      context: { user_text: 'на 16 число есть место?' },
    });
  });

  it('throws a safe provider error when OpenAI fails', async () => {
    const providerFailure = new Error('429 rate limit from provider');
    Object.assign(providerFailure, { status: 429 });
    const responsesClient: OpenAIResponsesClient = {
      create: vi.fn().mockRejectedValue(providerFailure),
    };
    const client = new OpenAIRuntimeAIClient({ model: 'gpt-test-runtime', responsesClient });

    await expect(client.extract(extractionInput)).rejects.toMatchObject({
      name: 'RuntimeAIProviderError',
      code: 'openai_http_429',
      provider: 'openai',
      model: 'gpt-test-runtime',
      message: '429 rate limit from provider',
    });
  });

  it('throws a safe provider error when structured output is not valid RuntimeAIOutput', async () => {
    const responsesClient: OpenAIResponsesClient = {
      create: vi.fn().mockResolvedValue({ output_text: JSON.stringify({ reply_draft: 'incomplete' }) }),
    };
    const client = new OpenAIRuntimeAIClient({ model: 'gpt-test-runtime', responsesClient });

    const result = client.extract(extractionInput);

    await expect(result).rejects.toBeInstanceOf(RuntimeAIProviderError);
    await expect(result).rejects.toMatchObject({
      code: 'invalid_ai_output',
      provider: 'openai',
      model: 'gpt-test-runtime',
    });
  });
});

function validAIOutput(overrides: Partial<RuntimeAIOutput> = {}): RuntimeAIOutput {
  const base: RuntimeAIOutput = {
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
    confidence: 'medium',
  };

  return {
    ...base,
    ...overrides,
    slot_updates: {
      ...base.slot_updates,
      ...overrides.slot_updates,
    },
    booking: {
      ...base.booking,
      ...overrides.booking,
    },
  };
}
