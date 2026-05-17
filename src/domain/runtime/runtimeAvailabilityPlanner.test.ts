import { describe, expect, it } from 'vitest';

import type { RuntimeAIOutput } from './runtimeContracts.js';
import { planRuntimeAvailability } from './runtimeAvailabilityPlanner.js';
import type { RuntimeBookingContext, RuntimeCaseContext, RuntimeClinicRecord } from './runtimeTurnService.js';

const clinic: RuntimeClinicRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'clinic_1',
  name: 'Clinic',
  timezone: 'Europe/Prague',
  settings: {},
};

const caseContext: RuntimeCaseContext = {
  current_case_id: '55555555-5555-5555-5555-555555555555',
  current_case: {
    id: '55555555-5555-5555-5555-555555555555',
    case_number: 42,
    case_type: 'intake',
    topic: 'booking',
    status: 'open',
    priority: 'normal',
    summary: null,
    last_activity_at: '2026-05-14T10:00:00.000Z',
    collected: { service_interest: 'консультация' },
  },
  open_cases_count: 1,
  recent_cases_count: 1,
  hard_handoff_mode: false,
  case_relation: 'current_open_case',
};

const bookingContext: RuntimeBookingContext = {
  active_hold: null,
  latest_appointment: null,
};

describe('RuntimeAvailabilityPlanner', () => {
  it('plans nearest_available with service as propose_options', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'nearest_available', flexibility: 'nearest' }) }),
    });

    expect(result).toMatchObject({
      should_call_booking: true,
      booking_action: 'propose_options',
      reason: 'availability_nearest_available',
      booking_request: {
        bookingAction: 'propose_options',
        serviceInterest: 'консультация',
        preferredDateIso: null,
        timeOfDay: 'any',
      },
    });
    expect(result.booking_request?.metadata).toMatchObject({
      source: 'runtime_availability_planner',
      search_window_days: 14,
    });
  });

  it('resolves nearest Saturday using the clinic-local date', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput({ current_clinic_date_iso: '2026-05-12' }),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'weekday', weekday: 'saturday' }) }),
    });

    expect(result.booking_request).toMatchObject({
      preferredDateIso: '2026-05-16',
      preferredWeekday: 'saturday',
    });
  });

  it('resolves relative_day tomorrow from clinic-local current date', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput({ current_clinic_date_iso: '2026-05-12' }),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'relative_day', relative_day: 'tomorrow' }) }),
    });

    expect(result.booking_request?.preferredDateIso).toBe('2026-05-13');
  });

  it('preserves before 10 time window metadata without raw text parsing', () => {
    const timeWindow = { type: 'before' as const, start_time: null, end_time: '10:00' };
    const result = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'time_constraint', time_window: timeWindow }) }),
    });

    expect(result.booking_request).toMatchObject({
      timeOfDay: 'morning',
      preferredTimeWindow: { startTime: null, endTime: '10:00' },
    });
    expect(result.booking_request?.metadata).toMatchObject({ time_window: timeWindow });
  });

  it('preserves after 14:00 and afternoon windows as deterministic time constraints', () => {
    const after = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({
          search_type: 'time_constraint',
          time_window: { type: 'after', start_time: '14:00', end_time: null },
        }),
      }),
    });
    const afternoon = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({
          search_type: 'time_constraint',
          time_window: { type: 'afternoon', start_time: null, end_time: null },
        }),
      }),
    });

    expect(after.booking_request).toMatchObject({
      timeOfDay: 'afternoon',
      preferredTimeWindow: { startTime: '14:00', endTime: null },
    });
    expect(after.booking_request?.metadata).toMatchObject({ exact_time: null, time_window: { start_time: '14:00' } });
    expect(afternoon.booking_request).toMatchObject({ timeOfDay: 'afternoon' });
  });

  it('builds a safe exact-time booking request with date and exact HH:mm metadata', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-12', exact_time: '14:00', flexibility: 'specific' }),
      }),
    });

    expect(result.booking_request).toMatchObject({
      preferredDateIso: '2026-05-12',
      timeOfDay: 'afternoon',
      exactTime: '14:00',
      metadata: { exact_time: '14:00' },
    });
  });




  it('plans direct exact_slot as propose_slot with exactTime', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput({ current_clinic_date_iso: '2026-05-17' }),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-18', exact_time: '14:00' }),
      }),
    });

    expect(result).toMatchObject({
      should_call_booking: true,
      booking_action: 'propose_slot',
      reason: 'availability_exact_slot',
      booking_request: {
        bookingAction: 'propose_slot',
        preferredDateIso: '2026-05-18',
        exactTime: '14:00',
        metadata: { policy_action: 'propose_slot', exact_time: '14:00' },
      },
    });
  });

  it('blocks specific_date in the past before booking', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput({ current_clinic_date_iso: '2026-05-17' }),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-12' }) }),
    });

    expect(result).toMatchObject({
      should_call_booking: false,
      booking_request: null,
      reason: 'availability_date_in_past',
    });
  });

  it('blocks exact_slot date in the past before booking', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput({ current_clinic_date_iso: '2026-05-17' }),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-12', exact_time: '14:00' }) }),
    });

    expect(result).toMatchObject({
      should_call_booking: false,
      booking_request: null,
      reason: 'exact_slot_date_in_past',
    });
  });


  it('blocks exact_slot with invalid or missing exact_time before booking', () => {
    const invalid = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-12', exact_time: '14.00' }),
      }),
    });
    const missing = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-12', exact_time: null }),
      }),
    });

    expect(invalid).toMatchObject({
      should_call_booking: false,
      booking_request: null,
      reason: 'exact_slot_invalid_time',
    });
    expect(missing).toMatchObject({
      should_call_booking: false,
      booking_request: null,
      reason: 'exact_slot_missing_time',
    });
  });

  it('blocks incomplete or invalid bounded time windows before booking', () => {
    const before = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({ search_type: 'time_constraint', time_window: { type: 'before', start_time: null, end_time: null } }),
      }),
    });
    const after = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({ search_type: 'time_constraint', time_window: { type: 'after', start_time: null, end_time: null } }),
      }),
    });
    const invalidRange = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({ search_type: 'time_constraint', time_window: { type: 'between', start_time: '16:00', end_time: '14:00' } }),
      }),
    });

    expect(before).toMatchObject({ should_call_booking: false, booking_request: null, reason: 'time_window_missing_or_invalid' });
    expect(after).toMatchObject({ should_call_booking: false, booking_request: null, reason: 'time_window_missing_or_invalid' });
    expect(invalidRange).toMatchObject({ should_call_booking: false, booking_request: null, reason: 'time_window_invalid_range' });
  });

  it('passes valid between window as an enforceable booking field', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: availabilityQuery({
          search_type: 'time_constraint',
          time_window: { type: 'between', start_time: '14:00', end_time: '16:00' },
        }),
      }),
    });

    expect(result.booking_request).toMatchObject({
      preferredTimeWindow: { startTime: '14:00', endTime: '16:00' },
      timeOfDay: 'afternoon',
    });
  });

  it('blocks availability booking when service is missing', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput({ case_context: { ...caseContext, current_case: { ...caseContext.current_case!, collected: {} } } }),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'nearest_available' }) }),
    });

    expect(result).toMatchObject({
      should_call_booking: false,
      booking_request: null,
      reason: 'missing_service_for_availability',
    });
  });

  it('asks clarification for unknown search_type', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'unknown' }) }),
    });

    expect(result).toMatchObject({
      should_call_booking: false,
      booking_request: null,
      reason: 'availability_query_unknown',
    });
  });

  it('falls back from legacy booking time_of_day', () => {
    const result = planRuntimeAvailability({
      ...basePlannerInput(),
      ai_output: validAIOutput({
        availability_query: null,
        booking: { time_of_day: 'morning' },
      }),
    });

    expect(result).toMatchObject({
      should_call_booking: true,
      reason: 'availability_time_constraint_from_legacy_booking',
      warnings: ['availability_query_fallback_from_booking'],
      booking_request: { timeOfDay: 'morning' },
    });
  });

  it('does not require or read raw user_text', () => {
    const input = basePlannerInput();

    expect('user_text' in input).toBe(false);
    expect(planRuntimeAvailability({
      ...input,
      ai_output: validAIOutput({ availability_query: availabilityQuery({ search_type: 'relative_day', relative_day: 'tomorrow' }) }),
    }).booking_request?.preferredDateIso).toBe('2026-05-13');
  });
});

function basePlannerInput(overrides: Partial<Parameters<typeof planRuntimeAvailability>[0]> = {}): Parameters<typeof planRuntimeAvailability>[0] {
  return {
    ai_output: validAIOutput(),
    clinic,
    contact_id: '22222222-2222-2222-2222-222222222222',
    channel: 'telegram',
    trace_id: 'trace-1',
    current_clinic_date_iso: '2026-05-12',
    current_time_iso: '2026-05-12T10:00:00.000Z',
    case_context: caseContext,
    booking_context: bookingContext,
    ...overrides,
  };
}

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
    slot_updates: {
      name: null,
      service_interest: null,
      problem: null,
      phone: null,
      preferred_time: null,
      preferred_contact: null,
    },
    availability_query: availabilityQuery(),
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
