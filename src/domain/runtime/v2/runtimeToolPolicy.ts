import type { RuntimePlannerToolName } from './runtimeV2Contracts.js';
import type { RuntimeTurnPlannerOutput } from './runtimeTurnPlannerSchema.js';

export interface RuntimeToolPolicyContext {
  active_hold_exists: boolean;
  proposed_slot_exists: boolean;
  availability_result_exists: boolean;
  booking_success_exists: boolean;
}

export interface RuntimeToolPolicyDecision {
  allowed_tools: RuntimePlannerToolName[];
  denied_tools: Array<{ tool: RuntimePlannerToolName; reason: string }>;
}

const sensitiveTools: RuntimePlannerToolName[] = ['hold.create', 'booking.confirm', 'admin.notify'];

export function applyRuntimeToolPolicy(
  planner: RuntimeTurnPlannerOutput,
  context: RuntimeToolPolicyContext,
): RuntimeToolPolicyDecision {
  const allowed: RuntimePlannerToolName[] = [];
  const denied: Array<{ tool: RuntimePlannerToolName; reason: string }> = [];

  for (const tool of planner.tools_requested) {
    const decision = decideTool(tool, planner, context);

    if (decision.allowed) {
      allowed.push(tool);
    } else {
      denied.push({ tool, reason: decision.reason });
    }
  }

  return { allowed_tools: allowed, denied_tools: denied };
}

function decideTool(tool: RuntimePlannerToolName, planner: RuntimeTurnPlannerOutput, context: RuntimeToolPolicyContext) {
  if (isNonBookingTurn(planner.turn_type) && sensitiveTools.includes(tool)) {
    return { allowed: false, reason: 'sensitive_tool_not_allowed_for_turn_type' };
  }

  if (tool === 'kb.search') {
    const canUse = planner.kb_needed && ['pure_faq', 'greeting', 'mixed_faq_booking'].includes(planner.turn_type);
    return canUse ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'kb_search_not_allowed' };
  }

  if (tool === 'availability.check') {
    const canUse = planner.availability_needed && ['availability_request', 'mixed_faq_booking'].includes(planner.turn_type);
    return canUse ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'availability_check_not_allowed' };
  }

  if (tool === 'booking.confirm') {
    if (planner.turn_type !== 'confirmation') {
      return { allowed: false, reason: 'booking_confirm_requires_confirmation_turn' };
    }

    return context.active_hold_exists
      ? { allowed: true, reason: 'ok' }
      : { allowed: false, reason: 'booking_confirm_requires_active_hold' };
  }

  if (tool === 'hold.create') {
    return (context.proposed_slot_exists || context.availability_result_exists)
      ? { allowed: true, reason: 'ok' }
      : { allowed: false, reason: 'hold_create_requires_proposed_slot_or_availability' };
  }

  if (tool === 'admin.notify') {
    const explicitAdminRequest = planner.turn_type === 'admin_request' && planner.admin_notify_requested;
    return (explicitAdminRequest || context.booking_success_exists)
      ? { allowed: true, reason: 'ok' }
      : { allowed: false, reason: 'admin_notify_requires_admin_request_or_booking_success' };
  }

  return { allowed: false, reason: 'tool_not_supported' };
}

function isNonBookingTurn(turnType: RuntimeTurnPlannerOutput['turn_type']): boolean {
  return ['pure_faq', 'greeting', 'fallback', 'unknown'].includes(turnType);
}
