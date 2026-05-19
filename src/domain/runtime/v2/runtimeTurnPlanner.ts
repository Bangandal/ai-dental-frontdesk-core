import { runtimeTurnPlannerPrompt } from './runtimeTurnPlannerPrompt.js';
import { runtimeTurnPlannerOutputSchema, type RuntimeTurnPlannerOutput } from './runtimeTurnPlannerSchema.js';

export interface RuntimeTurnPlannerInput {
  raw_output: unknown;
}

export interface RuntimeTurnPlannerResult {
  prompt: string;
  planner_output: RuntimeTurnPlannerOutput;
}

export function parseRuntimeTurnPlannerOutput(input: RuntimeTurnPlannerInput): RuntimeTurnPlannerResult {
  return {
    prompt: runtimeTurnPlannerPrompt,
    planner_output: runtimeTurnPlannerOutputSchema.parse(input.raw_output),
  };
}
