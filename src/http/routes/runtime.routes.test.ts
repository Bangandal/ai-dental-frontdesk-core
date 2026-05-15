import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type {
  GetOrCreateRuntimeContactInput,
  LoadOrInitConvoStateInput,
  RegisterInboundEventInput,
  RuntimeCaseRecord,
  RuntimeExternalAppointmentRecord,
  RuntimeTurnRepository,
  SaveInboundUserMessageInput,
} from '../../domain/runtime/runtimeTurnService.js';
import { RUNTIME_AI_SAFE_FALLBACK_REPLY, type RuntimeAIClient, type RuntimeAIExtractionInput } from '../../domain/runtime/runtimeAiClient.js';
import type { RuntimeAIOutput } from '../../domain/runtime/runtimeContracts.js';
import { RuntimeTurnService } from '../../domain/runtime/runtimeTurnService.js';
import { registerRuntimeRoutes } from './runtime.routes.js';

const validPayload = {
  clinic_code: 'clinic_1',
  channel: 'telegram',
  external_user_id: '8054104741',
  chat_id: '8054104741',
  text: 'на 16 число есть место?',
  meta: {
    message_id: '1270',
    update_id: 464427367,
    username: 'Mishae_l',
    first_name: 'Light',
    last_name: null,
  },
} as const;

