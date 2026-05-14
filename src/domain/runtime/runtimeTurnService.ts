import { randomUUID } from 'node:crypto';

import type { RuntimeTurnInput, RuntimeTurnResult } from './runtimeContracts.js';
import type { RuntimeContextRepository } from './runtimeContextRepository.js';

export class RuntimeClinicNotFoundError extends Error {
  constructor(readonly clinicCode: string, readonly traceId: string) {
    super(`Active clinic not found for code: ${clinicCode}`);
    this.name = 'RuntimeClinicNotFoundError';
  }
}

export class RuntimeTurnService {
  constructor(private readonly repository: RuntimeContextRepository) {}

  async handleTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
    const traceId = randomUUID();
    const clinic = await this.repository.resolveActiveClinicByCode(input.clinic_code);

    if (clinic === null) {
      throw new RuntimeClinicNotFoundError(input.clinic_code, traceId);
    }

    const contact = await this.repository.getOrCreateContact({
      clinicId: clinic.id,
      channel: input.channel,
      externalUserId: input.external_user_id,
      chatId: input.chat_id,
      meta: input.meta,
    });
    const inboundEvent = await this.repository.registerInboundEvent({
      clinicId: clinic.id,
      contactId: contact.id,
      input,
      dedupeKey: buildInboundDedupeKey(input, traceId),
      traceId,
    });
    const userMessage = await this.repository.saveInboundMessage({
      clinicId: clinic.id,
      contactId: contact.id,
      input,
    });
    const convoState = await this.repository.loadOrInitConvoState(clinic.id, contact.id);

    return {
      trace_id: traceId,
      reply_text: 'Runtime endpoint is wired.',
      clinic_id: clinic.id,
      contact_id: contact.id,
      case_id: null,
      booking_result: null,
      side_effects: [],
      debug: {
        clinic_code: clinic.code,
        channel: input.channel,
        external_user_id: input.external_user_id,
        inbound_event_id: inboundEvent.id,
        user_message_id: userMessage.id,
        state_version: convoState.stateVersion,
        duplicate: inboundEvent.duplicate,
        stub: true,
      },
    };
  }
}

function buildInboundDedupeKey(input: RuntimeTurnInput, traceId: string): string {
  const sourceId = input.meta?.message_id ?? input.meta?.update_id ?? traceId;

  return [input.clinic_code, input.channel, input.external_user_id, String(sourceId)].join(':');
}
