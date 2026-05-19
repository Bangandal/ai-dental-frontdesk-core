import { describe, expect, it } from 'vitest';

import { plannerOutputSchema } from './aiPlannerContracts.js';

describe('plannerOutputSchema', () => {
  it('accepts minimal valid planner output', () => {
    const parsed = plannerOutputSchema.parse({
      reply_text: 'Есть свободные окна, уточните удобное время.',
      requested_action: 'check_availability',
      conversation_intent: 'availability_request',
      confidence: 'medium',
    });

    expect(parsed.slot_updates).toEqual({});
    expect(parsed.booking.patient_confirmed_proposed_slot).toBe(false);
    expect(parsed.booking_result).toBeNull();
    expect(parsed.kb_used).toBe(false);
  });

  it('rejects empty reply_text', () => {
    expect(() =>
      plannerOutputSchema.parse({
        reply_text: '',
        requested_action: 'continue',
        conversation_intent: 'unknown',
        confidence: 'low',
      }),
    ).toThrow();
  });
});