describe('runtime routes', () => {
  it('calls AI client with user_text, case_context, booking_context, and recent state', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ id: '55555555-5555-5555-5555-555555555555' })],
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({ reply_draft: 'Подскажите удобный день и время.' }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(aiClient.calls).toHaveLength(1);
      expect(aiClient.calls[0]).toMatchObject({
        prompt_version: 'runtime-ai-extraction-v1',
        context: {
          user_text: validPayload.text,
          convo_state: { state: {}, state_version: 1 },
          case_context: {
            current_case_id: '55555555-5555-5555-5555-555555555555',
            current_case: { collected: { service_interest: 'консультация' } },
          },
          booking_context: { active_hold: null, latest_appointment: null },
        },
      });
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите удобный день и время.',
        booking_result: null,
        side_effects: [],
        debug: {
          prompt_version: 'runtime-ai-extraction-v1',
          ai_output: { reply_draft: 'Подскажите удобный день и время.' },
        },
      });
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns safe fallback with ai_error when AI output is invalid', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient({ reply_draft: 'missing required fields' });
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
        booking_result: null,
        side_effects: [],
        debug: {
          prompt_version: 'runtime-ai-extraction-v1',
          ai_error: { code: 'invalid_ai_output' },
        },
      });
      expect(response.json().debug.ai_output).toBeUndefined();
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('includes availability AI output in debug without executing booking', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ collected: { service_interest: 'чистка' } })],
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'Проверю возможность записи на это время.',
      booking: {
        preferred_date_iso: '2026-05-16',
        preferred_weekday: null,
        time_of_day: 'any',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        side_effects: [],
        debug: {
          ai_output: {
            conversation_intent: 'availability_request',
            requested_action: 'check_availability',
            booking: { preferred_date_iso: '2026-05-16' },
          },
        },
      });
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('recognizes active_hold confirmation in AI output without confirming booking', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      reply_draft: 'Спасибо, уточню этот вариант.',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: true,
        patient_rejected_proposed_slot: false,
        selected_hold_id: 'hold-key-1',
      },
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'да, подтверждаю' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        side_effects: [],
        debug: {
          ai_output: {
            requested_action: 'confirm_slot',
            booking: {
              patient_confirmed_proposed_slot: true,
              selected_hold_id: 'hold-key-1',
            },
          },
        },
      });
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns case_id null with compact empty case and booking context when no case or hold exists', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
        clinic_id: '11111111-1111-1111-1111-111111111111',
        contact_id: '22222222-2222-2222-2222-222222222222',
        case_id: null,
        booking_result: null,
        side_effects: [],
        debug: {
          inbound_event_id: '33333333-3333-3333-3333-333333333333',
          user_message_id: '44444444-4444-4444-4444-444444444444',
          state_version: 1,
          duplicate: false,
          case_context: {
            current_case_id: null,
            current_case: null,
            open_cases_count: 0,
            recent_cases_count: 0,
            hard_handoff_mode: false,
            case_relation: 'none',
          },
          booking_context: {
            active_hold: null,
            latest_appointment: null,
          },
        },
      });
      expect(response.json().trace_id).toEqual(expect.any(String));
      expect(repository.calls).toMatchObject({
        clinicCode: 'clinic_1',
        contact: {
          clinicId: '11111111-1111-1111-1111-111111111111',
          channel: 'telegram',
          externalUserId: '8054104741',
          chatId: '8054104741',
          username: 'Mishae_l',
          firstName: 'Light',
          lastName: null,
        },
        inboundEvent: {
          clinicId: '11111111-1111-1111-1111-111111111111',
          contactId: '22222222-2222-2222-2222-222222222222',
          channel: 'telegram',
          externalUserId: '8054104741',
          dedupeKey: 'telegram:8054104741:464427367',
          sourceMessageId: '1270',
          sourceUpdateId: '464427367',
        },
        message: {
          clinicId: '11111111-1111-1111-1111-111111111111',
          contactId: '22222222-2222-2222-2222-222222222222',
          channel: 'telegram',
          text: validPayload.text,
          providerMessageId: '1270',
        },
        convoState: {
          clinicId: '11111111-1111-1111-1111-111111111111',
          contactId: '22222222-2222-2222-2222-222222222222',
        },
        cases: {
          clinicId: '11111111-1111-1111-1111-111111111111',
          contactId: '22222222-2222-2222-2222-222222222222',
        },
        activeHold: {
          clinicId: '11111111-1111-1111-1111-111111111111',
          contactId: '22222222-2222-2222-2222-222222222222',
          caseId: null,
        },
        latestAppointment: {
          clinicId: '11111111-1111-1111-1111-111111111111',
          contactId: '22222222-2222-2222-2222-222222222222',
          caseId: null,
        },
      });
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns existing current open case as case_id and compact case_context', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ id: '55555555-5555-5555-5555-555555555555' })],
    });
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        case_id: '55555555-5555-5555-5555-555555555555',
        debug: {
          case_context: {
            current_case_id: '55555555-5555-5555-5555-555555555555',
            current_case: {
              id: '55555555-5555-5555-5555-555555555555',
              case_number: 42,
              case_type: 'intake',
              topic: 'booking',
              status: 'open',
              priority: 'normal',
              summary: 'Patient wants a consultation.',
              last_activity_at: '2026-05-14T10:00:00.000Z',
              collected: { service_interest: 'консультация' },
            },
            open_cases_count: 1,
            recent_cases_count: 1,
            hard_handoff_mode: false,
            case_relation: 'current_open_case',
          },
        },
      });
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it.each(['collecting', 'awaiting_patient_confirmation'])(
    'returns %s case as current_case_id and current_open_case relation',
    async (status) => {
      const repository = new FakeRuntimeTurnRepository({
        cases: [makeCase({ id: '55555555-5555-5555-5555-555555555555', status })],
      });
      const app = Fastify();
      await app.register(registerRuntimeRoutes, {
        runtimeTurnService: new RuntimeTurnService(repository),
      });

      try {
        const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          case_id: '55555555-5555-5555-5555-555555555555',
          debug: {
            case_context: {
              current_case_id: '55555555-5555-5555-5555-555555555555',
              current_case: {
                id: '55555555-5555-5555-5555-555555555555',
                status,
              },
              open_cases_count: 1,
              recent_cases_count: 1,
              hard_handoff_mode: false,
              case_relation: 'current_open_case',
            },
          },
        });
        expect(repository.mutationCalls).toEqual([]);
      } finally {
        await app.close();
      }
    },
  );

  it('returns active hold and latest appointment in booking_context', async () => {
    const activeHold = makeAppointment({
      id: '66666666-6666-6666-6666-666666666666',
      caseId: '55555555-5555-5555-5555-555555555555',
      status: 'held',
      dedupeKey: 'hold-key-1',
    });
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ id: '55555555-5555-5555-5555-555555555555' })],
      activeHold,
      latestAppointment: activeHold,
    });
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        case_id: '55555555-5555-5555-5555-555555555555',
        debug: {
          booking_context: {
            active_hold: {
              hold_id: 'hold-key-1',
              dedupe_key: 'hold-key-1',
              appointment_id: '66666666-6666-6666-6666-666666666666',
              case_id: '55555555-5555-5555-5555-555555555555',
              status: 'held',
              service_interest: 'консультация',
              service: 'консультация',
              start_at: '2026-05-16T07:00:00.000Z',
              end_at: '2026-05-16T07:30:00.000Z',
              label: expect.any(String),
              provider_metadata: {
                timezone: 'Europe/Prague',
                cell_range: 'C4',
                sheet_name: 'Графік',
              },
            },
            latest_appointment: {
              appointment_id: '66666666-6666-6666-6666-666666666666',
              case_id: '55555555-5555-5555-5555-555555555555',
              status: 'held',
              service_interest: 'консультация',
              service: 'консультация',
              start_at: '2026-05-16T07:00:00.000Z',
              end_at: '2026-05-16T07:30:00.000Z',
              patient_confirmed_at: null,
              admin_confirmed_at: null,
            },
          },
        },
      });
      expect(repository.calls.activeHold?.caseId).toBe('55555555-5555-5555-5555-555555555555');
      expect(repository.calls.latestAppointment?.caseId).toBe('55555555-5555-5555-5555-555555555555');
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns clinic_not_found for unknown or inactive clinic_code', async () => {
    const repository = new FakeRuntimeTurnRepository({ clinicFound: false });
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: {
          ...validPayload,
          clinic_code: 'inactive_clinic',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: 'clinic_not_found',
          message: 'Active clinic was not found for the provided clinic_code.',
          trace_id: expect.any(String),
        },
      });
      expect(repository.calls).toEqual({ clinicCode: 'inactive_clinic' });
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns validation_failed for invalid runtime turn input', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: {
          ...validPayload,
          channel: 'sms',
          text: '',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
      expect(repository.calls).toEqual({});
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

