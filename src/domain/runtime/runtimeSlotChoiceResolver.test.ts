import { describe, expect, it } from 'vitest';

import { resolveRuntimeSlotChoice, type RuntimeProposedSlotMemory } from './runtimeSlotChoiceResolver.js';
import type { RuntimeAIOutput } from './runtimeContracts.js';

const slots: RuntimeProposedSlotMemory[] = [
  makeSlot({ option_id: '1', start_at: '2026-05-20T08:00:00.000Z' }),
  makeSlot({ option_id: '2', start_at: '2026-05-20T10:30:00.000Z' }),
  makeSlot({ option_id: '3', start_at: '2026-05-21T08:00:00.000Z' }),
];

describe('resolveRuntimeSlotChoice', () => {
  it('matches selected_option_id', () => {
    const result = resolve(selection({ selected_option_id: '2' }), slots);

    expect(result).toMatchObject({ matched: true, reason: 'matched_selected_option_id', selected_slot: { option_id: '2' } });
  });

  it('matches selected_start_at', () => {
    const result = resolve(selection({ selected_start_at: '2026-05-21T08:00:00.000Z' }), slots);

    expect(result).toMatchObject({ matched: true, reason: 'matched_selected_start_at', selected_slot: { option_id: '3' } });
  });

  it('matches selected_time when unique', () => {
    const result = resolve(selection({ selected_time: '10:30' }), slots);

    expect(result).toMatchObject({ matched: true, reason: 'matched_selected_time', selected_slot: { option_id: '2' } });
  });

  it('asks clarification for ambiguous selected_time', () => {
    const result = resolve(selection({ selected_time: '08:00' }), slots);

    expect(result).toMatchObject({ matched: false, reason: 'slot_selection_ambiguous_time', selected_slot: null });
  });

  it('asks clarification for low confidence', () => {
    const result = resolve(selection({ selected_option_id: '1', selection_confidence: 'low' }), slots);

    expect(result).toMatchObject({ matched: false, reason: 'slot_selection_low_confidence', selected_slot: null });
  });

  it('asks to check availability again when no stored options exist', () => {
    const result = resolve(selection({ selected_option_id: '1' }), []);

    expect(result).toMatchObject({ matched: false, reason: 'slot_selection_no_stored_options', selected_slot: null });
  });

  it('asks clarification for invalid selected_time', () => {
    const result = resolve(selection({ selected_time: '25:99' }), slots);

    expect(result).toMatchObject({ matched: false, reason: 'slot_selection_invalid_time', selected_slot: null });
  });
});

function resolve(slotSelection: RuntimeAIOutput['slot_selection'], lastProposedSlots: RuntimeProposedSlotMemory[]) {
  return resolveRuntimeSlotChoice({
    slot_selection: slotSelection,
    last_proposed_slots: lastProposedSlots,
    trace_id: 'trace-test',
    language: 'ru',
  });
}

function selection(overrides: Partial<RuntimeAIOutput['slot_selection']>): RuntimeAIOutput['slot_selection'] {
  return {
    selected_option_id: null,
    selected_start_at: null,
    selected_time: null,
    selection_confidence: 'high',
    ...overrides,
  };
}

function makeSlot(overrides: Partial<RuntimeProposedSlotMemory>): RuntimeProposedSlotMemory {
  return {
    option_id: '1',
    start_at: '2026-05-20T08:00:00.000Z',
    end_at: '2026-05-20T08:30:00.000Z',
    label: '20.05.2026, 10:00',
    cell_range: 'C4',
    sheet_name: 'Графік',
    service_interest: 'консультация',
    preferred_date_iso: '2026-05-20',
    time_of_day: 'any',
    exact_time: null,
    provider_metadata: {},
    ...overrides,
  };
}
