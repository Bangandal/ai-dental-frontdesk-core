import { describe, expect, it } from 'vitest';

import type { RuntimeAIOutput } from './runtimeContracts.js';
import { normalizeRuntimeAIOutputDates } from './runtimeDateNormalizer.js';

const clinicTimezone = 'Europe/Prague';

describe('normalizeRuntimeAIOutputDates', () => {
  it('does not normalize ambiguous bare numeric date phrases', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: 'Можно на 18?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-12',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBeNull();
    expect(result.debug.source).toBe('none');
  });

  it('does not normalize broad day-of-month phrases in this MVP scope', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: 'Можно на 18 число?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-12',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBeNull();
    expect(result.debug.source).toBe('none');
  });

  it('normalizes chat-style DD.MM dates without treating clock time as a date', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: '12.05 на 14.00 записываем?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-01',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBe('2026-05-12');
    expect(result.ai_output.availability_query?.date_iso).toBe('2026-05-12');
    expect(result.ai_output.slot_updates.preferred_time).toBeNull();
    expect(result.ai_output.booking.time_of_day).toBeNull();
    expect(result.debug.source).toBe('user_text_explicit_date');
  });

  it('normalizes chat-style DD.MM.YYYY dates', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: '12.05.2026 на 14.00',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-01',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBe('2026-05-12');
    expect(result.ai_output.availability_query?.date_iso).toBe('2026-05-12');
    expect(result.debug.source).toBe('user_text_explicit_date');
  });

  it('normalizes numeric day-month dates with slash and dash separators', () => {
    const slashResult = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: 'Можно 16/05 на 08:00?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-17',
    });
    const dashResult = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: 'Можно 16-05 на 08:00?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-17',
    });

    expect(slashResult.ai_output.availability_query?.date_iso).toBe('2026-05-16');
    expect(dashResult.ai_output.availability_query?.date_iso).toBe('2026-05-16');
  });

  it('ignores invalid numeric day-month dates', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: 'Можно 32.05 на 08:00?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-17',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBeNull();
    expect(result.ai_output.availability_query?.date_iso).toBeNull();
    expect(result.debug.source).toBe('none');
  });

  it('does not normalize numeric dates for pure FAQ context', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput({
        conversation_intent: 'faq',
        requested_action: 'answer_faq',
        availability_query: availabilityQuery({ search_type: 'unknown', exact_time: null }),
        slot_updates: { service_interest: null },
      }),
      user_text: 'Сколько стоит консультация 16.05?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-17',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBeNull();
    expect(result.ai_output.availability_query?.date_iso).toBeNull();
    expect(result.debug.source).toBe('none');
  });

  it('normalizes ISO dates from user_text', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput(),
      user_text: '2026-05-12 14:00',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-01',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBe('2026-05-12');
    expect(result.debug.source).toBe('user_text_explicit_date');
  });

  it('clears date-like preferred_weekday and does not pass it as a weekday', () => {
    const aiOutput = validAIOutput({
      booking: {
        preferred_date_iso: null,
        preferred_weekday: '2023-10-16',
        time_of_day: 'morning',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    });
    const result = normalizeRuntimeAIOutputDates({
      ai_output: aiOutput,
      user_text: 'Хочу записаться',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-12',
    });

    expect(result.ai_output.booking.preferred_weekday).toBeNull();
    expect(result.ai_output.booking.preferred_date_iso).toBeNull();
    expect(result.ai_output.booking.time_of_day).toBe('morning');
    expect(result.debug.warnings).toContain('preferred_weekday_cleared:2023-10-16');
    expect(aiOutput.booking.preferred_weekday).toBe('2023-10-16');
  });

  it('keeps a valid weekday', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput({
        booking: {
          preferred_date_iso: null,
          preferred_weekday: 'monday',
          time_of_day: null,
          patient_confirmed_proposed_slot: false,
          patient_rejected_proposed_slot: false,
          selected_hold_id: null,
        },
      }),
      user_text: 'Можно в понедельник?',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-12',
    });

    expect(result.ai_output.booking.preferred_weekday).toBe('monday');
    expect(result.ai_output.booking.preferred_date_iso).toBeNull();
    expect(result.debug.warnings).toEqual([]);
  });

  it('keeps existing valid preferred_date_iso unchanged', () => {
    const result = normalizeRuntimeAIOutputDates({
      ai_output: validAIOutput({
        booking: {
          preferred_date_iso: '2026-05-30',
          preferred_weekday: null,
          time_of_day: 'afternoon',
          patient_confirmed_proposed_slot: false,
          patient_rejected_proposed_slot: false,
          selected_hold_id: null,
        },
      }),
      user_text: '12.05 на 14.00',
      clinic_timezone: clinicTimezone,
      current_date_iso: '2026-05-12',
    });

    expect(result.ai_output.booking.preferred_date_iso).toBe('2026-05-30');
    expect(result.ai_output.booking.time_of_day).toBe('afternoon');
    expect(result.debug.source).toBe('ai');
  });
});

function availabilityQuery(
  overrides: Partial<NonNullable<RuntimeAIOutput['availability_query']>> = {},
): NonNullable<RuntimeAIOutput['availability_query']> {
  return {
    search_type: 'unknown',
    date_iso: null,
    weekday: null,
    relative_day: null,
    time_window: null,
    exact_time: null,
    flexibility: 'unknown',
    ...overrides,
  };
}

function validAIOutput(overrides: Partial<RuntimeAIOutput> = {}): RuntimeAIOutput {
  const base: RuntimeAIOutput = {
    reply_draft: null,
    conversation_intent: 'availability_request',
    requested_action: 'check_availability',
    availability_query: availabilityQuery({ search_type: 'exact_slot', exact_time: '08:00' }),
    slot_updates: {
      name: null,
      service_interest: 'консультация',
      problem: null,
      phone: null,
      preferred_time: null,
      preferred_contact: null,
    },
    slot_selection: {
      selected_option_id: null,
      selected_start_at: null,
      selected_time: null,
      selection_confidence: 'unknown',
    },
    booking: {
      preferred_date_iso: null,
      preferred_weekday: null,
      time_of_day: null,
      patient_confirmed_proposed_slot: false,
      patient_rejected_proposed_slot: false,
      selected_hold_id: null,
    },
    faq_topic: 'unknown',
    patient_scope: 'unknown',
    handoff_recommended: false,
    kb_used: false,
    confidence: 'medium',
  };

  return {
    ...base,
    ...overrides,
    availability_query: overrides.availability_query === undefined
      ? base.availability_query
      : overrides.availability_query,
    slot_updates: {
      ...base.slot_updates,
      ...overrides.slot_updates,
    },
    slot_selection: {
      ...base.slot_selection,
      ...overrides.slot_selection,
    },
    booking: {
      ...base.booking,
      ...overrides.booking,
    },
  };
}