interface FakeRuntimeTurnRepositoryOptions {
  clinicFound?: boolean;
  cases?: RuntimeCaseRecord[];
  activeHold?: RuntimeExternalAppointmentRecord | null;
  latestAppointment?: RuntimeExternalAppointmentRecord | null;
}

class FakeRuntimeTurnRepository implements RuntimeTurnRepository {
  constructor(private readonly options: FakeRuntimeTurnRepositoryOptions = {}) {}

  readonly mutationCalls: string[] = [];

  readonly calls: {
    clinicCode?: string;
    contact?: GetOrCreateRuntimeContactInput;
    inboundEvent?: RegisterInboundEventInput;
    message?: SaveInboundUserMessageInput;
    convoState?: LoadOrInitConvoStateInput;
    cases?: { clinicId: string; contactId: string };
    activeHold?: { clinicId: string; contactId: string; caseId: string | null };
    latestAppointment?: { clinicId: string; contactId: string; caseId: string | null };
  } = {};

  async findActiveClinicByCode(code: string) {
    this.calls.clinicCode = code;

    if (this.options.clinicFound === false) {
      return null;
    }

    return {
      id: '11111111-1111-1111-1111-111111111111',
      code,
      name: 'Clinic One',
      timezone: 'Europe/Prague',
      settings: {},
    };
  }

