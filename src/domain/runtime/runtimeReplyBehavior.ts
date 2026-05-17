import type { BookingApplyResponse } from '../booking/bookingApply.js';
import type { RuntimeAIOutput, RuntimeSideEffect, RuntimeTurnInput } from './runtimeContracts.js';
import type { RuntimeConversationMode } from './runtimeConversationMode.js';
import type { RuntimeReplyLanguage } from './runtimeReplyLanguage.js';
import { runtimeReplyTemplate } from './runtimeReplyTemplates.js';
import type { RuntimePolicyDecision } from './runtimePolicy.js';
import type { RuntimeKnowledgeResult } from './runtimeKnowledgeRepository.js';
import { buildReplyFromBookingResult, type RuntimeReplyDecision } from './runtimeReplyBuilder.js';
import type { RuntimeBookingContext, RuntimeCaseContext, RuntimeClinicRecord } from './runtimeTurnService.js';

export interface RuntimeReplyBehaviorInput {
  conversation_mode: RuntimeConversationMode;
  booking_result: BookingApplyResponse | null;
  policy_decision: RuntimePolicyDecision | null;
  case_context: RuntimeCaseContext;
  booking_context: RuntimeBookingContext;
  clinic: RuntimeClinicRecord;
  ai_output: RuntimeAIOutput | null;
  channel: RuntimeTurnInput['channel'];
  knowledge_result?: RuntimeKnowledgeResult | null;
  knowledge_reply_text?: string | null;
  response_language: RuntimeReplyLanguage;
}

export interface RuntimeReplyBehaviorResult extends RuntimeReplyDecision {
  side_effects: RuntimeSideEffect[];
}

export function buildRuntimeReplyBehavior(input: RuntimeReplyBehaviorInput): RuntimeReplyBehaviorResult {
  if (input.booking_result !== null && input.booking_result.booking_status !== 'none') {
    return {
      ...buildReplyFromBookingResult(input.booking_result),
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'faq_address') {
    const locationPacket = buildLocationPacket(input.clinic.settings, input.channel);
    const knowledgeReply = buildKnowledgeReply(input.knowledge_reply_text);

    if (locationPacket !== null) {
      return {
        reply_text: knowledgeReply ?? buildAddressReply(locationPacket),
        reply_source: knowledgeReply === null ? 'policy' : 'kb',
        side_effects: [locationPacket],
      };
    }

    if (knowledgeReply !== null) {
      return {
        reply_text: knowledgeReply,
        reply_source: 'kb',
        side_effects: [],
      };
    }

    return {
      reply_text: runtimeReplyTemplate(input.response_language, 'faq_address_missing'),
      reply_source: 'safe_fallback',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'multi_patient_request') {
    return {
      reply_text: runtimeReplyTemplate(input.response_language, 'multi_patient_request'),
      reply_source: 'policy',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'reschedule_request') {
    return {
      reply_text: runtimeReplyTemplate(input.response_language, 'reschedule_request'),
      reply_source: 'policy',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'human_handoff') {
    return {
      reply_text: input.policy_decision?.reply_text ?? runtimeReplyTemplate(input.response_language, 'human_handoff'),
      reply_source: 'policy',
      side_effects: [],
    };
  }

  if (input.policy_decision?.reply_text !== undefined) {
    return {
      reply_text: input.policy_decision.reply_text,
      reply_source: 'policy',
      side_effects: [],
    };
  }

  const knowledgeReply = buildKnowledgeReply(input.knowledge_reply_text);

  if (knowledgeReply !== null && requiresKnowledgeGrounding(input)) {
    return {
      reply_text: knowledgeReply,
      reply_source: 'kb',
      side_effects: [],
    };
  }

  const aiDraft = readNonEmpty(input.ai_output?.reply_draft);

  if (aiDraft !== undefined && !requiresKnowledgeGrounding(input)) {
    return {
      reply_text: aiDraft,
      reply_source: 'ai_draft',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'faq_price') {
    return {
      reply_text: runtimeReplyTemplate(input.response_language, 'faq_price_missing'),
      reply_source: 'safe_fallback',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'faq_insurance') {
    return {
      reply_text: runtimeReplyTemplate(input.response_language, 'faq_insurance_missing'),
      reply_source: 'safe_fallback',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'post_booking_question') {
    return {
      reply_text: runtimeReplyTemplate(input.response_language, 'post_booking_question'),
      reply_source: 'safe_fallback',
      side_effects: [],
    };
  }

  return {
    reply_text: runtimeReplyTemplate(input.response_language, 'safe_fallback'),
    reply_source: 'safe_fallback',
    side_effects: [],
  };
}

interface LocationPacketSideEffect extends RuntimeSideEffect {
  type: 'location_packet';
  channel: 'telegram';
  address: string;
  maps_url: string | null;
  photo_keys: string[];
}

function buildLocationPacket(settings: Record<string, unknown>, channel: RuntimeTurnInput['channel']): LocationPacketSideEffect | null {
  if (channel !== 'telegram') {
    return null;
  }

  const location = readRecord(settings.location_packet) ?? readRecord(settings.location);
  const address = readNonEmpty(location?.address) ?? readNonEmpty(settings.address) ?? readNonEmpty(settings.clinic_address);

  if (address === undefined) {
    return null;
  }

  const mapsUrl = readNonEmpty(location?.maps_url) ?? readNonEmpty(settings.maps_url) ?? readNonEmpty(settings.google_maps_url) ?? null;
  const photoKeys = readStringArray(location?.photo_keys) ?? readStringArray(settings.location_photo_keys) ?? [];

  return {
    type: 'location_packet',
    channel: 'telegram',
    address,
    maps_url: mapsUrl,
    photo_keys: photoKeys,
  };
}

function buildAddressReply(locationPacket: LocationPacketSideEffect): string {
  const mapsPart = locationPacket.maps_url === null ? '' : `\nМапа: ${locationPacket.maps_url}`;

  return `Адреса клініки: ${locationPacket.address}.${mapsPart}`;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  return strings.length === value.length ? strings : undefined;
}

function buildKnowledgeReply(knowledgeReplyText: string | null | undefined): string | null {
  return readNonEmpty(knowledgeReplyText) ?? null;
}

function requiresKnowledgeGrounding(input: RuntimeReplyBehaviorInput): boolean {
  if (input.conversation_mode === 'faq_price'
    || input.conversation_mode === 'faq_insurance'
    || input.conversation_mode === 'faq_address'
    || input.conversation_mode === 'post_booking_question') {
    return true;
  }

  const aiOutput = input.ai_output;

  if (aiOutput === null) {
    return false;
  }

  return aiOutput.conversation_intent === 'faq'
    || aiOutput.requested_action === 'answer_faq';
}
