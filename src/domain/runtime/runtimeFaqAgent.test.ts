import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RuntimeFaqAgent, type RuntimeFaqAgentModelClient } from './runtimeFaqAgent.js';
import { buildRuntimeFaqAgentPrompt } from './runtimeFaqAgentPrompt.js';
import { runtimeFaqAgentOutputSchema } from './runtimeFaqAgentSchema.js';

class FakeFaqModelClient implements RuntimeFaqAgentModelClient {
  constructor(private readonly response: unknown) {}

  calls: Array<{ trace_id: string; prompt: string; context: Record<string, unknown> }> = [];

  async generateStructuredFaq(input: { trace_id: string; prompt: string; context: Record<string, unknown> }): Promise<unknown> {
    this.calls.push(input);
    return this.response;
  }
}

const validOutput = {
  route: 'faq',
  reply_text: 'Чистка зубов стоит от 1200 Kč.',
  faq_topic: 'price',
  answer_mode: 'kb_answer',
  used_kb: true,
  used_chunk_ids: ['faq:1'],
  needs_clarification: false,
  booking_intent: false,
  booking_intent_level: 'none',
  should_ask_booking: false,
  memory_updates: {
    last_faq_topic: 'price',
    service_interest: 'cleaning',
    last_user_goal: 'price',
  },
  confidence: 'high',
  reason: 'grounded_in_kb',
} as const;

describe('runtimeFaqAgentSchema', () => {
  it('accepts valid output', () => {
    const parsed = runtimeFaqAgentOutputSchema.parse(validOutput);
    expect(parsed.reply_text).toContain('1200');
  });

  it('rejects used_kb=true with empty used_chunk_ids', () => {
    expect(() => runtimeFaqAgentOutputSchema.parse({ ...validOutput, used_chunk_ids: [] })).toThrow(z.ZodError);
  });
});

describe('runtimeFaqAgentPrompt', () => {
  it('contains FAQ-only and no-booking constraints', () => {
    const prompt = buildRuntimeFaqAgentPrompt({ clinicName: 'AI Dental' });
    expect(prompt).toContain('Mode: FAQ/KB only.');
    expect(prompt).toContain('Do not book');
  });
});

describe('RuntimeFaqAgent', () => {
  it('passes compact context and validates structured output', async () => {
    const client = new FakeFaqModelClient(validOutput);
    const agent = new RuntimeFaqAgent(client);

    const result = await agent.run({
      trace_id: 'trace-1',
      clinic_name: 'AI Dental',
      current_user_message: 'Сколько стоит чистка?',
      recent_history: [
        { role: 'user', text: 'привет' },
        { role: 'assistant', text: 'Здравствуйте!' },
      ],
      faq_memory: {
        last_faq_topic: 'services',
        last_service_interest: null,
        last_user_goal: 'узнать услуги',
        updated_at: '2026-05-19T00:00:00.000Z',
      },
      kb_chunks: [
        { chunk_id: 'faq:1', title: 'Cleaning', content: 'Чистка зубов стоит от 1200 Kč.', score: 0.9 },
      ],
    });

    expect(result).toMatchObject(validOutput);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.context.recent_history).toHaveLength(2);
  });
});
