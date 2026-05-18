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
  SaveRuntimeStateInput,
} from '../../domain/runtime/runtimeTurnService.js';
import {
  NoopRuntimeAIClient,
  RUNTIME_AI_SAFE_FALLBACK_REPLY,
  type RuntimeAIClient,
  type RuntimeAIExtractionInput,
} from '../../domain/runtime/runtimeAiClient.js';
import { RuntimeAIProviderError } from '../../domain/runtime/openAiRuntimeClient.js';
import type { RuntimeAIOutput } from '../../domain/runtime/runtimeContracts.js';
import type { RuntimeEmbeddingClient } from '../../domain/runtime/runtimeEmbeddingClient.js';
import type { RuntimeKnowledgeRepository, RuntimeKnowledgeRetrieveInput, RuntimeKnowledgeResult } from '../../domain/runtime/runtimeKnowledgeRepository.js';
import type { RuntimeKnowledgeReplyComposer, RuntimeKnowledgeReplyComposerInput, RuntimeKnowledgeReplyComposerOutput } from '../../domain/runtime/runtimeKnowledgeReplyComposer.js';
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

const fixedClock = () => new Date('2026-05-17T12:00:00.000Z');


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
            availability_query: {
              search_type: 'nearest_available|specific_date|weekday|relative_day|exact_slot|time_constraint|unknown',
              date_iso: 'YYYY-MM-DD|null',
              weekday: 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|null',
              relative_day: 'today|tomorrow|day_after_tomorrow|null',
              time_window: {
                type: 'morning|afternoon|evening|before|after|between|any',
                start_time: 'HH:mm|null',
                end_time: 'HH:mm|null',
              },
              exact_time: 'HH:mm|null',
              flexibility: 'specific|flexible|nearest|unknown',
            },
            slot_selection: {
              selected_option_id: 'string|null',
              selected_start_at: 'ISO datetime string|null',
              selected_time: 'HH:mm|null',
              selection_confidence: 'high|medium|low|unknown',
            },
            booking: {
              preferred_date_iso: 'string|null',
              preferred_weekday: 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|null',
              time_of_day: 'morning|afternoon|evening|any|null',
              patient_confirmed_proposed_slot: 'boolean',
              patient_rejected_proposed_slot: 'boolean',
              selected_hold_id: 'string|null',
            },
            faq_topic: 'price|insurance|address|other|unknown',
            patient_scope: 'self|another_person|multiple_people|unknown',
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

  it('returns a compact duplicate response without AI, booking, outbound message, or side effects', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-20', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация' },
      booking: { preferred_date_iso: '2026-05-20', time_of_day: 'any' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingSlotChoiceResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService),
    });

    try {
      const firstResponse = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });
      const firstBody = firstResponse.json();

      expect(firstResponse.statusCode).toBe(200);
      expect(firstBody.debug.duplicate).toBe(false);
      expect(firstBody.reply_text).toContain('Есть несколько вариантов:');
      expect(aiClient.calls).toHaveLength(1);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(repository.calls.outboundMessage).toBeDefined();

      repository.operationOrder.length = 0;
      delete repository.calls.outboundMessage;
      const secondResponse = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });
      const secondBody = secondResponse.json();

      expect(secondResponse.statusCode).toBe(200);
      expect(secondBody).toMatchObject({
        reply_text: '',
        clinic_id: '11111111-1111-1111-1111-111111111111',
        contact_id: '22222222-2222-2222-2222-222222222222',
        case_id: null,
        booking_result: null,
        side_effects: [],
        debug: { duplicate: true },
      });
      expect(aiClient.calls).toHaveLength(1);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(repository.calls.outboundMessage).toBeUndefined();
      expect(repository.operationOrder).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('preserves inbound trace_id for duplicate compact responses when provided', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({ reply_draft: 'Первый ответ.' }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });
    const payload = {
      ...validPayload,
      meta: { ...validPayload.meta, trace_id: '99999999-9999-4999-9999-999999999999' },
    };

    try {
      await app.inject({ method: 'POST', url: '/runtime/turn', payload });
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        trace_id: '99999999-9999-4999-9999-999999999999',
        reply_text: '',
        side_effects: [],
        debug: { duplicate: true },
      });
      expect(aiClient.calls).toHaveLength(1);
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

  it('does not call booking for FAQ AI output and blocks ungrounded AI draft', async () => {
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
        reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
        booking_result: null,
        side_effects: [],
        debug: {
          reply_source: 'safe_fallback',
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


  it('asks for service and saves pending_clarification when price FAQ lacks service_interest', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
    }));
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, fixedClock),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Какие цены в клинике?' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.',
        booking_result: null,
        debug: {
          conversation_mode: 'faq_price',
          policy_decision: { should_call_booking: false, reason: 'price_faq_missing_service_interest' },
          runtime_state_saved: {
            pending_clarification: {
              type: 'faq',
              faq_topic: 'price',
              missing_slot: 'service_interest',
              trace_id: expect.any(String),
            },
          },
        },
      });
      expect(repository.calls.savedState?.state.runtime).toMatchObject({
        pending_clarification: {
          type: 'faq',
          faq_topic: 'price',
          missing_slot: 'service_interest',
          created_at: '2026-05-17T12:00:00.000Z',
          trace_id: expect.any(String),
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('answers pending price FAQ from KB for the next service-only message and clears pending_clarification without booking', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: pendingPriceFaqState() });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      slot_updates: { service_interest: 'чистка зубов' },
      reply_draft: 'Подскажите удобный день и время.',
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        fixedClock,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.9,
          context_text: 'RU: Чистка зубов стоит от 1200 Kč.',
          snippets: [{ title: 'Cleaning price', content: 'RU: Чистка зубов стоит от 1200 Kč.', metadata: { source_type: 'faq' }, score: 0.9, source_type: 'faq' }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'чистка зубов' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Чистка зубов стоит от 1200 Kč.',
        booking_result: null,
        debug: {
          conversation_mode: 'faq_price',
          reply_source: 'kb',
          pending_clarification: { status: 'completed' },
          runtime_state_saved: { pending_clarification: null, pending_clarification_cleared: true },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
      expect(repository.calls.savedState?.state.runtime.pending_clarification).toBeUndefined();
      expect(repository.calls.savedState?.state.runtime).toMatchObject({
        pending_clarification_cleared_trace_id: expect.any(String),
        pending_clarification_cleared_at: '2026-05-17T12:00:00.000Z',
      });
    } finally {
      await app.close();
    }
  });

  it('returns price unavailable for pending price FAQ when KB reply has no price signal and clears pending without booking', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: pendingPriceFaqState() });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      slot_updates: { service_interest: 'чистка зубов' },
      reply_draft: 'Подскажите удобный день и время.',
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        fixedClock,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.9,
          context_text: 'RU: Гигиена.',
          snippets: [{ title: 'Cleaning category', content: 'RU: Гигиена.', metadata: { source_type: 'faq' }, score: 0.9, source_type: 'faq' }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'чистка зубов' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'По этой услуге точную стоимость лучше уточнит администратор. Могу передать запрос администратору.',
        booking_result: null,
        debug: {
          conversation_mode: 'faq_price',
          reply_source: 'safe_fallback',
          price_answer_quality: { accepted: false, reason: 'no_price_signal' },
          pending_clarification: { status: 'completed' },
          runtime_state_saved: { pending_clarification: null, pending_clarification_cleared: true },
        },
      });
      expect(response.json().reply_text).not.toBe('Гигиена.');
      expect(bookingApplyService.calls).toEqual([]);
      expect(repository.calls.savedState?.state.runtime.pending_clarification).toBeUndefined();
    } finally {
      await app.close();
    }
  });


  it('persists service memory after pending price FAQ completion', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: pendingPriceFaqState() });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      slot_updates: { service_interest: 'чистка зубов' },
      reply_draft: 'Подскажите удобный день и время.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        new FakeBookingApplyService(awaitingConfirmationResponse()),
        fixedClock,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.9,
          context_text: 'RU: Чистка зубов стоит от 1200 Kč.',
          snippets: [{ title: 'Cleaning price', content: 'RU: Чистка зубов стоит от 1200 Kč.', metadata: { source_type: 'faq' }, score: 0.9, source_type: 'faq' }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'чистка зубов' } });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body.debug.case_memory_after.cases[0].collected.service_interest).toMatchObject({
        value: 'чистка зубов',
        source: 'faq_price_followup',
        updated_at: '2026-05-17T12:00:00.000Z',
        trace_id: expect.any(String),
      });
      expect(repository.calls.savedState?.state.runtime.case_memory.cases[0].collected.service_interest.value).toBe('чистка зубов');
    } finally {
      await app.close();
    }
  });

  it('uses remembered price FAQ service for a later availability question without asking service again', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: pendingPriceFaqState() });
    const aiClient = new FakeRuntimeAIClient([
      validAIOutput({
        conversation_intent: 'booking',
        requested_action: 'ask_slot',
        slot_updates: { service_interest: 'чистка зубов' },
        reply_draft: 'Подскажите удобный день и время.',
      }),
      validAIOutput({
        conversation_intent: 'availability_request',
        requested_action: 'check_availability',
        availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-18', flexibility: 'specific' }),
        booking: { preferred_date_iso: '2026-05-18', time_of_day: 'any' },
      }),
    ]);
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        fixedClock,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.9,
          context_text: 'RU: Чистка зубов стоит от 1200 Kč.',
          snippets: [{ title: 'Cleaning price', content: 'RU: Чистка зубов стоит от 1200 Kč.', metadata: { source_type: 'faq' }, score: 0.9, source_type: 'faq' }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'чистка зубов', meta: { ...validPayload.meta, message_id: '1271', update_id: 464427368 } } });
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'на 18 число какие у вас слоты есть?', meta: { ...validPayload.meta, message_id: '1272', update_id: 464427369 } } });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({
        serviceInterest: 'чистка зубов',
        preferredDateIso: '2026-05-18',
      });
      expect(body.reply_text).not.toContain('какую услугу');
      expect(body.debug.resolved_turn_context).toMatchObject({
        ai_service_interest: null,
        memory_service_interest: 'чистка зубов',
        resolved_service_interest: 'чистка зубов',
        service_interest_source: 'case_memory',
      });
      expect(body.debug.ai_output.slot_updates.service_interest).toBe('чистка зубов');
    } finally {
      await app.close();
    }
  });

  it('lets current explicit service override service memory', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: caseMemoryState('чистка зубов') });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-18', flexibility: 'specific' }),
      slot_updates: { service_interest: 'имплантация' },
      booking: { preferred_date_iso: '2026-05-18', time_of_day: 'any' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, fixedClock) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });
      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0].serviceInterest).toBe('имплантация');
      expect(response.json().debug.resolved_turn_context).toMatchObject({
        memory_service_interest: 'чистка зубов',
        resolved_service_interest: 'имплантация',
        service_interest_source: 'ai',
      });
    } finally {
      await app.close();
    }
  });

  it('does not use service memory for a pure FAQ turn', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: caseMemoryState('чистка зубов') });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'address',
      reply_draft: 'Мы находимся в центре.',
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, fixedClock) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'где вы находитесь?' } });
      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toEqual([]);
      expect(response.json().debug.resolved_turn_context).toMatchObject({
        resolved_service_interest: null,
        service_interest_source: 'none',
      });
    } finally {
      await app.close();
    }
  });

  it('persists booking service memory and asks for datetime', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      slot_updates: { service_interest: 'чистка зубов' },
      reply_draft: 'Подскажите дату.',
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, fixedClock) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'хочу записаться на чистку' } });
      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toEqual([]);
      expect(body.debug.policy_decision.reason).toBe('booking_interest_missing_datetime');
      expect(body.debug.case_memory_after.cases[0].collected.service_interest).toMatchObject({ value: 'чистка зубов', source: 'booking_turn' });
      expect(body.debug.case_memory_after.cases[0].last_assistant_question).toMatchObject({ slot: 'preferred_datetime', topic: 'booking' });
    } finally {
      await app.close();
    }
  });

  it('mirrors proposed slots into case_memory.proposed_slots', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-20', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация' },
      booking: { preferred_date_iso: '2026-05-20', time_of_day: 'any' },
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, new FakeBookingApplyService(awaitingSlotChoiceResponse()), fixedClock) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });
      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.debug.case_memory_after.cases[0].proposed_slots).toHaveLength(3);
      expect(body.debug.case_memory_after.cases[0].status).toBe('awaiting_slot_choice');
      expect(repository.calls.savedState?.state.runtime.case_memory.cases[0].proposed_slots).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it('mirrors pending price clarification into last_assistant_question', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, new FakeBookingApplyService(noBookingResponse()), fixedClock) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'а цена какая?' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().debug.case_memory_after.cases[0].last_assistant_question).toMatchObject({
        purpose: 'collect_missing_slot',
        slot: 'service_interest',
        topic: 'price',
        asked_at: '2026-05-17T12:00:00.000Z',
        trace_id: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('keeps pending price clarification and asks service again when no service_interest is extracted', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: pendingPriceFaqState() });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'unknown',
      requested_action: 'clarify',
      reply_draft: 'Не понял.',
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, fixedClock),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'не знаю' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.',
        debug: { policy_decision: { reason: 'pending_price_faq_missing_service_interest' } },
      });
      expect(bookingApplyService.calls).toEqual([]);
      expect(repository.calls.savedState?.state.runtime.pending_clarification).toMatchObject({
        type: 'faq',
        faq_topic: 'price',
        missing_slot: 'service_interest',
        created_at: '2026-05-16T10:00:00.000Z',
      });
    } finally {
      await app.close();
    }
  });

  it('treats short price follow-up with no known service as a pending FAQ clarification instead of asking day/time', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      faq_topic: 'price',
      reply_draft: 'Подскажите удобный день и время.',
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, fixedClock),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'а цена какая?' } });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toBe('Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.');
      expect(response.json().reply_text).not.toBe('Подскажите, пожалуйста, удобный день и время.');
      expect(repository.calls.savedState?.state.runtime.pending_clarification).toMatchObject({
        type: 'faq',
        faq_topic: 'price',
        missing_slot: 'service_interest',
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('answers direct price question with extracted service_interest without asking service again or booking', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      slot_updates: { service_interest: 'чистка' },
      reply_draft: 'Вигадана ціна 999 Kč.',
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        fixedClock,
        new FakeRuntimeKnowledgeRepository({ found: false, count: 0, top_similarity: null, context_text: null, snippets: [] }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Сколько стоит чистка?' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'По этой услуге точную стоимость лучше уточнит администратор. Могу передать запрос администратору.',
        booking_result: null,
        debug: { conversation_mode: 'faq_price', reply_source: 'safe_fallback' },
      });
      expect(response.json().reply_text).not.toBe('Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.');
      expect(bookingApplyService.calls).toEqual([]);
      expect(repository.calls.savedState?.state.runtime.case_memory.cases[0].collected.service_interest).toMatchObject({
        value: 'чистка',
        source: 'ai',
      });
    } finally {
      await app.close();
    }
  });

  it('uses KB context for grounded FAQ price replies and blocks invented AI prices', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      slot_updates: { service_interest: 'hygiene' },
      reply_draft: 'Вигадана ціна 999 Kč.',
    }));
    const embeddingClient = new FakeRuntimeEmbeddingClient(makeEmbedding());
    const knowledgeRepository = new FakeRuntimeKnowledgeRepository({
      found: true,
      count: 1,
      top_similarity: 0.82,
      context_text: 'Професійна гігієна коштує від 1200 грн.',
      snippets: [{
        title: 'Hygiene price',
        content: 'Професійна гігієна коштує від 1200 грн.',
        metadata: { source_type: 'faq' },
        score: 0.82,
        source_type: 'faq',
      }],
    });
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        knowledgeRepository,
        embeddingClient,
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Скільки коштує гігієна?', meta: { ...validPayload.meta, language_code: 'uk' } } });
      const expectedKnowledgeQuery = [
        'faq_topic: price',
        'service_interest: hygiene',
        'question: Скільки коштує гігієна?',
        'language: uk',
      ].join('\n');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Професійна гігієна коштує від 1200 грн.',
        debug: {
          reply_source: 'kb',
          kb_query: {
            query_text: expectedKnowledgeQuery,
          },
          kb_result: {
            found: true,
            count: 1,
            top_similarity: 0.82,
          },
        },
      });
      expect(embeddingClient.calls).toEqual([{ text: expectedKnowledgeQuery, trace_id: expect.any(String) }]);
      expect(knowledgeRepository.calls[0]).toMatchObject({
        clinicId: '11111111-1111-1111-1111-111111111111',
        queryEmbedding: makeEmbedding(),
      });
    } finally {
      await app.close();
    }
  });


  it('does not return raw multi-language KB context and composes concise Russian price answer', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      slot_updates: { service_interest: 'hygiene' },
      reply_draft: 'Вигадана ціна 999 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 2,
          top_similarity: 0.91,
          context_text: '[1] chunk\nUK: Професійна гігієна коштує від 1200 Kč.\nRU: Профессиональная гигиена стоит от 1200 Kč.\nEN: Hygiene starts from 1200 Kč.',
          snippets: [{ title: 'Price', content: 'RU: Профессиональная гигиена стоит от 1200 Kč.', metadata: { source_type: 'faq' }, score: 0.91, source_type: 'faq' }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Сколько стоит гигиена?', meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Профессиональная гигиена стоит от 1200 Kč.',
        debug: { reply_source: 'kb', response_language: 'ru', kb_reply_composer: { provider: 'deterministic', language: 'ru', used: true } },
      });
      expect(response.json().reply_text).not.toContain('[1]');
      expect(response.json().reply_text).not.toContain('UK:');
      expect(response.json().reply_text).not.toContain('EN:');
      expect(response.json().reply_text).not.toContain('999');
    } finally {
      await app.close();
    }
  });

  it('falls back to deterministic KB cleaner when KB composer fails without AI invention', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      slot_updates: { service_interest: 'консультация' },
      reply_draft: 'Вигадана ціна 999 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.8,
          context_text: '[1] chunk\nRU: В прайсе указано: бесплатная консультация при дальнейшем лечении.',
          snippets: [{ title: 'Price fallback', content: 'RU: В прайсе указано: бесплатная консультация при дальнейшем лечении.', metadata: { source_type: 'faq' }, score: 0.8, source_type: 'faq' }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
        new ThrowingRuntimeKnowledgeReplyComposer(new Error('composer down')),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Сколько стоит консультация?', meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'В прайсе указано: бесплатная консультация при дальнейшем лечении.',
        debug: {
          reply_source: 'kb',
          kb_reply_composer_error: { message: 'Runtime KB reply composer failed; using deterministic KB fallback.' },
          kb_reply_composer: { provider: 'deterministic', language: 'ru', used: true },
        },
      });
      expect(response.json().reply_text).not.toContain('999');
      expect(response.json().reply_text).not.toContain('[1]');
    } finally {
      await app.close();
    }
  });

  it('answers direct price question from valid KB even when AI missed service_interest without saving pending', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      reply_draft: 'Какую услугу уточнить?',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        fixedClock,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.88,
          context_text: 'RU: В прайсе указано: бесплатная консультация при дальнейшем лечении.',
          snippets: [{ title: 'Consultation price', content: 'RU: В прайсе указано: бесплатная консультация при дальнейшем лечении.', metadata: { source_type: 'faq' }, score: 0.88, source_type: 'faq' }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Сколько стоит консультация?' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'В прайсе указано: бесплатная консультация при дальнейшем лечении.',
        booking_result: null,
        debug: {
          conversation_mode: 'faq_price',
          reply_source: 'kb',
          kb_query: {
            query_text: [
              'faq_topic: price',
              'service_interest: unknown',
              'question: Сколько стоит консультация?',
              'language: ru',
            ].join('\n'),
          },
          price_answer_quality: { accepted: true, reason: 'explicit_free' },
        },
      });
      expect(response.json().reply_text).not.toBe('Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.');
      expect(repository.calls.savedState).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('falls back safely when KB has no price hit instead of using AI factual price', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      reply_draft: 'Вигадана ціна 999 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        new FakeRuntimeKnowledgeRepository({
          found: false,
          count: 0,
          top_similarity: null,
          context_text: null,
          snippets: [],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.',
        debug: {
          reply_source: 'policy',
          policy_decision: { reason: 'price_faq_missing_service_interest' },
          runtime_state_saved: { pending_clarification: { type: 'faq', faq_topic: 'price', missing_slot: 'service_interest' } },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('falls back safely when KB retrieval fails', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      reply_draft: 'Вигадана ціна 999 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        new ThrowingRuntimeKnowledgeRepository(new Error('KB down')),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.',
        debug: {
          reply_source: 'policy',
          policy_decision: { reason: 'price_faq_missing_service_interest' },
          runtime_state_saved: { pending_clarification: { type: 'faq', faq_topic: 'price', missing_slot: 'service_interest' } },
        },
      });
    } finally {
      await app.close();
    }
  });


  it('keeps booking_result authoritative over KB retrieval', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'propose_slot',
      faq_topic: 'price',
      reply_draft: 'AI draft must not win.',
      booking: { preferred_date_iso: '2026-05-18', time_of_day: 'any' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse({ label: '18.05.2026, 09:00' }));
    const knowledgeRepository = new ThrowingRuntimeKnowledgeRepository(new Error('KB must not be called'));
    const embeddingClient = new FakeRuntimeEmbeddingClient(makeEmbedding());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        bookingApplyService,
        undefined,
        knowledgeRepository,
        embeddingClient,
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Есть свободное время 18.05.2026, 09:00. Подтверждаем?',
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        debug: { reply_source: 'booking_result' },
      });
      expect(embeddingClient.calls).toEqual([]);
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
        reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
        side_effects: [],
        debug: {
          reply_source: 'safe_fallback',
          outbound_message_id: '77777777-7777-7777-7777-777777777777',
        },
      });
      expect(repository.operationOrder).toEqual(['saveInboundUserMessage', 'saveOutboundAssistantMessage']);
      expect(repository.calls.outboundMessage).toMatchObject({
        clinicId: '11111111-1111-1111-1111-111111111111',
        contactId: '22222222-2222-2222-2222-222222222222',
        caseId: null,
        channel: 'telegram',
        text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
        replyToMessageId: '44444444-4444-4444-4444-444444444444',
        meta: {
          source: 'runtime_turn',
          reply_source: 'safe_fallback',
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
        preferred_date_iso: '2026-05-18',
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
        reply_text: 'Есть свободное время 18.05.2026, 09:00. Подтверждаем?',
        side_effects: [],
        debug: {
          reply_source: 'booking_result',
          outbound_message_id: '77777777-7777-7777-7777-777777777777',
        },
      });
      expect(repository.calls.outboundMessage).toMatchObject({
        caseId: '55555555-5555-5555-5555-555555555555',
        text: 'Есть свободное время 18.05.2026, 09:00. Подтверждаем?',
        meta: {
          source: 'runtime_turn',
          reply_source: 'booking_result',
          prompt_version: 'runtime-ai-extraction-v1',
          policy_decision: {
            reason: 'availability_specific_date_from_legacy_booking',
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
        reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
        side_effects: [],
        debug: {
          reply_source: 'safe_fallback',
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
      expect(response.json().reply_text).toContain('день и время');
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
        preferred_date_iso: '2026-05-18',
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
        bookingAction: 'propose_options',
        serviceInterest: 'консультация',
        preferredDateIso: '2026-05-18',
        timeOfDay: 'morning',
        patientName: 'Light',
        channel: 'telegram',
      });
      expect(response.json()).toMatchObject({
        reply_text: 'Есть свободное время 18.05.2026, 09:00. Подтверждаем?',
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        side_effects: [],
        debug: {
          reply_source: 'booking_result',
          policy_decision: { should_call_booking: true, reason: 'availability_specific_date_from_legacy_booking' },
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
        bookingAction: 'propose_options',
        preferredDateIso: '2026-05-12',
        preferredWeekday: null,
        timeOfDay: 'any',
      });
      expect(response.json()).toMatchObject({
        reply_text: 'Есть свободное время 12.05.2026, 09:00. Подтверждаем?',
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
            reason: 'availability_query_unknown',
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
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        debug: {
          reply_source: 'booking_result',
          date_normalization: {
            source: 'none',
            after: {
              preferred_date_iso: null,
              preferred_weekday: null,
              time_of_day: 'morning',
            },
          },
          policy_decision: {
            should_call_booking: true,
            reason: 'availability_time_constraint_from_legacy_booking',
          },
        },
      });
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({ timeOfDay: 'morning' });
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
        preferred_date_iso: '2026-05-18',
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
        reply_text: 'Есть свободное время 18.05.2026, 09:00. Подтверждаем?',
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        side_effects: [],
        debug: {
          reply_source: 'booking_result',
          policy_decision: {
            should_call_booking: true,
            reason: 'availability_weekday_from_legacy_booking',
          },
        },
      });
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({ preferredDateIso: '2026-05-18', preferredWeekday: 'monday' });
    } finally {
      await app.close();
    }
  });



  it('calls booking for nearest availability query with service', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'nearest_available', flexibility: 'nearest' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'когда есть свободно?' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'propose_options',
        serviceInterest: 'консультация',
        preferredDateIso: null,
        timeOfDay: 'any',
        metadata: {
          availability_query: { search_type: 'nearest_available' },
          current_time_iso: '2026-05-17T10:00:00.000Z',
          search_window_days: 14,
          proposal_step_minutes: 60,
          max_options: 3,
          proposal_strategy: 'nearest',
        },
      });
      expect(response.json()).toMatchObject({
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        debug: { reply_source: 'booking_result', policy_decision: { reason: 'availability_nearest_available' } },
      });
    } finally {
      await app.close();
    }
  });

  it('calls booking for typed Saturday availability with resolved clinic-local date', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'weekday', weekday: 'saturday' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-12T10:00:00.000Z')),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'на субботу' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ preferredDateIso: '2026-05-16', preferredWeekday: 'saturday' });
    } finally {
      await app.close();
    }
  });

  it('calls booking for typed before-10 availability and preserves time constraint metadata', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const timeWindow = { type: 'before' as const, start_time: null, end_time: '10:00' };
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'time_constraint', time_window: timeWindow }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'до 10' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({
        timeOfDay: 'morning',
        preferredTimeWindow: { startTime: null, endTime: '10:00' },
        metadata: { time_window: timeWindow },
      });
    } finally {
      await app.close();
    }
  });

  it('passes exact_slot exactTime as an enforceable booking field', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-18', exact_time: '14:00' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: '12.05 на 14:00' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'propose_slot',
        preferredDateIso: '2026-05-18',
        exactTime: '14:00',
        metadata: { exact_time: '14:00', policy_action: 'propose_slot' },
      });
      expect(response.json().booking_result).toMatchObject({ booking_status: 'awaiting_patient_confirmation' });
      expect(repository.calls.savedState).toBeUndefined();
    } finally {
      await app.close();
    }
  });


  it('does not call booking for past exact_slot and asks for a future date', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-12', exact_time: '14:00' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Хочу на консультацию 12.05 на 14:00', meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        reply_text: 'Эта дата уже прошла. Напишите, пожалуйста, будущую дату и время.',
        debug: { reply_source: 'policy', policy_decision: { should_call_booking: false, reason: 'exact_slot_date_in_past' } },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('does not call booking for past exact_slot when AI requested_action is clarify', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'clarify',
      confidence: 'low',
      reply_draft: 'Подскажите, пожалуйста, чем можем помочь — записью или вопросом по клинике?',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-16', exact_time: '08:00', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация стоматолога' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Хочу записаться на консультацию стоматолога 16.05 на 08:00', meta: { ...validPayload.meta, language_code: 'ru' } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        reply_text: 'Эта дата уже прошла. Напишите, пожалуйста, будущую дату и время.',
        debug: { reply_source: 'policy', policy_decision: { next_action: 'ask_preferred_datetime', should_call_booking: false, reason: 'exact_slot_date_in_past' } },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });


  it('normalizes missing exact_slot date from numeric day-month text and returns past-date policy reply', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'clarify',
      confidence: 'low',
      reply_draft: 'Подскажите, пожалуйста, чем можем помочь — записью или вопросом по клинике?',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: null, exact_time: '08:00', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация стоматолога' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Хочу записаться на консультацию стоматолога 16.05 на 08:00', meta: { ...validPayload.meta, language_code: 'ru' } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        reply_text: 'Эта дата уже прошла. Напишите, пожалуйста, будущую дату и время.',
        debug: {
          ai_output: { availability_query: { date_iso: '2026-05-16', exact_time: '08:00' } },
          date_normalization: { source: 'user_text_explicit_date', after: { availability_date_iso: '2026-05-16' } },
          reply_source: 'policy',
          policy_decision: { next_action: 'ask_preferred_datetime', should_call_booking: false, reason: 'exact_slot_date_in_past' },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('normalizes future numeric day-month exact_slot text and calls booking propose_slot', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'clarify',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: null, exact_time: '08:00', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация стоматолога' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Хочу записаться на консультацию стоматолога 23.05 на 08:00' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'propose_slot',
        serviceInterest: 'консультация стоматолога',
        preferredDateIso: '2026-05-23',
        exactTime: '08:00',
      });
      expect(response.json()).toMatchObject({
        booking_result: { booking_status: 'awaiting_patient_confirmation' },
        debug: { ai_output: { availability_query: { date_iso: '2026-05-23', exact_time: '08:00' } }, policy_decision: { reason: 'availability_exact_slot' } },
      });
    } finally {
      await app.close();
    }
  });

  it('ignores invalid numeric day-month exact_slot text and keeps existing missing-date clarification', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'clarify',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: null, exact_time: '08:00', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация стоматолога' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Хочу записаться на консультацию стоматолога 32.05 на 08:00' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        debug: {
          ai_output: { availability_query: { date_iso: null, exact_time: '08:00' } },
          date_normalization: { source: 'none', after: { availability_date_iso: null } },
          reply_source: 'policy',
          policy_decision: { should_call_booking: false, reason: 'exact_slot_missing_date' },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('normalizes yearful numeric exact_slot text with missing AI date', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'clarify',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: null, exact_time: '08:00', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация стоматолога' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Хочу записаться на консультацию стоматолога 16.05.2026 на 08:00', meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Эта дата уже прошла. Напишите, пожалуйста, будущую дату и время.',
        debug: { ai_output: { availability_query: { date_iso: '2026-05-16', exact_time: '08:00' } }, policy_decision: { reason: 'exact_slot_date_in_past' } },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('does not call booking for past specific date when AI requested_action is check_availability', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-16', flexibility: 'specific' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingSlotChoiceResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Можно записаться 16.05?', meta: { ...validPayload.meta, language_code: 'ru' } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        reply_text: 'Эта дата уже прошла. Напишите, пожалуйста, будущую дату и время.',
        debug: { reply_source: 'policy', policy_decision: { next_action: 'ask_preferred_datetime', should_call_booking: false, reason: 'date_in_past' } },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('still calls booking for a future exact_slot with exactTime', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-18', exact_time: '14:00' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService, () => new Date('2026-05-17T10:00:00.000Z')) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Хочу на консультацию 18.05 на 14:00' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'propose_slot', preferredDateIso: '2026-05-18', exactTime: '14:00' });
      expect(response.json().booking_result).toMatchObject({ booking_status: 'awaiting_patient_confirmation' });
      expect(repository.calls.savedState).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('does not call booking when exact_slot exact_time is invalid', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-18', exact_time: '14.00' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: '12.05 на 14.00' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        debug: {
          reply_source: 'policy',
          policy_decision: { should_call_booking: false, reason: 'exact_slot_invalid_time' },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('asks clarification for unknown availability query without calling booking', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: { service_interest: 'консультация' } })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'unknown' }),
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'а другой час?' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        debug: { reply_source: 'policy', policy_decision: { reason: 'availability_query_unknown' } },
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
        preferred_date_iso: '2026-05-18',
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
        reply_text: 'Подскажите, пожалуйста, на какую услугу или консультацию хотите записаться?',
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


  it('returns Russian missing-service availability reply when language_code is ru', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: {} })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      booking: { preferred_date_iso: '2026-05-18', preferred_weekday: null, time_of_day: 'any', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, на какую услугу или консультацию хотите записаться?',
        booking_result: null,
        debug: { response_language: 'ru', policy_decision: { reason: 'missing_service_for_availability' } },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns Ukrainian missing-service availability reply when language_code is uk', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase({ collected: {} })] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      booking: { preferred_date_iso: '2026-05-18', preferred_weekday: null, time_of_day: 'any', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, meta: { ...validPayload.meta, language_code: 'uk' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Підкажіть, будь ласка, на яку послугу або консультацію хочете записатися?',
        booking_result: null,
        debug: { response_language: 'uk', policy_decision: { reason: 'missing_service_for_availability' } },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('uses Russian safe fallback when language_code is ru', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient({ invalid: true });
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, чем можем помочь — записью или вопросом по клинике?',
        debug: { response_language: 'ru', reply_source: 'policy' },
      });
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
      expect(response.json().reply_text).toContain('это время не используем');
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
        preferred_date_iso: '2026-05-18',
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


  it('builds natural booking-interest reply without calling booking', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      reply_draft: 'Invalid booking request.',
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
        payload: { ...validPayload, text: 'можно записаться?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, удобный день и время.',
        booking_result: null,
        side_effects: [],
        debug: {
          conversation_mode: 'booking_interest',
          reply_source: 'policy',
          policy_decision: { reason: 'booking_interest_missing_datetime' },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('classifies price FAQ and blocks ungrounded AI price reply', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      reply_draft: 'Консультація коштує 500 Kč.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'скільки коштує консультація?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.',
        booking_result: null,
        side_effects: [],
        debug: { conversation_mode: 'faq_price', reply_source: 'policy' },
      });
    } finally {
      await app.close();
    }
  });

  it('returns address reply and prepares telegram location_packet side_effect', async () => {
    const repository = new FakeRuntimeTurnRepository({
      notificationSettings: {
        location_packet: {
          address: 'Praha 1, Dlouhá 10',
          maps_url: 'https://maps.example/clinic-one',
          photo_keys: ['clinic-front'],
        },
      },
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'address',
      reply_draft: null,
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'скиньте адресу і геолокацію' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Адреса клініки: Praha 1, Dlouhá 10.\nМапа: https://maps.example/clinic-one',
        booking_result: null,
        side_effects: [{
          type: 'location_packet',
          channel: 'telegram',
          address: 'Praha 1, Dlouhá 10',
          maps_url: 'https://maps.example/clinic-one',
          photo_keys: ['clinic-front'],
        }],
        debug: { conversation_mode: 'faq_address', reply_source: 'policy' },
      });
      expect(repository.calls.notification).toBeUndefined();
    } finally {
      await app.close();
    }
  });


  it('does not return AI draft with fake address when faq_address lacks location_packet and KB', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'address',
      reply_draft: 'Ми на Fake Street 123.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'яка у вас адреса?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, по какому филиалу или адресу сориентировать?',
        side_effects: [],
        debug: { conversation_mode: 'faq_address', reply_source: 'safe_fallback' },
      });
    } finally {
      await app.close();
    }
  });

  it('uses KB text and still returns location_packet for faq_address when both are available', async () => {
    const repository = new FakeRuntimeTurnRepository({
      notificationSettings: {
        location_packet: {
          address: 'Praha 1, Dlouhá 10',
          maps_url: 'https://maps.example/clinic-one',
          photo_keys: ['clinic-front'],
        },
      },
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'address',
      reply_draft: 'AI address should not win.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.9,
          context_text: 'Клініка знаходиться біля метро, вхід з двору.',
          snippets: [{
            title: 'Address details',
            content: 'Клініка знаходиться біля метро, вхід з двору.',
            metadata: { source_type: 'faq' },
            score: 0.9,
            source_type: 'faq',
          }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'де ви знаходитесь?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Клініка знаходиться біля метро, вхід з двору.',
        side_effects: [{
          type: 'location_packet',
          channel: 'telegram',
          address: 'Praha 1, Dlouhá 10',
          maps_url: 'https://maps.example/clinic-one',
          photo_keys: ['clinic-front'],
        }],
        debug: { conversation_mode: 'faq_address', reply_source: 'kb' },
      });
    } finally {
      await app.close();
    }
  });

  it('uses KB for faq_topic other answer_faq replies', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'other',
      reply_draft: 'AI factual draft should not win.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        new FakeRuntimeKnowledgeRepository({
          found: true,
          count: 1,
          top_similarity: 0.84,
          context_text: 'Після відбілювання не рекомендуємо каву протягом 48 годин.',
          snippets: [{
            title: 'Whitening aftercare',
            content: 'Після відбілювання не рекомендуємо каву протягом 48 годин.',
            metadata: { source_type: 'faq' },
            score: 0.84,
            source_type: 'faq',
          }],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'чи можна каву після відбілювання?' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Після відбілювання не рекомендуємо каву протягом 48 годин.',
        debug: { reply_source: 'kb' },
      });
    } finally {
      await app.close();
    }
  });

  it('does not return AI draft for faq_topic other answer_faq without KB', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'other',
      reply_draft: 'Ми точно робимо вигадану процедуру.',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(
        repository,
        aiClient,
        undefined,
        undefined,
        new FakeRuntimeKnowledgeRepository({
          found: false,
          count: 0,
          top_similarity: null,
          context_text: null,
          snippets: [],
        }),
        new FakeRuntimeEmbeddingClient(makeEmbedding()),
      ),
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'ви робите вигадану процедуру?' } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
        debug: { reply_source: 'safe_fallback', kb_result: { found: false, count: 0 } },
      });
    } finally {
      await app.close();
    }
  });

  it('keeps booked patient context when asking price FAQ after booking', async () => {
    const latestAppointment = makeAppointment({ status: 'patient_confirmed' });
    const repository = new FakeRuntimeTurnRepository({ latestAppointment });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'price',
      reply_draft: 'Консультація коштує 500 Kč.',
    }));
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'а скільки коштує консультація?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Подскажите, пожалуйста, какая именно услуга интересует — сориентирую по стоимости.',
        booking_result: null,
        debug: {
          conversation_mode: 'faq_price',
          booking_context: { latest_appointment: { status: 'patient_confirmed' } },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('keeps booked patient context when asking address and returns location side_effect', async () => {
    const latestAppointment = makeAppointment({ status: 'patient_confirmed' });
    const repository = new FakeRuntimeTurnRepository({
      latestAppointment,
      notificationSettings: {
        address: 'Praha 2, Klinická 5',
        maps_url: 'https://maps.example/booked-patient',
      },
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      faq_topic: 'address',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'де ви знаходитесь?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        side_effects: [{ type: 'location_packet', address: 'Praha 2, Klinická 5' }],
        debug: {
          conversation_mode: 'faq_address',
          booking_context: { latest_appointment: { status: 'patient_confirmed' } },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('keeps booked patient context when asking another service question', async () => {
    const latestAppointment = makeAppointment({ status: 'patient_confirmed' });
    const repository = new FakeRuntimeTurnRepository({ latestAppointment });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      reply_draft: 'Так, чистку також робимо. Можемо зорієнтувати по доступних годинах окремо.',
    }));
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'а чистку ви робите?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Вашу запись вижу в контексте. Напишите, пожалуйста, какой именно вопрос — помогу или передам администратору.',
        booking_result: null,
        side_effects: [],
        debug: { conversation_mode: 'post_booking_question', reply_source: 'safe_fallback' },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('keeps active hold continuity for FAQ and does not confirm or cancel the hold', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'faq',
      requested_action: 'answer_faq',
      reply_draft: 'Так, консультація перед лікуванням доступна.',
    }));
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'а консультація перед цим буде?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Вашу запись вижу в контексте. Напишите, пожалуйста, какой именно вопрос — помогу или передам администратору.',
        booking_result: null,
        debug: {
          conversation_mode: 'post_booking_question',
          booking_context: { active_hold: { hold_id: 'hold-key-1' } },
        },
      });
      expect(bookingApplyService.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('detects multi-patient request and routes to admin without corrupting booking state', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold, adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'booking',
      requested_action: 'ask_slot',
      patient_scope: 'another_person',
      reply_draft: 'AI draft should not schedule another patient.',
    }));
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'хочу записать мужа' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: null,
        debug: { conversation_mode: 'multi_patient_request', reply_source: 'policy' },
        side_effects: [{ payload: { trigger: 'multi_patient_request', reason: 'multi_patient_requires_admin_coordination' } }],
      });
      expect(response.json().reply_text).toContain('отдельные записи');
      expect(bookingApplyService.calls).toEqual([]);
      expect(repository.calls.notification).toMatchObject({ recipient: '999-admin-chat' });
    } finally {
      await app.close();
    }
  });

  it('uses safe natural fallback wording without system-style booking errors', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient({ reply_draft: 'missing required fields' });
    const bookingApplyService = new FakeBookingApplyService(noBookingResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toBe(RUNTIME_AI_SAFE_FALLBACK_REPLY);
      expect(response.json().reply_text).not.toContain('Invalid booking request');
      expect(response.json().reply_text).not.toContain('Clarify preferred date');
      expect(bookingApplyService.calls).toEqual([]);
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
        preferred_date_iso: '2026-05-18',
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
            booking: { preferred_date_iso: '2026-05-18' },
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
              start_at: '2026-05-18T07:00:00.000Z',
              end_at: '2026-05-18T07:30:00.000Z',
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
              start_at: '2026-05-18T07:00:00.000Z',
              end_at: '2026-05-18T07:30:00.000Z',
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
              label: '18.05.2026, 09:00',
              start_at: '2026-05-18T07:00:00.000Z',
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
      booking: { preferred_date_iso: '2026-05-18', preferred_weekday: null, time_of_day: 'any', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
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
      booking: { preferred_date_iso: '2026-05-18', preferred_weekday: null, time_of_day: 'morning', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
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
      booking: { preferred_date_iso: '2026-05-18', preferred_weekday: null, time_of_day: 'any', patient_confirmed_proposed_slot: false, patient_rejected_proposed_slot: false, selected_hold_id: null },
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

  it('uses settings.admin_telegram_chat_id as the admin notification recipient', async () => {
    const repository = new FakeRuntimeTurnRepository({ notificationSettings: { admin_telegram_chat_id: 'direct-admin-chat' } });
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
      expect(response.json()).toMatchObject({ side_effects: [{ recipient: 'direct-admin-chat', payload: { trigger: 'ai_urgent_intent' } }] });
      expect(repository.calls.notification).toMatchObject({ recipient: 'direct-admin-chat' });
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
        reply_text: 'Запрос на запись 18.05.2026, 09:00 зафиксирован. Администратор проверит и подтвердит запись.',
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

  it('availability request returns awaiting_slot_choice options, persists runtime memory, and does not notify admin', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()], adminRecipient: '999-admin-chat' });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-20', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация' },
      booking: { preferred_date_iso: '2026-05-20', time_of_day: 'any' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingSlotChoiceResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        booking_result: { booking_action: 'propose_options', booking_status: 'awaiting_slot_choice' },
        side_effects: [],
      });
      expect(response.json().reply_text).toContain('Есть несколько вариантов:');
      expect(response.json().reply_text).toContain('1. 20.05.2026, 10:00');
      expect(response.json().reply_text).toContain('2. 20.05.2026, 12:30');
      expect(repository.calls.notification).toBeUndefined();
      expect(repository.calls.savedState?.state.runtime).toMatchObject({
        awaiting_slot_choice: true,
        last_proposed_slots: expect.arrayContaining([
          expect.objectContaining({ option_id: '1', start_at: '2026-05-20T08:00:00.000Z' }),
          expect.objectContaining({ option_id: '2', start_at: '2026-05-20T10:30:00.000Z' }),
        ]),
      });
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'propose_options', metadata: { proposal_strategy: 'spread' } });
    } finally {
      await app.close();
    }
  });

  it('exact slot AI output with service_interest calls propose_slot booking', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'propose_slot',
      availability_query: availabilityQuery({
        search_type: 'exact_slot',
        date_iso: '2026-05-23',
        exact_time: '08:00',
        flexibility: 'specific',
      }),
      slot_updates: { service_interest: 'консультация стоматолога' },
      booking: { preferred_date_iso: '2026-05-23', time_of_day: 'morning' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Хочу записаться на консультацию стоматолога 23.05 на 08:00' },
      });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'propose_slot',
        serviceInterest: 'консультация стоматолога',
        preferredDateIso: '2026-05-23',
        exactTime: '08:00',
        metadata: { policy_action: 'propose_slot' },
      });
      expect(response.json().booking_result).toMatchObject({ booking_status: 'awaiting_patient_confirmation' });
    } finally {
      await app.close();
    }
  });

  it('broad when-free typed availability uses spread proposal strategy without raw text matching', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'nearest_available', flexibility: 'flexible' }),
      slot_updates: { service_interest: 'консультация' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingSlotChoiceResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'Хочу записаться на консультацию стоматолога, когда есть свободно?' },
      });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'propose_options', metadata: { proposal_strategy: 'spread' } });
    } finally {
      await app.close();
    }
  });

  it('explicit nearest typed availability uses nearest proposal strategy', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'nearest_available', flexibility: 'nearest' }),
      slot_updates: { service_interest: 'консультация' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingSlotChoiceResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, text: 'какие есть варианты?' },
      });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'propose_options', metadata: { proposal_strategy: 'nearest' } });
    } finally {
      await app.close();
    }
  });

  it('patient typed selection by option id re-checks and holds only the stored selected option', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: proposedSlotsState() });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_selection',
      requested_action: 'select_slot',
      slot_selection: { selected_option_id: '2', selection_confidence: 'high' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse({
      startAt: '2026-05-20T10:30:00.000Z',
      endAt: '2026-05-20T11:00:00.000Z',
      label: '20.05.2026, 12:30',
    }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'propose_slot',
        selectedSlotStartAt: '2026-05-20T10:30:00.000Z',
        selectedSlotEndAt: '2026-05-20T11:00:00.000Z',
      });
      expect(response.json().booking_result).toMatchObject({
        booking_status: 'awaiting_patient_confirmation',
        proposed_slot: { start_at: '2026-05-20T10:30:00.000Z' },
        proposed_slots: [expect.objectContaining({ start_at: '2026-05-20T10:30:00.000Z' })],
      });
      expect(response.json().booking_result.proposed_slots).toHaveLength(1);
      expect(repository.calls.savedState?.state.runtime).toMatchObject({ awaiting_slot_choice: false, last_proposed_slots: [] });
    } finally {
      await app.close();
    }
  });



  it('selected stale option clears proposed slot memory after no_slots response', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: proposedSlotsState() });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_selection',
      requested_action: 'select_slot',
      slot_selection: { selected_option_id: '2', selection_confidence: 'high' },
    }));
    const bookingApplyService = new FakeBookingApplyService(noSlotsResponse('stale_slot_unavailable'));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().booking_result).toMatchObject({ booking_status: 'no_slots', reason: 'stale_slot_unavailable' });
      expect(repository.calls.savedState?.state.runtime).toMatchObject({ awaiting_slot_choice: false, last_proposed_slots: [] });
    } finally {
      await app.close();
    }
  });

  it('selection after cleared proposed slot memory asks to check availability again', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: { runtime: { awaiting_slot_choice: false, last_proposed_slots: [] } } });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_selection',
      requested_action: 'select_slot',
      slot_selection: { selected_option_id: '2', selection_confidence: 'high' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toContain('проверю свежие свободные варианты');
      expect(bookingApplyService.calls).toHaveLength(0);
      expect(repository.calls.savedState).toBeUndefined();
    } finally {
      await app.close();
    }
  });


  it('confirms an active hold even after proposed option memory was consumed', async () => {
    const activeHold = makeAppointment({
      dedupeKey: 'hold-key-1',
      startAt: '2026-05-23T07:15:00.000Z',
      endAt: '2026-05-23T07:45:00.000Z',
      cellRange: 'AN13',
      meta: {
        slot: {
          startAt: '2026-05-23T07:15:00.000Z',
          endAt: '2026-05-23T07:45:00.000Z',
          timezone: 'Europe/Prague',
          provider: 'google_sheets',
          metadata: { timezone: 'Europe/Prague', cell_range: 'AN13', sheet_name: 'Графік' },
        },
      },
    });
    const repository = new FakeRuntimeTurnRepository({
      state: { runtime: { awaiting_slot_choice: false, last_proposed_slots: [] } },
      activeHold,
      latestAppointment: activeHold,
      adminRecipient: '999-admin-chat',
    });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      booking: { patient_confirmed_proposed_slot: true },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, text: 'Да, подтверждаю' } });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(1);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'confirm_slot',
        activeHoldId: 'hold-key-1',
        selectedSlotStartAt: '2026-05-23T07:15:00.000Z',
        selectedSlotEndAt: '2026-05-23T07:45:00.000Z',
        selectedSlotProviderMetadata: { cell_range: 'AN13' },
      });
      expect(response.json()).toMatchObject({
        booking_result: { booking_action: 'confirm_slot', booking_status: 'booked_pending_admin_confirmation' },
        side_effects: [{ type: 'admin_notification', payload: { trigger: 'booking_result_booked_pending_admin_confirmation' } }],
        debug: { policy_decision: { next_action: 'confirm_slot', reason: 'active_hold_confirmed' } },
      });
      expect(response.json().debug.slot_choice_resolution).toBeUndefined();
      expect(repository.calls.savedState).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('directly confirms when active hold exists and stored proposed slots are empty', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ state: { runtime: { last_proposed_slots: [] } }, activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      booking: { patient_confirmed_proposed_slot: false },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'confirm_slot', activeHoldId: 'hold-key-1' });
      expect(response.json().debug.policy_decision).toMatchObject({ next_action: 'confirm_slot', reason: 'active_hold_confirmed' });
      expect(response.json().debug.slot_choice_resolution).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('confirms active hold when AI sets patient_confirmed_proposed_slot true', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'unknown',
      requested_action: 'clarify',
      booking: { patient_confirmed_proposed_slot: true },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'confirm_slot', activeHoldId: 'hold-key-1' });
    } finally {
      await app.close();
    }
  });

  it('lets active hold confirm_slot beat stale slot-selection resolver data', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ state: { runtime: { last_proposed_slots: [] } }, activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_selection',
      requested_action: 'confirm_slot',
      slot_selection: { selected_start_at: '2026-05-20T10:30:00.000Z', selection_confidence: 'high' },
      booking: { patient_confirmed_proposed_slot: false },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({
        bookingAction: 'confirm_slot',
        selectedSlotStartAt: '2026-05-18T07:00:00.000Z',
      });
      expect(response.json().debug.slot_choice_resolution).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('keeps existing fallback when confirm_slot has no active hold', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: { runtime: { awaiting_slot_choice: false, last_proposed_slots: [] } } });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'patient_confirmation',
      requested_action: 'confirm_slot',
      slot_selection: { selected_option_id: '2', selection_confidence: 'high' },
    }));
    const bookingApplyService = new FakeBookingApplyService(confirmedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls).toHaveLength(0);
      expect(response.json().debug.policy_decision).toMatchObject({ next_action: 'clarify_slot_choice', reason: 'slot_selection_no_stored_options' });
    } finally {
      await app.close();
    }
  });

  it('does not confirm active hold when AI says the patient rejected it', async () => {
    const activeHold = makeAppointment({ dedupeKey: 'hold-key-1' });
    const repository = new FakeRuntimeTurnRepository({ activeHold, latestAppointment: activeHold });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_rejected',
      requested_action: 'reject_slot',
      booking: { patient_confirmed_proposed_slot: true, patient_rejected_proposed_slot: true },
    }));
    const bookingApplyService = new FakeBookingApplyService(cancelNotImplementedResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ bookingAction: 'cancel_hold', activeHoldId: 'hold-key-1' });
      expect(bookingApplyService.calls[0]?.bookingAction).not.toBe('confirm_slot');
    } finally {
      await app.close();
    }
  });

  it('patient typed selection by unique selected_time re-checks that stored option', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: proposedSlotsState() });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_selection',
      requested_action: 'select_slot',
      slot_selection: { selected_time: '12:30', selection_confidence: 'medium' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse({ startAt: '2026-05-20T10:30:00.000Z' }));
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(bookingApplyService.calls[0]).toMatchObject({ selectedSlotStartAt: '2026-05-20T10:30:00.000Z' });
    } finally {
      await app.close();
    }
  });

  it('slot selection with no stored slots asks to check availability again without booking call', async () => {
    const repository = new FakeRuntimeTurnRepository();
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_selection',
      requested_action: 'select_slot',
      slot_selection: { selected_option_id: '1', selection_confidence: 'high' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toContain('проверю свежие свободные варианты');
      expect(bookingApplyService.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('ambiguous selected_time asks clarification and does not call booking', async () => {
    const repository = new FakeRuntimeTurnRepository({ state: proposedSlotsState({ ambiguousTime: true }) });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'slot_selection',
      requested_action: 'select_slot',
      slot_selection: { selected_time: '08:00', selection_confidence: 'high' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: validPayload });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toContain('Уточните');
      expect(bookingApplyService.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('builds Russian awaiting_patient_confirmation booking replies for ru', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'propose_slot',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-18', exact_time: '09:00', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультация' },
      booking: { preferred_date_iso: '2026-05-18', time_of_day: 'morning' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toBe('Есть свободное время 18.05.2026, 09:00. Подтверждаем?');
    } finally {
      await app.close();
    }
  });

  it('builds Ukrainian awaiting_patient_confirmation booking replies for uk', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'propose_slot',
      availability_query: availabilityQuery({ search_type: 'exact_slot', date_iso: '2026-05-18', exact_time: '09:00', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультація' },
      booking: { preferred_date_iso: '2026-05-18', time_of_day: 'morning' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingConfirmationResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, meta: { ...validPayload.meta, language_code: 'uk' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toBe('Є вільний час 18.05.2026, 09:00. Підтверджуємо?');
    } finally {
      await app.close();
    }
  });

  it('builds Russian booked_pending_admin_confirmation booking replies for ru', async () => {
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
      const response = await app.inject({ method: 'POST', url: '/runtime/turn', payload: { ...validPayload, meta: { ...validPayload.meta, language_code: 'ru' } } });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toBe('Запрос на запись 18.05.2026, 09:00 зафиксирован. Администратор проверит и подтвердит запись.');
    } finally {
      await app.close();
    }
  });

  it('builds Ukrainian localized option replies for awaiting_slot_choice', async () => {
    const repository = new FakeRuntimeTurnRepository({ cases: [makeCase()] });
    const aiClient = new FakeRuntimeAIClient(validAIOutput({
      conversation_intent: 'availability_request',
      requested_action: 'check_availability',
      availability_query: availabilityQuery({ search_type: 'specific_date', date_iso: '2026-05-20', flexibility: 'specific' }),
      slot_updates: { service_interest: 'консультація' },
      booking: { preferred_date_iso: '2026-05-20', time_of_day: 'any' },
    }));
    const bookingApplyService = new FakeBookingApplyService(awaitingSlotChoiceResponse());
    const app = Fastify();
    await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository, aiClient, bookingApplyService) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, meta: { ...validPayload.meta, language_code: 'uk' } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().reply_text).toContain('Є кілька варіантів:');
      expect(response.json().reply_text).toContain('Який вам підходить?');
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
  state?: Record<string, unknown>;
}

class FakeRuntimeTurnRepository implements RuntimeTurnRepository {
  private currentState: Record<string, unknown>;

  constructor(private readonly options: FakeRuntimeTurnRepositoryOptions = {}) {
    this.currentState = options.state ?? {};
  }

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
    savedState?: SaveRuntimeStateInput;
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

  private readonly inboundDedupeKeys = new Set<string>();

  async registerInboundEvent(input: RegisterInboundEventInput) {
    this.calls.inboundEvent = input;
    const isDuplicate = this.inboundDedupeKeys.has(input.dedupeKey);
    this.inboundDedupeKeys.add(input.dedupeKey);

    return {
      id: '33333333-3333-3333-3333-333333333333',
      isDuplicate,
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
      state: this.currentState,
      stateVersion: 1,
    };
  }

  async saveConvoState(input: SaveRuntimeStateInput) {
    this.calls.savedState = input;
    this.currentState = input.state;
    this.mutationCalls.push('saveConvoState');

    return {
      clinicId: input.clinicId,
      contactId: input.contactId,
      state: input.state,
      stateVersion: 2,
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
    startAt: '2026-05-18T07:00:00.000Z',
    endAt: '2026-05-18T07:30:00.000Z',
    status: 'held',
    dedupeKey: 'hold-key-1',
    cellRange: 'C4',
    sheetName: 'Графік',
    externalRecordId: null,
    meta: {
      slot: {
        startAt: '2026-05-18T07:00:00.000Z',
        endAt: '2026-05-18T07:30:00.000Z',
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
  const proposedSlot = {
    start_at: overrides.startAt ?? '2026-05-18T07:00:00.000Z',
    end_at: overrides.endAt ?? '2026-05-18T07:30:00.000Z',
    label: overrides.label ?? '18.05.2026, 09:00',
    cell_range: 'C4',
    sheet_name: 'Графік',
    service_interest: 'консультация',
  };

  return {
    booking_action: 'propose_slot',
    booking_status: 'awaiting_patient_confirmation',
    hold_id: 'hold-key-1',
    appointment_id: '66666666-6666-6666-6666-666666666666',
    proposed_slot: proposedSlot,
    proposed_slots: [proposedSlot],
    should_notify_admin: false,
    reason: 'slot_proposed',
  };
}


function awaitingSlotChoiceResponse(): BookingApplyResponse {
  return {
    booking_action: 'propose_options',
    booking_status: 'awaiting_slot_choice',
    proposed_slot: null,
    proposed_slots: [
      {
        option_id: '1',
        start_at: '2026-05-20T08:00:00.000Z',
        end_at: '2026-05-20T08:30:00.000Z',
        label: '20.05.2026, 10:00',
        cell_range: 'C4',
        sheet_name: 'Графік',
        service_interest: 'консультация',
        provider_metadata: { timezone: 'Europe/Prague', cell_range: 'C4', sheet_name: 'Графік' },
      },
      {
        option_id: '2',
        start_at: '2026-05-20T10:30:00.000Z',
        end_at: '2026-05-20T11:00:00.000Z',
        label: '20.05.2026, 12:30',
        cell_range: 'C8',
        sheet_name: 'Графік',
        service_interest: 'консультация',
        provider_metadata: { timezone: 'Europe/Prague', cell_range: 'C8', sheet_name: 'Графік' },
      },
      {
        option_id: '3',
        start_at: '2026-05-21T13:00:00.000Z',
        end_at: '2026-05-21T13:30:00.000Z',
        label: '21.05.2026, 15:00',
        cell_range: 'D12',
        sheet_name: 'Графік',
        service_interest: 'консультация',
        provider_metadata: { timezone: 'Europe/Prague', cell_range: 'D12', sheet_name: 'Графік' },
      },
    ],
    should_notify_admin: false,
    reason: 'slot_options_available',
  };
}


function pendingPriceFaqState(): Record<string, unknown> {
  return {
    runtime: {
      pending_clarification: {
        type: 'faq',
        faq_topic: 'price',
        missing_slot: 'service_interest',
        created_at: '2026-05-16T10:00:00.000Z',
        trace_id: '99999999-9999-4999-9999-999999999999',
      },
    },
  };
}


function caseMemoryState(serviceInterest: string): Record<string, unknown> {
  return {
    runtime: {
      case_memory: {
        current_case_id: 'local_current',
        cases: [{
          id: 'local_current',
          type: 'mixed',
          status: 'answered',
          collected: {
            service_interest: {
              value: serviceInterest,
              source: 'faq_price_followup',
              updated_at: '2026-05-16T10:00:00.000Z',
              trace_id: '99999999-9999-4999-9999-999999999999',
            },
          },
          proposed_slots: [],
          active_hold: null,
          last_intent: 'faq',
          updated_at: '2026-05-16T10:00:00.000Z',
        }],
      },
    },
  };
}

function proposedSlotsState(options: { ambiguousTime?: boolean } = {}): Record<string, unknown> {
  const slots = awaitingSlotChoiceResponse().proposed_slots.map((slot) => ({
    option_id: slot.option_id,
    start_at: slot.start_at,
    end_at: slot.end_at,
    label: slot.label,
    cell_range: slot.cell_range,
    sheet_name: slot.sheet_name,
    service_interest: slot.service_interest,
    preferred_date_iso: '2026-05-20',
    time_of_day: 'any',
    exact_time: null,
    provider_metadata: slot.provider_metadata,
  }));

  if (options.ambiguousTime === true) {
    slots[1] = { ...slots[1], start_at: '2026-05-21T08:00:00.000Z', end_at: '2026-05-21T08:30:00.000Z' };
  }

  return {
    runtime: {
      last_proposed_slots: slots,
      last_proposed_slots_trace_id: 'previous-trace',
      last_proposed_slots_created_at: '2026-05-17T10:00:00.000Z',
      awaiting_slot_choice: true,
    },
  };
}

function noSlotsResponse(reason: 'no_slots_available' | 'stale_slot_unavailable' = 'no_slots_available'): BookingApplyResponse {
  return {
    booking_action: 'propose_slot',
    booking_status: 'no_slots',
    proposed_slot: null,
    proposed_slots: [],
    should_notify_admin: false,
    reply_text_override: 'Свободных слотов по вашему запросу сейчас не нашёл. Подскажите другой день или время.',
    reason,
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
      start_at: '2026-05-18T07:00:00.000Z',
      end_at: '2026-05-18T07:30:00.000Z',
      label: '18.05.2026, 09:00',
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
      start_at: '2026-05-18T07:00:00.000Z',
      end_at: '2026-05-18T07:30:00.000Z',
      label: '18.05.2026, 09:00',
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


function makeEmbedding(): number[] {
  return Array.from({ length: 1536 }, (_, index) => index / 1536);
}

class FakeRuntimeEmbeddingClient implements RuntimeEmbeddingClient {
  constructor(private readonly embedding: number[]) {}

  readonly calls: Array<{ text: string; trace_id?: string }> = [];

  async embedText(input: { text: string; trace_id?: string }): Promise<number[]> {
    this.calls.push(input);
    return this.embedding;
  }
}

class FakeRuntimeKnowledgeRepository implements RuntimeKnowledgeRepository {
  constructor(private readonly result: RuntimeKnowledgeResult) {}

  readonly calls: RuntimeKnowledgeRetrieveInput[] = [];

  async retrieve(input: RuntimeKnowledgeRetrieveInput): Promise<RuntimeKnowledgeResult> {
    this.calls.push(input);
    return this.result;
  }
}

class ThrowingRuntimeKnowledgeRepository implements RuntimeKnowledgeRepository {
  constructor(private readonly error: Error) {}

  async retrieve(): Promise<RuntimeKnowledgeResult> {
    throw this.error;
  }
}


class ThrowingRuntimeKnowledgeReplyComposer implements RuntimeKnowledgeReplyComposer {
  readonly provider = 'throwing-test';
  readonly model = 'throwing-test-model';

  constructor(private readonly error: Error) {}

  async compose(_input: RuntimeKnowledgeReplyComposerInput): Promise<RuntimeKnowledgeReplyComposerOutput> {
    throw this.error;
  }
}

class FakeRuntimeAIClient implements RuntimeAIClient {
  private readonly outputs: unknown[];

  constructor(
    output: unknown | unknown[],
    readonly provider?: string,
    readonly model?: string,
  ) {
    this.outputs = Array.isArray(output) ? [...output] : [output];
  }

  readonly calls: RuntimeAIExtractionInput[] = [];

  async extract(input: RuntimeAIExtractionInput): Promise<RuntimeAIOutput> {
    this.calls.push(input);
    const output = this.outputs.length > 1 ? this.outputs.shift() : this.outputs[0];
    return output as RuntimeAIOutput;
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
    availability_query: {
      search_type: 'unknown',
      date_iso: null,
      weekday: null,
      relative_day: null,
      time_window: null,
      exact_time: null,
      flexibility: 'unknown',
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
