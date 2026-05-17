import { describe, expect, it } from 'vitest';

import type { ScheduleSlot } from '../../adapters/schedule/ScheduleAdapter.js';
import { selectHumanFriendlySlotOptions } from './selectHumanFriendlySlotOptions.js';

function slot(startAt: string, timezone = 'UTC'): ScheduleSlot {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + 30 * 60_000);

  return {
    startAt,
    endAt: end.toISOString(),
    timezone,
    provider: 'google_sheets',
    metadata: { cell_range: startAt },
  };
}

function slotsEveryMinutes(dateIso: string, startHour: number, endHour: number, stepMinutes: number): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  const start = Date.UTC(Number(dateIso.slice(0, 4)), Number(dateIso.slice(5, 7)) - 1, Number(dateIso.slice(8, 10)), startHour, 0, 0, 0);
  const end = Date.UTC(Number(dateIso.slice(0, 4)), Number(dateIso.slice(5, 7)) - 1, Number(dateIso.slice(8, 10)), endHour, 0, 0, 0);

  for (let time = start; time <= end; time += stepMinutes * 60_000) {
    slots.push(slot(new Date(time).toISOString()));
  }

  return slots;
}

describe('selectHumanFriendlySlotOptions', () => {
  it('spread strategy selects representative options across a full working day instead of first spaced slots', () => {
    const result = selectHumanFriendlySlotOptions(
      slotsEveryMinutes('2026-05-20', 7, 18, 15),
      { maxOptions: 3, proposalStepMinutes: 60, strategy: 'spread' },
    );

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T12:30:00.000Z',
      '2026-05-20T18:00:00.000Z',
    ]);
    expect(result.map((candidate) => candidate.startAt)).not.toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T08:00:00.000Z',
      '2026-05-20T09:00:00.000Z',
    ]);
  });

  it('full-day spread result includes early, middle, and later options', () => {
    const result = selectHumanFriendlySlotOptions(
      slotsEveryMinutes('2026-05-20', 7, 18, 15),
      { maxOptions: 3, proposalStepMinutes: 60, strategy: 'spread' },
    );
    const hours = result.map((candidate) => new Date(candidate.startAt).getUTCHours() + new Date(candidate.startAt).getUTCMinutes() / 60);

    expect(hours[0]).toBeLessThanOrEqual(8);
    expect(hours[1]).toBeGreaterThanOrEqual(11);
    expect(hours[1]).toBeLessThanOrEqual(14);
    expect(hours[2]).toBeGreaterThanOrEqual(17);
  });

  it('nearest strategy still returns earliest spaced options', () => {
    const result = selectHumanFriendlySlotOptions(
      slotsEveryMinutes('2026-05-20', 7, 18, 15),
      { maxOptions: 3, proposalStepMinutes: 60, strategy: 'nearest' },
    );

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T08:00:00.000Z',
      '2026-05-20T09:00:00.000Z',
    ]);
  });

  it('small time-window candidates before 10:00 can return 07:00, 08:00, and 09:00', () => {
    const result = selectHumanFriendlySlotOptions([
      slot('2026-05-20T07:00:00.000Z'),
      slot('2026-05-20T08:00:00.000Z'),
      slot('2026-05-20T09:00:00.000Z'),
    ], { maxOptions: 3, proposalStepMinutes: 60, strategy: 'spread' });

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T08:00:00.000Z',
      '2026-05-20T09:00:00.000Z',
    ]);
  });

  it('can select 10:30 as the first option', () => {
    const result = selectHumanFriendlySlotOptions([
      slot('2026-05-20T10:30:00.000Z'),
      slot('2026-05-20T10:45:00.000Z'),
      slot('2026-05-20T11:00:00.000Z'),
      slot('2026-05-20T11:30:00.000Z'),
      slot('2026-05-20T12:30:00.000Z'),
    ], { maxOptions: 3, proposalStepMinutes: 60, strategy: 'nearest' });

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T10:30:00.000Z',
      '2026-05-20T11:30:00.000Z',
      '2026-05-20T12:30:00.000Z',
    ]);
  });

  it('broad multi-day spread chooses the earliest local date and spreads within that date', () => {
    const result = selectHumanFriendlySlotOptions([
      ...slotsEveryMinutes('2026-05-20', 7, 18, 15),
      ...slotsEveryMinutes('2026-05-21', 7, 18, 15),
    ], { maxOptions: 3, proposalStepMinutes: 60, strategy: 'spread' });

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T12:30:00.000Z',
      '2026-05-20T18:00:00.000Z',
    ]);
  });

  it('never returns more than maxOptions', () => {
    const result = selectHumanFriendlySlotOptions([
      slot('2026-05-20T07:00:00.000Z'),
      slot('2026-05-20T08:00:00.000Z'),
      slot('2026-05-20T09:00:00.000Z'),
      slot('2026-05-20T10:00:00.000Z'),
    ], { maxOptions: 3, proposalStepMinutes: 60, strategy: 'spread' });

    expect(result).toHaveLength(3);
  });

  it('returns sorted chronological options without mutating input', () => {
    const candidates = [
      slot('2026-05-20T09:00:00.000Z'),
      slot('2026-05-20T07:00:00.000Z'),
      slot('2026-05-20T08:00:00.000Z'),
    ];

    const result = selectHumanFriendlySlotOptions(candidates, { maxOptions: 3, proposalStepMinutes: 60, strategy: 'spread' });

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T08:00:00.000Z',
      '2026-05-20T09:00:00.000Z',
    ]);
    expect(candidates.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T09:00:00.000Z',
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T08:00:00.000Z',
    ]);
  });

  it('uses fallback step to produce more options when 60 minutes gives too few', () => {
    const result = selectHumanFriendlySlotOptions([
      slot('2026-05-20T10:00:00.000Z'),
      slot('2026-05-20T10:30:00.000Z'),
      slot('2026-05-20T10:45:00.000Z'),
    ], { maxOptions: 3, proposalStepMinutes: 60, fallbackProposalStepMinutes: 30, strategy: 'nearest' });

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T10:00:00.000Z',
      '2026-05-20T10:30:00.000Z',
    ]);
  });

  it('returns an empty list for empty candidates', () => {
    expect(selectHumanFriendlySlotOptions([])).toEqual([]);
  });

  it('returns a single candidate when only one exists', () => {
    const candidate = slot('2026-05-20T10:30:00.000Z');

    expect(selectHumanFriendlySlotOptions([candidate])).toEqual([candidate]);
  });
});
