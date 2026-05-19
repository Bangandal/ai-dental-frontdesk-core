import { describe, expect, it } from 'vitest';

import { applyRuntimeToolPolicy } from './runtimeToolPolicy.js';
import { runtimeTurnPlannerOutputSchema } from './runtimeTurnPlannerSchema.js';

function planner(overrides: Record<string, unknown>) {
  return runtimeTurnPlannerOutputSchema.parse({
    turn_type: 'pure_faq',
    kb_needed: false,
    availability_needed: false,
    booking_write_requested: false,
    admin_notify_requested: false,
    tools_requested: [],
    kb_queries: [],
    booking_request: null,
    reply_strategy: 'reply',
    memory_updates: [],
    confidence: 0.7,
    reason: 'test',
    ...overrides,
  });
}

const baseContext = {
  active_hold_exists: false,
  proposed_slot_exists: false,
  availability_result_exists: false,
  booking_success_exists: false,
};

describe('applyRuntimeToolPolicy', () => {
  it('pure FAQ cannot request booking.confirm', () => {
    const decision = applyRuntimeToolPolicy(
      planner({ tools_requested: ['booking.confirm'] }),
      baseContext,
    );

    expect(decision.allowed_tools).toEqual([]);
    expect(decision.denied_tools[0]?.reason).toBe('sensitive_tool_not_allowed_for_turn_type');
  });

  it('confirmation without active_hold denies booking.confirm', () => {
    const decision = applyRuntimeToolPolicy(
      planner({ turn_type: 'confirmation', tools_requested: ['booking.confirm'] }),
      baseContext,
    );

    expect(decision.allowed_tools).toEqual([]);
    expect(decision.denied_tools[0]?.reason).toBe('booking_confirm_requires_active_hold');
  });

  it('confirmation with active_hold allows booking.confirm', () => {
    const decision = applyRuntimeToolPolicy(
      planner({ turn_type: 'confirmation', tools_requested: ['booking.confirm'] }),
      { ...baseContext, active_hold_exists: true },
    );

    expect(decision.allowed_tools).toEqual(['booking.confirm']);
  });

  it('hold.create denied without proposed slot or availability result', () => {
    const decision = applyRuntimeToolPolicy(
      planner({ turn_type: 'booking_request', tools_requested: ['hold.create'] }),
      baseContext,
    );

    expect(decision.allowed_tools).toEqual([]);
    expect(decision.denied_tools[0]?.reason).toBe('hold_create_requires_proposed_slot_or_availability');
  });

  it('admin.notify denied unless explicit admin_request or booking success', () => {
    const denied = applyRuntimeToolPolicy(
      planner({ turn_type: 'post_booking', tools_requested: ['admin.notify'] }),
      baseContext,
    );
    expect(denied.allowed_tools).toEqual([]);

    const allowedByAdmin = applyRuntimeToolPolicy(
      planner({ turn_type: 'admin_request', admin_notify_requested: true, tools_requested: ['admin.notify'] }),
      baseContext,
    );
    expect(allowedByAdmin.allowed_tools).toEqual(['admin.notify']);

    const allowedByBooking = applyRuntimeToolPolicy(
      planner({ turn_type: 'post_booking', tools_requested: ['admin.notify'] }),
      { ...baseContext, booking_success_exists: true },
    );
    expect(allowedByBooking.allowed_tools).toEqual(['admin.notify']);
  });

  it('fallback/unknown cannot use sensitive tools', () => {
    const fallbackDecision = applyRuntimeToolPolicy(
      planner({ turn_type: 'fallback', tools_requested: ['hold.create', 'booking.confirm', 'admin.notify'] }),
      { ...baseContext, active_hold_exists: true, proposed_slot_exists: true, booking_success_exists: true },
    );

    expect(fallbackDecision.allowed_tools).toEqual([]);

    const unknownDecision = applyRuntimeToolPolicy(
      planner({ turn_type: 'unknown', tools_requested: ['hold.create'] }),
      { ...baseContext, proposed_slot_exists: true },
    );

    expect(unknownDecision.allowed_tools).toEqual([]);
  });
});
