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
    expect(result.debug.source).toBe('user_text_explicit_date');
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

function validAIOutput(overrides: Partial<RuntimeAIOutput> = {}): RuntimeAIOutput {
  const base: RuntimeAIOutput = {
    reply_draft: null,
    conversation_intent: 'availability_request',
    requested_action: 'check_availability',
    slot_updates: {
      name: null,
      service_interest: 'консультация',
      problem: null,
      phone: null,
      preferred_time: null,
      preferred_contact: null,
    },
    booking: {
      preferred_date_iso: null,
      preferred_weekday: null,
      time_of_day: null,
      patient_confirmed_proposed_slot: false,
      patient_rejected_proposed_slot: false,
      selected_hold_id: null,
    },
    handoff_recommended: false,
    kb_used: false,
    confidence: 'medium',
  };

  return {
    ...base,
    ...overrides,
    slot_updates: {
      ...base.slot_updates,
      ...overrides.slot_updates,
    },
    booking: {
      ...base.booking,
      ...overrides.booking,
    },
  };
}
