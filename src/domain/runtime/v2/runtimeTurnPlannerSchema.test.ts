import { describe, expect, it } from 'vitest';

import { runtimeTurnPlannerOutputSchema } from './runtimeTurnPlannerSchema.js';

describe('runtimeTurnPlannerOutputSchema', () => {
  it('allows pure FAQ requesting kb.search', () => {
    const parsed = runtimeTurnPlannerOutputSchema.parse({
      turn_type: 'pure_faq',
      kb_needed: true,
      availability_needed: false,
      booking_write_requested: false,
      admin_notify_requested: false,
      tools_requested: ['kb.search'],
      kb_queries: ['what is composite filling?', 'caries treatment options'],
      booking_request: null,
      reply_strategy: 'answer_from_kb',
      memory_updates: [],
      confidence: 0.91,
      reason: 'faq_request',
    });

    expect(parsed.tools_requested).toEqual(['kb.search']);
    expect(parsed.kb_queries).toContain('caries treatment options');
  });

  it('accepts semantic kb queries without backend hardcoded aliases', () => {
    const parsed = runtimeTurnPlannerOutputSchema.parse({
      turn_type: 'pure_faq',
      kb_needed: true,
      availability_needed: false,
      booking_write_requested: false,
      admin_notify_requested: false,
      tools_requested: ['kb.search'],
      kb_queries: ['tooth decay filling', 'dental caries restoration'],
      booking_request: null,
      reply_strategy: 'answer_from_kb',
      memory_updates: [],
      confidence: 0.84,
      reason: 'semantic_variants_for_faq',
    });

    expect(parsed.kb_queries).toEqual(['tooth decay filling', 'dental caries restoration']);
  });

  it('allows mixed FAQ + availability tool requests', () => {
    const parsed = runtimeTurnPlannerOutputSchema.parse({
      turn_type: 'mixed_faq_booking',
      kb_needed: true,
      availability_needed: true,
      booking_write_requested: false,
      admin_notify_requested: false,
      tools_requested: ['kb.search', 'availability.check'],
      kb_queries: ['implant pain aftercare'],
      booking_request: {
        service: 'implant consult',
        service_aliases: ['implant', 'implantology consult'],
      },
      reply_strategy: 'answer_then_offer_slots',
      memory_updates: [],
      confidence: 0.8,
      reason: 'faq_and_availability',
    });

    expect(parsed.tools_requested).toEqual(['kb.search', 'availability.check']);
  });
});
