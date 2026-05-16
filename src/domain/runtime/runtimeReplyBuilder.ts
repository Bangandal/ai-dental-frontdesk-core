import type { BookingApplyResponse } from '../booking/bookingApply.js';
import { RUNTIME_AI_SAFE_FALLBACK_REPLY } from './runtimeAiClient.js';

export type RuntimeReplySource = 'booking_result' | 'policy' | 'ai_draft' | 'safe_fallback' | 'booking_error';

export interface RuntimeReplyDecision {
  reply_text: string;
  reply_source: RuntimeReplySource;
}

export function buildReplyFromBookingResult(bookingResult: BookingApplyResponse): RuntimeReplyDecision {
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