  async getOrCreateContact(input: GetOrCreateRuntimeContactInput) {
    this.calls.contact = input;

    return {
      id: '22222222-2222-2222-2222-222222222222',
      clinicId: input.clinicId,
      channel: input.channel,
      externalUserId: input.externalUserId,
    };
  }

  async registerInboundEvent(input: RegisterInboundEventInput) {
    this.calls.inboundEvent = input;

    return {
      id: '33333333-3333-3333-3333-333333333333',
      isDuplicate: false,
    };
  }

  async saveInboundUserMessage(input: SaveInboundUserMessageInput) {
    this.calls.message = input;

    return {
      id: '44444444-4444-4444-4444-444444444444',
    };
  }

  async loadOrInitConvoState(input: LoadOrInitConvoStateInput) {
    this.calls.convoState = input;

    return {
      clinicId: input.clinicId,
      contactId: input.contactId,
      state: {},
      stateVersion: 1,
    };
  }

  async listRecentCases(clinicId: string, contactId: string) {
    this.calls.cases = { clinicId, contactId };
    return this.options.cases ?? [];
  }

  async findLatestHeldAppointmentForContactOrCase(clinicId: string, contactId: string, caseId: string | null) {
    this.calls.activeHold = { clinicId, contactId, caseId };
    return this.options.activeHold ?? null;
  }

  async findLatestExternalAppointmentForContactOrCase(clinicId: string, contactId: string, caseId: string | null) {
    this.calls.latestAppointment = { clinicId, contactId, caseId };
    return this.options.latestAppointment ?? null;
  }
}

function makeCase(overrides: Partial<RuntimeCaseRecord> = {}): RuntimeCaseRecord {
  return {
    id: '55555555-5555-5555-5555-555555555555',
    clinicId: '11111111-1111-1111-1111-111111111111',
    contactId: '22222222-2222-2222-2222-222222222222',
    caseNumber: 42,
    caseType: 'intake',
    topic: 'booking',
    status: 'open',
    priority: 'normal',
    summary: 'Patient wants a consultation.',
    lastActivityAt: '2026-05-14T10:00:00.000Z',
    collected: { service_interest: 'консультация' },
    ...overrides,
  };
}

function makeAppointment(overrides: Partial<RuntimeExternalAppointmentRecord> = {}): RuntimeExternalAppointmentRecord {
  return {
    id: '66666666-6666-6666-6666-666666666666',
    clinicId: '11111111-1111-1111-1111-111111111111',
    contactId: '22222222-2222-2222-2222-222222222222',
    caseId: null,
    externalProvider: 'google_sheets',
    service: 'консультация',
    startAt: '2026-05-16T07:00:00.000Z',
    endAt: '2026-05-16T07:30:00.000Z',
    status: 'held',
    dedupeKey: 'hold-key-1',
    cellRange: 'C4',
    sheetName: 'Графік',
    externalRecordId: null,
    meta: {
      slot: {
        startAt: '2026-05-16T07:00:00.000Z',
        endAt: '2026-05-16T07:30:00.000Z',
        timezone: 'Europe/Prague',
        provider: 'google_sheets',
        metadata: {
          timezone: 'Europe/Prague',
          cell_range: 'C4',
          sheet_name: 'Графік',
        },
      },
    },
    ...overrides,
  };
}

class FakeRuntimeAIClient implements RuntimeAIClient {
  constructor(private readonly output: unknown) {}

  readonly calls: RuntimeAIExtractionInput[] = [];

  async extract(input: RuntimeAIExtractionInput): Promise<RuntimeAIOutput> {
    this.calls.push(input);
    return this.output as RuntimeAIOutput;
  }
}

function validAIOutput(overrides: Partial<RuntimeAIOutput> = {}): RuntimeAIOutput {
  const base: RuntimeAIOutput = {
    reply_draft: null,
    conversation_intent: 'unknown',
    requested_action: 'clarify',
    slot_updates: {
      name: null,
      service_interest: null,
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
