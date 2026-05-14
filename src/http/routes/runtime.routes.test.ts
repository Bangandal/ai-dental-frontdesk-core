import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type {
  RuntimeClinicRecord,
  RuntimeContactInput,
  RuntimeContactRecord,
  RuntimeContextRepository,
  RuntimeConvoStateRecord,
  RuntimeInboundEventInput,
  RuntimeInboundEventRecord,
  RuntimeInboundMessageInput,
  RuntimeMessageRecord,
} from '../../domain/runtime/runtimeContextRepository.js';
import { RuntimeTurnService } from '../../domain/runtime/runtimeTurnService.js';
import { registerRuntimeRoutes } from './runtime.routes.js';

const clinicId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const inboundEventId = '33333333-3333-4333-8333-333333333333';
const userMessageId = '44444444-4444-4444-8444-444444444444';
const convoStateId = '55555555-5555-4555-8555-555555555555';

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
  it('resolves clinic/contact context and returns the DB-backed skeleton response', async () => {
    const repository = new FakeRuntimeContextRepository();
    const app = await buildTestApp(repository);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Runtime endpoint is wired.',
        clinic_id: clinicId,
        contact_id: contactId,
        case_id: null,
        booking_result: null,
        side_effects: [],
        debug: {
          clinic_code: 'clinic_1',
          channel: 'telegram',
          external_user_id: '8054104741',
          inbound_event_id: inboundEventId,
          user_message_id: userMessageId,
          state_version: 1,
          duplicate: false,
          stub: true,
        },
      });
      expect(response.json().trace_id).toEqual(expect.any(String));
      expect(repository.contactInputs).toHaveLength(1);
      expect(repository.contactInputs[0]).toMatchObject({ clinicId, channel: 'telegram', externalUserId: '8054104741' });
    } finally {
      await app.close();
    }
  });

  it('returns a controlled error when clinic_code is unknown or inactive', async () => {
    const repository = new FakeRuntimeContextRepository({ clinic: null });
    const app = await buildTestApp(repository);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: { ...validPayload, clinic_code: 'missing_clinic' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: 'clinic_not_found',
          message: 'Active clinic was not found for the provided clinic_code.',
          trace_id: expect.any(String),
        },
      });
      expect(repository.contactInputs).toHaveLength(0);
      expect(repository.inboundEventInputs).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('persists the inbound event, inbound message, and loads convo_state', async () => {
    const repository = new FakeRuntimeContextRepository();
    const app = await buildTestApp(repository);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(repository.inboundEventInputs).toHaveLength(1);
      expect(repository.inboundEventInputs[0]).toMatchObject({
        clinicId,
        contactId,
        input: validPayload,
      });
      expect(repository.inboundEventInputs[0]?.dedupeKey).toBe('clinic_1:telegram:8054104741:1270');
      expect(repository.inboundEventInputs[0]?.traceId).toEqual(expect.any(String));
      expect(repository.messageInputs).toHaveLength(1);
      expect(repository.messageInputs[0]).toMatchObject({ clinicId, contactId, input: validPayload });
      expect(repository.convoStateInputs).toEqual([{ clinicId, contactId }]);
    } finally {
      await app.close();
    }
  });

  it('returns validation_failed for invalid runtime turn input', async () => {
    const app = await buildTestApp(new FakeRuntimeContextRepository());

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

async function buildTestApp(repository: RuntimeContextRepository) {
  const app = Fastify();
  await app.register(registerRuntimeRoutes, { runtimeTurnService: new RuntimeTurnService(repository) });

  return app;
}

class FakeRuntimeContextRepository implements RuntimeContextRepository {
  readonly contactInputs: RuntimeContactInput[] = [];
  readonly inboundEventInputs: RuntimeInboundEventInput[] = [];
  readonly messageInputs: RuntimeInboundMessageInput[] = [];
  readonly convoStateInputs: Array<{ clinicId: string; contactId: string }> = [];

  private readonly clinic: RuntimeClinicRecord | null;

  constructor(options: { clinic?: RuntimeClinicRecord | null } = {}) {
    this.clinic = options.clinic === undefined ? makeClinic() : options.clinic;
  }

  async resolveActiveClinicByCode(): Promise<RuntimeClinicRecord | null> {
    return this.clinic;
  }

  async getOrCreateContact(input: RuntimeContactInput): Promise<RuntimeContactRecord> {
    this.contactInputs.push(input);

    return {
      id: contactId,
      clinicId: input.clinicId,
      channel: input.channel,
      externalUserId: input.externalUserId,
      chatId: input.chatId,
      username: input.meta?.username ?? null,
      firstName: input.meta?.first_name ?? null,
      lastName: input.meta?.last_name ?? null,
      languageCode: input.meta?.language_code ?? null,
      meta: input.meta ?? {},
    };
  }

  async registerInboundEvent(input: RuntimeInboundEventInput): Promise<RuntimeInboundEventRecord> {
    this.inboundEventInputs.push(input);

    return { id: inboundEventId, duplicate: false };
  }

  async saveInboundMessage(input: RuntimeInboundMessageInput): Promise<RuntimeMessageRecord> {
    this.messageInputs.push(input);

    return { id: userMessageId };
  }

  async loadOrInitConvoState(clinicIdInput: string, contactIdInput: string): Promise<RuntimeConvoStateRecord> {
    this.convoStateInputs.push({ clinicId: clinicIdInput, contactId: contactIdInput });

    return { id: convoStateId, stateJson: {}, stateVersion: 1 };
  }
}

function makeClinic(): RuntimeClinicRecord {
  return {
    id: clinicId,
    code: 'clinic_1',
    name: 'Clinic One',
    timezone: 'Europe/Prague',
    settingsJson: {},
  };
}
