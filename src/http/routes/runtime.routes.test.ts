import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type {
  GetOrCreateRuntimeContactInput,
  LoadOrInitConvoStateInput,
  RegisterInboundEventInput,
  RuntimeTurnRepository,
  SaveInboundUserMessageInput,
} from '../../domain/runtime/runtimeTurnService.js';
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
  it('accepts a valid runtime turn input, persists the inbound turn, and returns resolved context', async () => {
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
        reply_text: 'Runtime endpoint is wired.',
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
      });
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
    } finally {
      await app.close();
    }
  });

  it('returns validation_failed for invalid runtime turn input', async () => {
    const app = Fastify();
    await app.register(registerRuntimeRoutes, {
      runtimeTurnService: new RuntimeTurnService(new FakeRuntimeTurnRepository()),
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
    } finally {
      await app.close();
    }
  });
});

class FakeRuntimeTurnRepository implements RuntimeTurnRepository {
  constructor(private readonly options: { clinicFound: boolean } = { clinicFound: true }) {}

  readonly calls: {
    clinicCode?: string;
    contact?: GetOrCreateRuntimeContactInput;
    inboundEvent?: RegisterInboundEventInput;
    message?: SaveInboundUserMessageInput;
    convoState?: LoadOrInitConvoStateInput;
  } = {};

  async findActiveClinicByCode(code: string) {
    this.calls.clinicCode = code;

    if (!this.options.clinicFound) {
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
}
