import type { ScheduleSlot } from '../../adapters/schedule/ScheduleAdapter.js';

export interface SelectHumanFriendlySlotOptionsInput {
  maxOptions?: number;
  proposalStepMinutes?: number;
  fallbackProposalStepMinutes?: number;
}

const defaultMaxOptions = 3;
const defaultProposalStepMinutes = 60;

export function selectHumanFriendlySlotOptions(
  candidateSlots: ScheduleSlot[],
  options: SelectHumanFriendlySlotOptionsInput = {},
): ScheduleSlot[] {
  const maxOptions = sanitizePositiveInteger(options.maxOptions, defaultMaxOptions);
  const proposalStepMinutes = sanitizePositiveInteger(options.proposalStepMinutes, defaultProposalStepMinutes);
  const sortedSlots = [...candidateSlots].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  const selectedSlots = selectWithStep(sortedSlots, maxOptions, proposalStepMinutes);

  if (
    selectedSlots.length < 2
    && sortedSlots.length > selectedSlots.length
    && options.fallbackProposalStepMinutes !== undefined
  ) {
    return selectWithStep(
      sortedSlots,
      maxOptions,
      sanitizePositiveInteger(options.fallbackProposalStepMinutes, proposalStepMinutes),
    );
  }

  return selectedSlots;
}

function selectWithStep(slots: ScheduleSlot[], maxOptions: number, stepMinutes: number): ScheduleSlot[] {
  const selectedSlots: ScheduleSlot[] = [];
  let nextAllowedStartMs: number | null = null;
  const stepMs = stepMinutes * 60_000;

  for (const slot of slots) {
    if (selectedSlots.length >= maxOptions) {
      break;
    }

    const startMs = Date.parse(slot.startAt);

    if (!Number.isFinite(startMs)) {
      continue;
    }

    if (nextAllowedStartMs === null || startMs >= nextAllowedStartMs) {
      selectedSlots.push(slot);
      nextAllowedStartMs = startMs + stepMs;
    }
  }

  return selectedSlots;
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}
