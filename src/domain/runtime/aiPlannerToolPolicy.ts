export const AI_PLANNER_TOOL_POLICY = {
  allow_tool_calls: false,
  reason: 'Planner phase is policy-only. Backend executes runtime decisions and booking actions.',
} as const;
