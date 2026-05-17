import { describe, expect, it } from 'vitest';

import { buildRuntimePrompt } from './runtimePrompt.js';

const basePromptInput = {
  traceId: 'trace-1',
  clinic: {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'clinic_1',
    name: 'Clinic',
    timezone: 'Europe/Prague',
    settings: {},
  },
  contact: {
    id: '22222222-2222-2222-2222-222222222222',
    channel: 'telegram',
    externalUserId: '8054104741',
  },
  turn: {
    clinic_code: 'clinic_1',
    channel: 'telegram',
    external_user_id: '8054104741',
    chat_id: '8054104741',
    text: 'когда есть свободно?',
    meta: {},
  },
  convoState: {
    id: '33333333-3333-3333-3333-333333333333',
    state: {},
    stateVersion: 1,
  },
  caseContext: {
    current_case_id: null,
    current_case: null,
    open_cases_count: 0,
    recent_cases_count: 0,
    hard_handoff_mode: false,
    case_relation: 'none',
  },
  bookingContext: {
    active_hold: null,
    latest_appointment: null,
  },
  now: new Date('2026-05-17T10:00:00.000Z'),
} as const;

describe('buildRuntimePrompt', () => {
  it('guides broad availability questions away from nearest flexibility', () => {
    const prompt = buildRuntimePrompt(basePromptInput);

    expect(prompt.system_prompt).toContain('flexibility to flexible, not nearest');
    expect(prompt.system_prompt).toContain('nearest only when the patient explicitly asks');
    expect(prompt.system_prompt).toContain('“когда есть свободно?”, “какие есть варианты?”, and “когда можно записаться?”');
  });

  it('guides exact booking phrases to extract service_interest', () => {
    const prompt = buildRuntimePrompt(basePromptInput);

    expect(prompt.system_prompt).toContain('Extract appointment nouns and service phrases into slot_updates.service_interest');
    expect(prompt.system_prompt).toContain('Хочу записаться на консультацию стоматолога 23.05 на 08:00');
    expect(prompt.system_prompt).toContain('service_interest “консультация стоматолога”');
    expect(prompt.system_prompt).toContain('“На чистку завтра утром” -> service_interest “чистка”');
  });

});
