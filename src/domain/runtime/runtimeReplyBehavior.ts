import type { BookingApplyResponse } from '../booking/bookingApply.js';
import { RUNTIME_AI_SAFE_FALLBACK_REPLY } from './runtimeAiClient.js';
import type { RuntimeAIOutput, RuntimeSideEffect, RuntimeTurnInput } from './runtimeContracts.js';
import type { RuntimeConversationMode } from './runtimeConversationMode.js';
import type { RuntimePolicyDecision } from './runtimePolicy.js';
import { buildReplyFromBookingResult, type RuntimeReplyDecision } from './runtimeReplyBuilder.js';
import type { RuntimeKnowledgeResult, RuntimeKnowledgeSnippet } from './runtimeKnowledgeRepository.js';
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
    const kbReply = buildGroundedKnowledgeReply(input.knowledge_result, input.ai_output?.faq_topic ?? 'address');

    if (locationPacket !== null) {
      return {
        reply_text: kbReply ?? buildAddressReply(locationPacket),
        reply_source: kbReply === null ? 'policy' : 'kb',
        side_effects: [locationPacket],
      };
    }

    return {
      reply_text: kbReply ?? 'Уточню це в адміністратора й повернуся з точною адресою або орієнтирами.',
      reply_source: kbReply === null ? 'safe_fallback' : 'kb',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'multi_patient_request') {
    return {
      reply_text: 'Для запису кількох людей краще оформити окремі записи, щоб не переплутати час. Я передам запит адміністратору, і він допоможе погодити деталі.',
      reply_source: 'policy',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'reschedule_request') {
    return {
      reply_text: 'Зміну або перенесення запису має підтвердити адміністратор. Передам запит, щоб з Вами зв’язались і погодили новий час.',
      reply_source: 'policy',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'human_handoff') {
    return {
      reply_text: input.policy_decision?.reply_text ?? 'Передам Ваш запит адміністратору, щоб він допоміг вручну.',
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

  const kbReply = buildGroundedKnowledgeReply(input.knowledge_result, input.ai_output?.faq_topic ?? 'unknown');

  if (kbReply !== null && isKnowledgeAnswerMode(input)) {
    return {
      reply_text: kbReply,
      reply_source: 'kb',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'faq_price') {
    return {
      reply_text: 'Підкажіть, будь ласка, яка саме послуга цікавить — зорієнтую по вартості.',
      reply_source: 'safe_fallback',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'faq_insurance') {
    return {
      reply_text: 'Підкажіть, будь ласка, яка у Вас страхова або який тип покриття — перевіримо, чи можемо прийняти.',
      reply_source: 'safe_fallback',
      side_effects: [],
    };
  }

  if (input.conversation_mode === 'post_booking_question') {
    const aiDraft = readNonEmpty(input.ai_output?.reply_draft);

    if (aiDraft !== undefined && (input.ai_output?.faq_topic === 'unknown' || input.ai_output?.faq_topic === 'other')) {
      return {
        reply_text: aiDraft,
        reply_source: 'ai_draft',
        side_effects: [],
      };
    }

    return {
      reply_text: 'Ваш запис бачу в контексті. Напишіть, будь ласка, яке саме питання — допоможу або передам адміністратору.',
      reply_source: 'safe_fallback',
      side_effects: [],
    };
  }

  const aiDraft = readNonEmpty(input.ai_output?.reply_draft);

  if (aiDraft !== undefined) {
    return {
      reply_text: aiDraft,
      reply_source: 'ai_draft',
      side_effects: [],
    };
  }

  return {
    reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
    reply_source: 'safe_fallback',
    side_effects: [],
  };
}


function isKnowledgeAnswerMode(input: RuntimeReplyBehaviorInput): boolean {
  return input.conversation_mode === 'faq_price'
    || input.conversation_mode === 'faq_insurance'
    || input.conversation_mode === 'faq_address'
    || input.conversation_mode === 'post_booking_question'
    || input.ai_output?.conversation_intent === 'faq'
    || input.ai_output?.requested_action === 'answer_faq';
}

function buildGroundedKnowledgeReply(
  knowledgeResult: RuntimeKnowledgeResult | null | undefined,
  faqTopic: RuntimeAIOutput['faq_topic'],
): string | null {
  if (knowledgeResult?.found !== true) {
    return null;
  }

  const snippets = knowledgeResult.snippets
    .map(formatKnowledgeSnippet)
    .filter((snippet): snippet is string => snippet !== null);

  if (snippets.length === 0) {
    return null;
  }

  const body = snippets.slice(0, 2).join('\n');

  if (faqTopic === 'price') {
    return `За інформацією клініки: ${body}
Якщо потрібно, адміністратор уточнить актуальну вартість для Вашого випадку.`;
  }

  if (faqTopic === 'insurance') {
    return `За інформацією клініки: ${body}
Якщо покриття залежить від страхової або полісу, адміністратор може перевірити деталі.`;
  }

  return body;
}

function formatKnowledgeSnippet(snippet: RuntimeKnowledgeSnippet): string | null {
  const content = readNonEmpty(snippet.content);

  if (content === undefined) {
    return null;
  }

  const title = readNonEmpty(snippet.title);

  return title === undefined ? content : `${title}: ${content}`;
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
