import { describe, expect, it } from 'vitest';

import type { ScheduleSlot } from '../../adapters/schedule/ScheduleAdapter.js';
import { selectHumanFriendlySlotOptions } from './selectHumanFriendlySlotOptions.js';

function slot(startAt: string): ScheduleSlot {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + 30 * 60_000);

  return {
    startAt,
    endAt: end.toISOString(),
    timezone: 'UTC',
    provider: 'google_sheets',
    metadata: { cell_range: startAt },
  };
}

describe('selectHumanFriendlySlotOptions', () => {
  it('spaces neighboring 15-minute cells with a 60 minute proposal step', () => {
    const result = selectHumanFriendlySlotOptions([
      slot('2026-05-20T07:00:00.000Z'),
      slot('2026-05-20T07:15:00.000Z'),
      slot('2026-05-20T07:30:00.000Z'),
      slot('2026-05-20T07:45:00.000Z'),
      slot('2026-05-20T08:00:00.000Z'),
      slot('2026-05-20T10:30:00.000Z'),
    ], { maxOptions: 3, proposalStepMinutes: 60 });

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T07:00:00.000Z',
      '2026-05-20T08:00:00.000Z',
      '2026-05-20T10:30:00.000Z',
    ]);
  });

  it('can select 10:30 as the first option', () => {
    const result = selectHumanFriendlySlotOptions([
      slot('2026-05-20T10:30:00.000Z'),
      slot('2026-05-20T10:45:00.000Z'),
      slot('2026-05-20T11:00:00.000Z'),
      slot('2026-05-20T11:30:00.000Z'),
      slot('2026-05-20T12:30:00.000Z'),
    ], { maxOptions: 3, proposalStepMinutes: 60 });

    expect(result.map((candidate) => candidate.startAt)).toEqual([
      '2026-05-20T10:30:00.000Z',
      '2026-05-20T11:30:00.000Z',
      '2026-05-20T12:30:00.000Z',
    ]);
  });

  it('never returns more than maxOptions', () => {
    const result = selectHumanFriendlySlotOptions([
      slot('2026-05-20T07:00:00.000Z'),
      slot('2026-05-20T08:00:00.000Z'),
      slot('2026-05-20T09:00:00.000Z'),
      slot('2026-05-20T10:00:00.000Z'),
    ], { maxOptions: 3, proposalStepMinutes: 60 });

    expect(result).toHaveLength(3);
  });

  it('returns sorted chronological options without mutating input', () => {
    const candidates = [
      slot('2026-05-20T09:00:00.000Z'),
      slot('2026-05-20T07:00:00.000Z'),
      slot('2026-05-20T08:00:00.000Z'),
    ];

    const result = selectHumanFriendlySlotOptions(candidates, { maxOptions: 3, proposalStepMinutes: 60 });

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
    ], { maxOptions: 3, proposalStepMinutes: 60, fallbackProposalStepMinutes: 30 });

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
