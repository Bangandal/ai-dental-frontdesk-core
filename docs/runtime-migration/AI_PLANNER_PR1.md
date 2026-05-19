# PR1: AI Planner Contracts + Schema + Prompt + Tool Policy

This change introduces isolated planner artifacts without changing runtime execution behavior.

## Added

- `src/domain/runtime/aiPlannerContracts.ts`
  - Canonical planner enums and output schema.
- `src/domain/runtime/aiPlannerPrompt.ts`
  - System prompt text for planner-only generation.
- `src/domain/runtime/aiPlannerToolPolicy.ts`
  - Explicit policy disabling tool calls at planner stage.
- `src/domain/runtime/aiPlannerContracts.test.ts`
  - Schema validation tests.

## Non-goals (unchanged)

- `runtimeTurnService` behavior
- `/runtime/turn` endpoint behavior
- Booking flow and booking routes
- Existing runtime tests
