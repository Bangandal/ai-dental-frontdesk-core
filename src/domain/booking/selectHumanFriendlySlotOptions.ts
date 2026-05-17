import type { ScheduleSlot } from '../../adapters/schedule/ScheduleAdapter.js';

export type PatientFacingSlotProposalStrategy = 'nearest' | 'spread';

export interface SelectHumanFriendlySlotOptionsInput {
  maxOptions?: number;
  proposalStepMinutes?: number;
  fallbackProposalStepMinutes?: number;
  strategy?: PatientFacingSlotProposalStrategy;
}

const defaultMaxOptions = 3;
const defaultProposalStepMinutes = 60;
const fallbackTimeZone = 'UTC';

export function selectHumanFriendlySlotOptions(
  candidateSlots: ScheduleSlot[],
  options: SelectHumanFriendlySlotOptionsInput = {},
): ScheduleSlot[] {
  const maxOptions = sanitizePositiveInteger(options.maxOptions, defaultMaxOptions);
  const proposalStepMinutes = sanitizePositiveInteger(options.proposalStepMinutes, defaultProposalStepMinutes);
  const sortedSlots = sortSlots(candidateSlots);

  if (options.strategy === 'nearest') {
    return selectNearestSlots(sortedSlots, maxOptions, proposalStepMinutes, options.fallbackProposalStepMinutes);
  }

  return selectSpreadSlots(sortedSlots, maxOptions, proposalStepMinutes, options.fallbackProposalStepMinutes);
}

function selectSpreadSlots(
  sortedSlots: ScheduleSlot[],
  maxOptions: number,
  proposalStepMinutes: number,
  fallbackProposalStepMinutes: number | undefined,
): ScheduleSlot[] {
  const daySlots = selectEarliestLocalDateSlots(sortedSlots);

  if (daySlots.length <= maxOptions) {
    return selectNearestSlots(daySlots, maxOptions, proposalStepMinutes, fallbackProposalStepMinutes);
  }

  const selectedSlots: ScheduleSlot[] = [];
  const targetIndexes = buildSpreadTargetIndexes(daySlots.length, maxOptions);

  for (const targetIndex of targetIndexes) {
    const selectedSlot = selectNearestUnusedSlot(daySlots, targetIndex, selectedSlots);

    if (selectedSlot !== undefined) {
      selectedSlots.push(selectedSlot);
    }
  }

  return sortSlots(selectedSlots).slice(0, maxOptions);
}

function selectNearestSlots(
  sortedSlots: ScheduleSlot[],
  maxOptions: number,
  proposalStepMinutes: number,
  fallbackProposalStepMinutes: number | undefined,
): ScheduleSlot[] {
  const selectedSlots = selectWithStep(sortedSlots, maxOptions, proposalStepMinutes);

  if (
    selectedSlots.length < 2
    && sortedSlots.length > selectedSlots.length
    && fallbackProposalStepMinutes !== undefined
  ) {
    return selectWithStep(
      sortedSlots,
      maxOptions,
      sanitizePositiveInteger(fallbackProposalStepMinutes, proposalStepMinutes),
    );
  }

  return selectedSlots;
}

function selectEarliestLocalDateSlots(sortedSlots: ScheduleSlot[]): ScheduleSlot[] {
  const firstSlot = sortedSlots[0];

  if (firstSlot === undefined) {
    return [];
  }

  const earliestLocalDate = getSlotLocalDate(firstSlot);

  return sortedSlots.filter((slot) => getSlotLocalDate(slot) === earliestLocalDate);
}

function buildSpreadTargetIndexes(slotCount: number, maxOptions: number): number[] {
  if (maxOptions <= 1) {
    return [0];
  }

  const optionCount = Math.min(maxOptions, slotCount);
  const lastIndex = slotCount - 1;

  return Array.from({ length: optionCount }, (_value, index) => Math.round((index * lastIndex) / (optionCount - 1)));
}

function selectNearestUnusedSlot(
  slots: ScheduleSlot[],
  targetIndex: number,
  selectedSlots: ScheduleSlot[],
): ScheduleSlot | undefined {
  const usedStartTimes = new Set(selectedSlots.map((slot) => slot.startAt));

  if (usedStartTimes.has(slots[targetIndex]?.startAt ?? '')) {
    return slots.find((slot) => !usedStartTimes.has(slot.startAt));
  }

  return slots[targetIndex];
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

function sortSlots(slots: ScheduleSlot[]): ScheduleSlot[] {
  return [...slots].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
}

function getSlotLocalDate(slot: ScheduleSlot): string {
  const timeZone = typeof slot.timezone === 'string' && slot.timezone.length > 0 ? slot.timezone : fallbackTimeZone;

  try {
    return formatLocalDate(slot.startAt, timeZone);
  } catch {
    return formatLocalDate(slot.startAt, fallbackTimeZone);
  }
}

function formatLocalDate(startAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(startAt));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (year === undefined || month === undefined || day === undefined) {
    return startAt.slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}
