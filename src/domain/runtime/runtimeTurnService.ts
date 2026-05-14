import { randomUUID } from 'node:crypto';

import type { RuntimeTurnInput, RuntimeTurnResult } from './runtimeContracts.js';

export class RuntimeTurnService {
  async handleTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
    const traceId = randomUUID();

    return {
      trace_id: traceId,
      reply_text: 'Runtime endpoint is wired.',
      clinic_id: null,
      contact_id: null,
      case_id: null,
      booking_result: null,
      side_effects: [],
      debug: {
        input_summary: {
          clinic_code: input.clinic_code,
          channel: input.channel,
          external_user_id: input.external_user_id,
          chat_id: input.chat_id,
          text_length: input.text.length,
          has_meta: input.meta !== undefined,
        },
        stub: true,
      },
    };
  }
}
