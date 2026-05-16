import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type { BookingApplyRequest, BookingApplyResponse } from '../../domain/booking/bookingApply.js';
import type {
  CreateAdminNotificationInput,
  GetOrCreateRuntimeContactInput,
  LoadOrInitConvoStateInput,
  RegisterInboundEventInput,
  RuntimeCaseRecord,
  RuntimeExternalAppointmentRecord,
  RuntimeTurnRepository,
  SaveInboundUserMessageInput,
  SaveOutboundAssistantMessageInput,
} from '../../domain/runtime/runtimeTurnService.js';
import {
  NoopRuntimeAIClient,
  RUNTIME_AI_SAFE_FALLBACK_REPLY,
  type RuntimeAIClient,
  type RuntimeAIExtractionInput,
} from '../../domain/runtime/runtimeAiClient.js';
import { RuntimeAIProviderError } from '../../domain/runtime/openAiRuntimeClient.js';
import type { RuntimeAIOutput } from '../../domain/runtime/runtimeContracts.js';
import { RuntimeTurnService } from '../../domain/runtime/runtimeTurnService.js';
import { createRuntimeAIClient, registerRuntimeRoutes } from './runtime.routes.js';

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


describe('runtime AI client factory', () => {
  it('uses NoopRuntimeAIClient when OpenAI runtime is not explicitly enabled', async () => {
    const aiClient = await createRuntimeAIClient({
      openaiRuntimeEnabled: false,
    });

    expect(aiClient).toBeInstanceOf(NoopRuntimeAIClient);
  });

  it('requires OpenAI credentials when OpenAI runtime is enabled', async () => {
    await expect(createRuntimeAIClient({
      openaiRuntimeEnabled: true,
      openaiModel: 'gpt-test-runtime',
    })).rejects.toThrow('OPENAI_API_KEY is required when OPENAI_RUNTIME_ENABLED=true.');

    await expect(createRuntimeAIClient({
      openaiRuntimeEnabled: true,
      openaiApiKey: 'test-key',
    })).rejects.toThrow('OPENAI_MODEL is required when OPENAI_RUNTIME_ENABLED=true.');
  });

  it('constructs OpenAIRuntimeAIClient only when OpenAI runtime is explicitly enabled and configured', async () => {
    const aiClient = await createRuntimeAIClient({
      openaiRuntimeEnabled: true,
      openaiApiKey: 'test-key',
      openaiModel: 'gpt-test-runtime',
      openaiTimeoutMs: 5000,
    });

    expect(aiClient).toMatchObject({
      provider: 'openai',
      model: 'gpt-test-runtime',
    });
  });
});

