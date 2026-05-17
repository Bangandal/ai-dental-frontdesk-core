import type { BookingApplyResponse } from '../booking/bookingApply.js';
import { RUNTIME_AI_SAFE_FALLBACK_REPLY } from './runtimeAiClient.js';
import type { RuntimeReplyLanguage } from './runtimeReplyLanguage.js';

export type RuntimeReplySource = 'booking_result' | 'policy' | 'ai_draft' | 'kb' | 'safe_fallback' | 'booking_error';

export interface RuntimeReplyDecision {
  reply_text: string;
  reply_source: RuntimeReplySource;
}

export function buildReplyFromBookingResult(bookingResult: BookingApplyResponse, language: RuntimeReplyLanguage = 'ru'): RuntimeReplyDecision {
  if (bookingResult.booking_status === 'awaiting_slot_choice') {
    return {
      reply_text: buildSlotOptionsReply(bookingResult.proposed_slots, language),
      reply_source: 'booking_result',
    };
  }

  if (bookingResult.booking_status === 'awaiting_patient_confirmation') {
    return {
      reply_text: `Є вільний час ${bookingResult.proposed_slot.label}. Підтверджуємо?`,
      reply_source: 'booking_result',
    };
  }

  if (bookingResult.booking_status === 'no_slots') {
    return {
      reply_text: bookingResult.reply_text_override,
      reply_source: 'booking_result',
    };
  }

  if (bookingResult.booking_status === 'booked_pending_admin_confirmation') {
    return {
      reply_text: `Запит на запис ${bookingResult.appointment.label} зафіксовано. Адміністратор перевірить і підтвердить запис.`,
      reply_source: 'booking_result',
    };
  }

  if (bookingResult.booking_status === 'external_write_failed') {
    return {
      reply_text: bookingResult.reply_text_override,
      reply_source: 'booking_result',
    };
  }

  if (bookingResult.booking_status === 'not_implemented') {
    if (bookingResult.booking_action === 'cancel_hold') {
      return {
        reply_text: 'Добре, цей час не використовуємо. Підкажіть, будь ласка, інший зручний день або час.',
        reply_source: 'booking_result',
      };
    }

    return {
      reply_text: bookingResult.reply_text_override,
      reply_source: 'booking_result',
    };
  }

  return {
    reply_text: RUNTIME_AI_SAFE_FALLBACK_REPLY,
    reply_source: 'safe_fallback',
  };
}

function buildSlotOptionsReply(slots: Array<{ label: string; start_at: string }>, language: RuntimeReplyLanguage): string {
  const header = {
    ru: 'Есть несколько вариантов:',
    uk: 'Є кілька варіантів:',
    cs: 'Máme několik možností:',
    en: 'There are a few options:',
  }[language];
  const question = {
    ru: 'Какой вам подходит?',
    uk: 'Який вам підходить?',
    cs: 'Která vám vyhovuje?',
    en: 'Which one works for you?',
  }[language];
  const lines = slots.slice(0, 3).map((slot, index) => `${index + 1}. ${formatSlotOption(slot, language)}`);

  return `${header}\n${lines.join('\n')}\n\n${question}`;
}

function formatSlotOption(slot: { label: string; start_at: string }, language: RuntimeReplyLanguage): string {
  const date = new Date(slot.start_at);

  if (Number.isNaN(date.getTime())) {
    return slot.label;
  }

  const locale = language === 'en' ? 'en-GB' : language === 'cs' ? 'cs-CZ' : language === 'uk' ? 'uk-UA' : 'ru-RU';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
