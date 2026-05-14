import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

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
  it('accepts a valid runtime turn input and returns the stub response', async () => {
    const app = Fastify();
    await app.register(registerRuntimeRoutes);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime/turn',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        reply_text: 'Runtime endpoint is wired.',
        clinic_id: null,
        contact_id: null,
        case_id: null,
        booking_result: null,
        side_effects: [],
        debug: {
          input_summary: {
            clinic_code: 'clinic_1',
            channel: 'telegram',
            external_user_id: '8054104741',
            chat_id: '8054104741',
            text_length: validPayload.text.length,
            has_meta: true,
          },
          stub: true,
        },
      });
      expect(response.json().trace_id).toEqual(expect.any(String));
    } finally {
      await app.close();
    }
  });

  it('returns validation_failed for invalid runtime turn input', async () => {
    const app = Fastify();
    await app.register(registerRuntimeRoutes);

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