describe('runtime routes', () => {
  it('calls AI client with user_text, case_context, booking_context, and recent state', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ id: '55555555-5555-5555-5555-555555555555' })],
    });
    const aiClient = new FakeRuntimeAIClient(
      validAIOutput({ reply_draft: 'Подскажите удобный день и время.' }),
      'openai',
      'gpt-test-runtime',
    );
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
          output_contract: {
            reply_draft: 'string|null',
            slot_updates: {
              name: 'string|null',
              service_interest: 'string|null',
              problem: 'string|null',
              phone: 'string|null',
              preferred_time: 'string|null',
              preferred_contact: 'string|null',
            },
            booking: {
              preferred_date_iso: 'string|null',
              preferred_weekday: 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|null',
              time_of_day: 'morning|afternoon|evening|any|null',
              patient_confirmed_proposed_slot: 'boolean',
              patient_rejected_proposed_slot: 'boolean',
              selected_hold_id: 'string|null',
            },
            handoff_recommended: 'boolean',
            kb_used: 'boolean',
            confidence: 'high|medium|low',
          },
        },
      });
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите удобный день и время.',
        booking_result: null,
        side_effects: [],
        debug: {
          prompt_version: 'runtime-ai-extraction-v1',
          ai_provider: 'openai',
          ai_model: 'gpt-test-runtime',
          ai_output: { reply_draft: 'Подскажите удобный день и время.' },
        },
      });
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns safe fallback with ai_error when AI output is invalid and does not call booking', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient({ reply_draft: 'missing required fields' });
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
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
      expect(bookingApplyService.calls).toEqual([]);
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns safe fallback with safe ai_error when AI provider fails and does not call booking', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new ThrowingRuntimeAIClient(
      new RuntimeAIProviderError('OpenAI rate limit', 'openai_http_429', 'openai', 'gpt-test-runtime'),
      'openai',
      'gpt-test-runtime',
    );
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
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
          ai_provider: 'openai',
          ai_model: 'gpt-test-runtime',
          ai_error: {
            code: 'openai_http_429',
            message: 'OpenAI rate limit',
            provider: 'openai',
            model: 'gpt-test-runtime',
          },
        },
      });
      expect(response.json().debug.ai_output).toBeUndefined();
      expect(bookingApplyService.calls).toEqual([]);
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('does not call booking for FAQ AI output and uses AI draft', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      reply_draft: 'Консультация стоит 500 Kč.',
    }));
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Консультация стоит 500 Kč.',
        booking_result: null,
        side_effects: [],
        debug: {
          reply_source: 'ai_draft',
          policy_decision: {
            should_call_booking: false,
            reason: 'no_booking_for_faq',
          },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });


  it('saves outbound assistant message on successful AI draft reply with runtime meta', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      reply_draft: 'Консультация стоит 500 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Консультация стоит 500 Kč.',
        side_effects: [],
        debug: {
          reply_source: 'ai_draft',
          outbound_message_id: '77777777-7777-7777-7777-777777777777',
        },
      });
      expect(repository.operationOrder).toEqual(['saveInboundUserMessage', 'saveOutboundAssistantMessage']);
      expect(repository.calls.outboundMessage).toMatchObject({
        clinicId: '11111111-1111-1111-1111-111111111111',
        contactId: '22222222-2222-2222-2222-222222222222',
        caseId: null,
        channel: 'telegram',
        text: 'Консультация стоит 500 Kč.',
        replyToMessageId: '44444444-4444-4444-4444-444444444444',
        meta: {
          source: 'runtime_turn',
          reply_source: 'ai_draft',
          prompt_version: 'runtime-ai-extraction-v1',
          policy_decision: {
            reason: 'no_booking_for_faq',
          },
          booking: null,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('saves outbound assistant message when reply comes from booking_result', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI draft must not be final booking reply.',
      booking: {
        preferred_date_iso: '2026-05-16',
        preferred_weekday: null,
        time_of_day: 'morning',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Есть окно 16.05.2026, 09:00. Подтверждаем?',
        side_effects: [],
        debug: {
          reply_source: 'booking_result',
          outbound_message_id: '77777777-7777-7777-7777-777777777777',
        },
      });
      expect(repository.calls.outboundMessage).toMatchObject({
        caseId: '55555555-5555-5555-5555-555555555555',
        text: 'Есть окно 16.05.2026, 09:00. Подтверждаем?',
        meta: {
          source: 'runtime_turn',
          reply_source: 'booking_result',
          prompt_version: 'runtime-ai-extraction-v1',
          policy_decision: {
            reason: 'availability_request_with_service_and_date',
          },
          booking: {
            booking_status: 'awaiting_patient_confirmation',
            booking_action: 'propose_slot',
            reason: 'slot_proposed',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('saves outbound assistant message with current case_id when a case exists', async () => {
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
      expect(repository.calls.outboundMessage?.caseId).toBe('55555555-5555-5555-5555-555555555555');
    } finally {
      await app.close();
    }
  });

  it('saves outbound assistant message with null case_id when no case exists', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(repository.calls.outboundMessage?.caseId).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('returns reply_text when outbound persistence fails and records safe debug error', async () => {
    const repository = new FakeRuntimeTurnRepository({ failOutboundPersistence: true });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      reply_draft: 'Консультация стоит 500 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Консультация стоит 500 Kč.',
        side_effects: [],
        debug: {
          reply_source: 'ai_draft',
          outbound_persistence_error: {
            code: 'outbound_persistence_failed',
            message: 'Outbound assistant message persistence failed.',
          },
        },
      });
      expect(response.json().debug.outbound_message_id).toBeUndefined();
      expect(repository.operationOrder).toEqual(['saveInboundUserMessage', 'saveOutboundAssistantMessage']);
    } finally {
      await app.close();
    }
  });

  it('does not call booking for booking interest without date and asks for day/time', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      reply_draft: 'AI draft should not win here.',
    }));
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Здравствуйте, хочу записаться на консультацию' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        side_effects: [],
        debug: {
          reply_source: 'policy',
          policy_decision: {
            should_call_booking: false,
            reason: 'booking_interest_missing_datetime',
          },
        },
      });
      expect(response.json().reply_text).toContain('удобный день и время');
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('calls BookingApplyService propose_slot when availability request has date and service from current case', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ id: '55555555-5555-5555-5555-555555555555', collected: { service_interest: 'консультация' } })],
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI must not be final booking reply.',
      booking: {
        preferred_date_iso: '2026-05-16',
        preferred_weekday: null,
        time_of_day: 'morning',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        clinicId: '11111111-1111-1111-1111-111111111111',
        contactId: '22222222-2222-2222-2222-222222222222',
        caseId: '55555555-5555-5555-5555-555555555555',
        bookingAction: 'propose_slot',
        serviceInterest: 'консультация',
        preferredDateIso: '2026-05-16',
        timeOfDay: 'morning',
        patientName: 'Light',
        channel: 'telegram',
      });
      expect(response.json()).toMatchObject({
        reply_text: 'Есть окно 16.05.2026, 09:00. Подтверждаем?',
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        side_effects: [],
        debug: {
          reply_source: 'booking_result',
          policy_decision: { should_call_booking: true, reason: 'availability_request_with_service_and_date' },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('normalizes user_text date before policy and calls BookingApplyService', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ id: '55555555-5555-5555-5555-555555555555', collected: { service_interest: 'консультация' } })],
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI must not be final booking reply.',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: '2023-10-16',
        time_of_day: null,
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse({
      startAt: '2026-05-12T07:00:00.000Z',
      endAt: '2026-05-12T07:30:00.000Z',
      label: '12.05.2026, 09:00',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        () => new Date('2026-05-01T10:00:00.000Z'),
      ),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: '12.05 на 14.00 записываем?' },
      });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'propose_slot',
        preferredDateIso: '2026-05-12',
        preferredWeekday: null,
        timeOfDay: 'any',
      });
      expect(response.json()).toMatchObject({
        reply_text: 'Есть окно 12.05.2026, 09:00. Подтверждаем?',
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        debug: {
          ai_output_raw: {
            booking: {
              preferred_date_iso: null,
              preferred_weekday: '2023-10-16',
            },
          },
          ai_output: {
            booking: {
              preferred_date_iso: '2026-05-12',
              preferred_weekday: null,
              time_of_day: null,
            },
          },
          date_normalization: {
            source: 'user_text_explicit_date',
            after: {
              preferred_date_iso: '2026-05-12',
              preferred_weekday: null,
              time_of_day: null,
            },
          },
          reply_source: 'booking_result',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('does not normalize bare numeric phrases or call booking', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ collected: { service_interest: 'консультация' } })],
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI draft should not trigger booking.',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        () => new Date('2026-05-12T10:00:00.000Z'),
      ),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Можно на 18?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        debug: {
          date_normalization: {
            source: 'none',
            after: {
              preferred_date_iso: null,
              preferred_weekday: null,
            },
          },
          policy_decision: {
            should_call_booking: false,
            reason: 'booking_interest_missing_datetime',
          },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('does not call booking when date cannot be normalized and preferred_weekday is invalid', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ collected: { service_interest: 'консультация' } })],
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI draft should not trigger booking.',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: '2023-10-16',
        time_of_day: 'morning',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        () => new Date('2026-05-12T10:00:00.000Z'),
      ),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Хочу записаться утром' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        debug: {
          reply_source: 'policy',
          date_normalization: {
            source: 'none',
            after: {
              preferred_date_iso: null,
              preferred_weekday: null,
              time_of_day: 'morning',
            },
          },
          policy_decision: {
            should_call_booking: false,
            reason: 'booking_interest_missing_datetime',
          },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns manual-check reply when BookingApplyService throws', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI draft must not claim booking success.',
      booking: {
        preferred_date_iso: '2026-05-16',
        preferred_weekday: null,
        time_of_day: 'any',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new ThrowingBookingApplyService(new Error('database connection failed'));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(response.json()).toMatchObject({
        reply_text: 'Не удалось автоматически проверить запись. Администратор проверит вручную и свяжется с вами.',
        booking_result: null,
        side_effects: [],
        debug: {
          reply_source: 'booking_error',
          booking_error: {
            code: 'booking_apply_failed',
            message: 'Booking apply failed.',
          },
        },
      });
      expect(response.json().debug.ai_error).toBeUndefined();
      expect(response.json().reply_text).not.toContain('зафиксирован');
      expect(response.json().reply_text).not.toContain('подтвержд');
      expect(response.json().reply_text).not.toContain('Есть окно');
    } finally {
      await app.close();
    }
  });

  it('does not call BookingApplyService when availability request only has preferredWeekday', async () => {
    const repository = new FakeRuntimeTurnRepository({
      cases: [makeCase({ collected: { service_interest: 'консультация' } })],
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI draft should not trigger broad availability.',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: 'monday',
        time_of_day: 'morning',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Можно в понедельник утром?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, конкретную дату для проверки записи.',
        booking_result: null,
        side_effects: [],
        debug: {
          reply_source: 'policy',
          policy_decision: {
            should_call_booking: false,
            reason: 'preferred_weekday_not_supported_for_booking',
          },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('does not call booking when availability request has date but missing service', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: {} })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      booking: {
        preferred_date_iso: '2026-05-16',
        preferred_weekday: null,
        time_of_day: 'any',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'На какую процедуру или консультацию хотите записаться?',
        booking_result: null,
        side_effects: [],
        debug: {
          reply_source: 'policy',
          policy_decision: { should_call_booking: false, reason: 'missing_service_for_availability' },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('calls BookingApplyService confirm_slot for active hold patient confirmation', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: true,
        patient_rejected_proposed_slot: false,
        selected_hold_id: 'hold-key-1',
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'да подтверждаю' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'confirm_slot',
        activeHoldId: 'hold-key-1',
        serviceInterest: 'консультация',
      });
      expect(response.json()).toMatchObject({
        booking_result: { booking_status: 'booked_pending_admin_confirmation' },
        side_effects: [],
        debug: {
          reply_source: 'booking_result',
          date_normalization: { source: 'none' },
        },
      });
      expect(response.json().reply_text).toContain('Администратор проверит');
      expect(response.json().side_effects).toEqual([]);
      expect(repository.mutationCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('active hold rejection does not hallucinate cancellation when cancel_hold returns not_implemented', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_rejected',
      requested_action: 'reject_slot',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: true,
        selected_hold_id: 'hold-key-1',
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(cancelNotImplementedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'нет' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'cancel_hold', activeHoldId: 'hold-key-1' });
      expect(response.json()).toMatchObject({
        booking_result: { booking_status: 'not_implemented', reason: 'cancel_hold_not_implemented' },
        side_effects: [],
        debug: { reply_source: 'booking_result' },
      });
      expect(response.json().reply_text).toContain('это время не будем использовать');
      expect(response.json().reply_text).not.toContain('отмен');
    } finally {
      await app.close();
    }
  });

  it('builds no_slots reply from booking_result rather than AI draft', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      reply_draft: 'AI says a slot exists, but it should not win.',
      booking: {
        preferred_date_iso: '2026-05-16',
        preferred_weekday: null,
        time_of_day: 'any',
        patient_confirmed_proposed_slot: false,
        patient_rejected_proposed_slot: false,
        selected_hold_id: null,
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(noSlotsResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Свободных слотов по вашему запросу сейчас не нашёл. Подскажите другой день или время.',
        booking_result: { booking_status: 'no_slots' },
        side_effects: [],
        debug: { reply_source: 'booking_result' },
      });
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


  it('creates pending admin notification side_effect for booked_pending_admin_confirmation booking_result', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({
      activeHold,
      latestAppointment: activeHold,
      adminRecipient: '999-admin-chat',
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: true,
        patient_rejected_proposed_slot: false,
        selected_hold_id: 'hold-key-1',
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'да подтверждаю' } });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(repository.operationOrder).toEqual([
        'saveInboundUserMessage',
        'saveOutboundAssistantMessage',
        'createAdminNotification',
      ]);
      expect(repository.calls.notification).toMatchObject({
        clinicId: '11111111-1111-1111-1111-111111111111',
        contactId: '22222222-2222-2222-2222-222222222222',
        caseId: null,
        leadId: null,
        channel: 'telegram',
        recipient: '999-admin-chat',
        templateKey: 'runtime_admin_attention',
        payload: {
          contact_id: '22222222-2222-2222-2222-222222222222',
          user_text: 'да подтверждаю',
          reply_text: body.reply_text,
          reason: 'appointment_confirmed',
          trigger: 'booking_result_booked_pending_admin_confirmation',
          booking_result: {
            booking_action: 'confirm_slot',
            booking_status: 'booked_pending_admin_confirmation',
            appointment_id: '66666666-6666-6666-6666-666666666666',
            proposed_slot: {
              label: '16.05.2026, 09:00',
              start_at: '2026-05-16T07:00:00.000Z',
            },
          },
          contact: {
            username: 'Mishae_l',
            first_name: 'Light',
            last_name: null,
            chat_id: '8054104741',
            external_user_id: '8054104741',
            channel: 'telegram',
          },
        },
      });
      expect(repository.calls.notification?.dedupeKey).toContain(`runtime_admin_notification:${body.trace_id}:booking_result_booked_pending_admin_confirmation`);
      expect(body).toMatchObject({
        side_effects: [{
          type: 'admin_notification',
          channel: 'telegram',
          notification_id: '88888888-8888-8888-8888-888888888888',
          recipient: '999-admin-chat',
          template_key: 'runtime_admin_attention',
          payload: {
            trigger: 'booking_result_booked_pending_admin_confirmation',
            reason: 'appointment_confirmed',
          },
        }],
        debug: {
          admin_notification: {
            notification_id: '88888888-8888-8888-8888-888888888888',
            trigger: 'booking_result_booked_pending_admin_confirmation',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('creates admin notification for external_write_failed booking_result', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()], activeHold, latestAppointment: activeHold, adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      booking: {
        preferred_date_iso: null,
        preferred_weekday: null,
        time_of_day: null,
        patient_confirmed_proposed_slot: true,
        patient_rejected_proposed_slot: false,
        selected_hold_id: 'hold-key-1',
      },
    }));
    const bookingApplyService = new FakeBookingApplyService(externalWriteFailedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: { booking_status: 'external_write_failed' },
        side_effects: [{ payload: { trigger: 'booking_result_external_write_failed' } }],
      });
      expect(repository.calls.notification).toMatchObject({ payload: { reason: 'external_write_failed' } });
    } finally {
      await app.close();
    }
  });

  it('does not create admin notification for no_slots booking_result', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()], adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      booking: { preferred_date_iso: '2026-05-16', preferred_weekday: null, time_of_day: 'any', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
    }));
    const bookingApplyService = new FakeBookingApplyService(noSlotsResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().side_effects).toEqual([]);
      expect(repository.calls.notification).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('does not create admin notification for awaiting_patient_confirmation proposed hold', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()], adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      booking: { preferred_date_iso: '2026-05-16', preferred_weekday: null, time_of_day: 'morning', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().side_effects).toEqual([]);
      expect(repository.calls.notification).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('creates admin notification for booking_error when admin recipient is configured', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()], adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      booking: { preferred_date_iso: '2026-05-16', preferred_weekday: null, time_of_day: 'any', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
    }));
    const bookingApplyService = new ThrowingBookingApplyService(new Error('database connection failed'));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Не удалось автоматически проверить запись. Администратор проверит вручную и свяжется с вами.',
        side_effects: [{ payload: { trigger: 'booking_error', reason: 'booking_apply_failed' } }],
      });
      expect(repository.calls.notification).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('creates admin notification when AI handoff_recommended is true', async () => {
    const repository = new FakeRuntimeTurnRepository({ adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'clarify',
      handoff_recommended: true,
      reply_draft: 'Передам администратору.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ side_effects: [{ payload: { trigger: 'ai_handoff_recommended' } }] });
      expect(repository.calls.notification).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('creates admin notification for urgent conversation_intent', async () => {
    const repository = new FakeRuntimeTurnRepository({ notificationSettings: { notifications: { admin_telegram_chat_id: 123456 } } });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'urgent',
      requested_action: 'clarify',
      reply_draft: 'Сейчас передам администратору.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ side_effects: [{ recipient: '123456', payload: { trigger: 'ai_urgent_intent' } }] });
      expect(repository.calls.notification).toMatchObject({ recipient: '123456' });
    } finally {
      await app.close();
    }
  });

  it('does not create admin notification for pure FAQ even when admin recipient is configured', async () => {
    const repository = new FakeRuntimeTurnRepository({ adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      reply_draft: 'Консультация стоит 500 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().side_effects).toEqual([]);
      expect(repository.calls.notification).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('skips admin notification safely when recipient is not configured', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      booking: { preferred_date_iso: null, preferred_weekday: null, time_of_day: null, patient_confirmed_proposed_slot: true, patient_rejected_proposed_slot: false, selected_hold_id: 'hold-key-1' },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        side_effects: [],
        debug: { admin_notification_skipped: { reason: 'admin_recipient_not_configured' } },
      });
      expect(repository.calls.notification).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('does not crash runtime when notification persistence fails and still returns reply_text', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({
      activeHold,
      latestAppointment: activeHold,
      adminRecipient: '999-admin-chat',
      failNotificationPersistence: true,
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      booking: { preferred_date_iso: null, preferred_weekday: null, time_of_day: null, patient_confirmed_proposed_slot: true, patient_rejected_proposed_slot: false, selected_hold_id: 'hold-key-1' },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Запрос на запись 16.05.2026, 09:00 зафиксирован. Администратор проверит и подтвердит запись.',
        side_effects: [],
        debug: { admin_notification_error: { code: 'admin_notification_persistence_failed' } },
      });
      expect(repository.calls.outboundMessage).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('does not contain backend Telegram sending code in runtime implementation', async () => {
    const { readFile } = await import('node:fs/promises');
    const runtimeSource = await readFile(new URL('../../domain/runtime/runtimeTurnService.ts', import.meta.url), 'utf8');
    const routeSource = await readFile(new URL('./runtime.routes.ts', import.meta.url), 'utf8');

    expect(`${runtimeSource}\n${routeSource}`).not.toContain('sendTelegram');
    expect(`${runtimeSource}\n${routeSource}`).not.toContain('sendMessage(');
    expect(`${runtimeSource}\n${routeSource}`).not.toContain('TelegramBot');
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
      expect(repository.calls.outboundMessage).toBeUndefined();
      expect(repository.operationOrder).toEqual([]);
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
      expect(repository.calls.outboundMessage).toBeUndefined();
      expect(repository.operationOrder).toEqual([]);
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
  failOutboundPersistence?: boolean;
  adminRecipient?: string | number | null;
  notificationSettings?: Record<string, unknown>;
  failNotificationPersistence?: boolean;
}

class FakeRuntimeTurnRepository implements RuntimeTurnRepository {
  constructor(private readonly options: FakeRuntimeTurnRepositoryOptions = {}) {}

  readonly mutationCalls: string[] = [];

  readonly operationOrder: string[] = [];

  readonly calls: {
    clinicCode?: string;
    contact?: GetOrCreateRuntimeContactInput;
    inboundEvent?: RegisterInboundEventInput;
    message?: SaveInboundUserMessageInput;
    outboundMessage?: SaveOutboundAssistantMessageInput;
    convoState?: LoadOrInitConvoStateInput;
    cases?: { clinicId: string; contactId: string };
    activeHold?: { clinicId: string; contactId: string; caseId: string | null };
    latestAppointment?: { clinicId: string; contactId: string; caseId: string | null };
    notification?: CreateAdminNotificationInput;
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
      settings: this.options.notificationSettings ?? (this.options.adminRecipient === undefined
        ? {}
        : { admin_telegram_chat_id: this.options.adminRecipient }),
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
    this.operationOrder.push('saveInboundUserMessage');

    return {
      id: '44444444-4444-4444-4444-444444444444',
    };
  }

  async saveOutboundAssistantMessage(input: SaveOutboundAssistantMessageInput) {
    this.calls.outboundMessage = input;
    this.operationOrder.push('saveOutboundAssistantMessage');

    if (this.options.failOutboundPersistence === true) {
      throw new Error('outbound insert failed');
    }

    return {
      id: '77777777-7777-7777-7777-777777777777',
    };
  }

  async createAdminNotification(input: CreateAdminNotificationInput) {
    this.calls.notification = input;
    this.operationOrder.push('createAdminNotification');
    this.mutationCalls.push('createAdminNotification');

    if (this.options.failNotificationPersistence === true) {
      throw new Error('notification insert failed');
    }

    return {
      notification_id: '88888888-8888-8888-8888-888888888888',
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

class FakeBookingApplyService {
  constructor(private readonly response: BookingApplyResponse) {}

  readonly calls: BookingApplyRequest[] = [];

  async apply(request: BookingApplyRequest): Promise<BookingApplyResponse> {
    this.calls.push(request);
    return this.response;
  }
}

function noBookingResponse(): BookingApplyResponse {
  return {
    booking_action: 'none',
    booking_status: 'none',
    should_notify_admin: false,
    reason: 'no_booking_action',
  };
}

function awaitingConfirmationResponse(overrides: {
  startAt?: string;
  endAt?: string;
  label?: string;
} = {}): BookingApplyResponse {
  return {
    booking_action: 'propose_slot',
    booking_status: 'awaiting_patient_confirmation',
    hold_id: 'hold-key-1',
    appointment_id: '66666666-6666-6666-6666-666666666666',
    proposed_slot: {
      start_at: overrides.startAt ?? '2026-05-16T07:00:00.000Z',
      end_at: overrides.endAt ?? '2026-05-16T07:30:00.000Z',
      label: overrides.label ?? '16.05.2026, 09:00',
      cell_range: 'C4',
      sheet_name: 'Графік',
      service_interest: 'консультация',
    },
    proposed_slots: [],
    should_notify_admin: false,
    reason: 'slot_proposed',
  };
}

function noSlotsResponse(): BookingApplyResponse {
  return {
    booking_action: 'propose_slot',
    booking_status: 'no_slots',
    proposed_slot: null,
    proposed_slots: [],
    should_notify_admin: false,
    reply_text_override: 'Свободных слотов по вашему запросу сейчас не нашёл. Подскажите другой день или время.',
    reason: 'no_slots_available',
  };
}


function externalWriteFailedResponse(): BookingApplyResponse {
  return {
    booking_action: 'confirm_slot',
    booking_status: 'external_write_failed',
    appointment_id: '66666666-6666-6666-6666-666666666666',
    appointment: {
      appointment_id: '66666666-6666-6666-6666-666666666666',
      case_id: null,
      start_at: '2026-05-16T07:00:00.000Z',
      end_at: '2026-05-16T07:30:00.000Z',
      label: '16.05.2026, 09:00',
      cell_range: 'C4',
      sheet_name: 'Графік',
      service_interest: 'консультация',
      status: 'held',
    },
    should_notify_admin: true,
    reply_text_override: 'Не удалось автоматически подтвердить запись. Я передам администратору для ручной проверки.',
    reason: 'external_write_failed',
  };
}

function confirmedResponse(): BookingApplyResponse {
  return {
    booking_action: 'confirm_slot',
    booking_status: 'booked_pending_admin_confirmation',
    appointment_id: '66666666-6666-6666-6666-666666666666',
    appointment: {
      appointment_id: '66666666-6666-6666-6666-666666666666',
      case_id: null,
      start_at: '2026-05-16T07:00:00.000Z',
      end_at: '2026-05-16T07:30:00.000Z',
      label: '16.05.2026, 09:00',
      cell_range: 'C4',
      sheet_name: 'Графік',
      service_interest: 'консультация',
      status: 'patient_confirmed',
    },
    should_notify_admin: true,
    reason: 'appointment_confirmed',
  };
}

function cancelNotImplementedResponse(): BookingApplyResponse {
  return {
    booking_action: 'cancel_hold',
    booking_status: 'not_implemented',
    proposed_slot: null,
    proposed_slots: [],
    should_notify_admin: true,
    reply_text_override: 'Не удалось автоматически подтвердить запись. Я передам администратору для ручной проверки.',
    reason: 'cancel_hold_not_implemented',
  };
}

class ThrowingBookingApplyService {
  constructor(private readonly error: Error) {}

  readonly calls: BookingApplyRequest[] = [];

  async apply(request: BookingApplyRequest): Promise<BookingApplyResponse> {
    this.calls.push(request);
    throw this.error;
  }
}

class FakeRuntimeAIClient implements RuntimeAIClient {
  constructor(
    private readonly output: unknown,
    readonly provider?: string,
    readonly model?: string,
  ) {}

  readonly calls: RuntimeAIExtractionInput[] = [];

  async extract(input: RuntimeAIExtractionInput): Promise<RuntimeAIOutput> {
    this.calls.push(input);
    return this.output as RuntimeAIOutput;
  }
}


class ThrowingRuntimeAIClient implements RuntimeAIClient {
  constructor(
    private readonly error: Error,
    readonly provider?: string,
    readonly model?: string,
  ) {}

  async extract(): Promise<RuntimeAIOutput> {
    throw this.error;
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
