import type { BookingSlotPayload } from '../booking/bookingApply.js';
import type { RuntimeAIOutput } from './runtimeContracts.js';
import type { RuntimeReplyLanguage } from './runtimeReplyLanguage.js';

export interface RuntimeProposedSlotMemory extends BookingSlotPayload {
  option_id: string;
  preferred_date_iso: string | null;
  time_of_day: string | null;
  exact_time: string | null;
  provider_metadata: Record<string, unknown>;
}

export interface RuntimeSlotChoiceResolverInput {
  slot_selection: RuntimeAIOutput['slot_selection'];
  last_proposed_slots: RuntimeProposedSlotMemory[];
  trace_id: string;
  language: RuntimeReplyLanguage;
}

export interface RuntimeSlotChoiceResolverOutput {
  matched: boolean;
  selected_slot: RuntimeProposedSlotMemory | null;
  reason: string;
  warnings: string[];
  reply_text?: string;
}

const confidentSelections = new Set<RuntimeAIOutput['slot_selection']['selection_confidence']>(['high', 'medium']);

export function resolveRuntimeSlotChoice(input: RuntimeSlotChoiceResolverInput): RuntimeSlotChoiceResolverOutput {
  const warnings: string[] = [];
  const selection = input.slot_selection;

  if (!confidentSelections.has(selection.selection_confidence)) {
    return clarification('slot_selection_low_confidence', input.language, warnings);
  }

  if (input.last_proposed_slots.length === 0) {
    return clarification('slot_selection_no_stored_options', input.language, warnings);
  }

  if (isNonEmpty(selection.selected_option_id)) {
    const selectedOptionId = selection.selected_option_id.trim();
    const match = input.last_proposed_slots.find((slot) => slot.option_id === selectedOptionId);

    if (match !== undefined) {
      return matched(match, 'matched_selected_option_id', warnings);
    }

    warnings.push('selected_option_id_not_found');
    return clarification('slot_selection_option_not_found', input.language, warnings);
  }

  if (isNonEmpty(selection.selected_start_at)) {
    if (!isValidIsoDateTime(selection.selected_start_at.trim())) {
      warnings.push('selected_start_at_invalid');
      return clarification('slot_selection_invalid_start_at', input.language, warnings);
    }

    const match = input.last_proposed_slots.find((slot) => slot.start_at === selection.selected_start_at?.trim());

    if (match !== undefined) {
      return matched(match, 'matched_selected_start_at', warnings);
    }

    warnings.push('selected_start_at_not_found');
    return clarification('slot_selection_start_at_not_found', input.language, warnings);
  }

  if (isNonEmpty(selection.selected_time)) {
    const selectedTime = selection.selected_time.trim();

    if (!isValidHourMinute(selectedTime)) {
      warnings.push('selected_time_invalid');
      return clarification('slot_selection_invalid_time', input.language, warnings);
    }

    const matches = input.last_proposed_slots.filter((slot) => getSlotTime(slot) === selectedTime);

    if (matches.length === 1) {
      return matched(matches[0], 'matched_selected_time', warnings);
    }

    if (matches.length > 1) {
      warnings.push('selected_time_ambiguous');
      return clarification('slot_selection_ambiguous_time', input.language, warnings);
    }

    warnings.push('selected_time_not_found');
    return clarification('slot_selection_time_not_found', input.language, warnings);
  }

  return clarification('slot_selection_missing_typed_value', input.language, warnings);
}

function matched(slot: RuntimeProposedSlotMemory, reason: string, warnings: string[]): RuntimeSlotChoiceResolverOutput {
  return {
    matched: true,
    selected_slot: slot,
    reason,
    warnings,
  };
}

function clarification(reason: string, language: RuntimeReplyLanguage, warnings: string[]): RuntimeSlotChoiceResolverOutput {
  return {
    matched: false,
    selected_slot: null,
    reason,
    warnings,
    reply_text: clarificationReply(language, reason),
  };
}

function clarificationReply(language: RuntimeReplyLanguage, reason: string): string {
  if (reason === 'slot_selection_no_stored_options') {
    return {
      ru: 'Пожалуйста, напишите день или время ещё раз — я проверю свежие свободные варианты.',
      uk: 'Будь ласка, напишіть день або час ще раз — я перевірю свіжі вільні варіанти.',
      cs: 'Napište prosím den nebo čas znovu — ověřím aktuální volné možnosti.',
      en: 'Please send the day or time again — I will check fresh available options.',
    }[language];
  }

  return {
    ru: 'Уточните, пожалуйста, какой вариант вам подходит — можно номер варианта или точное время.',
    uk: 'Уточніть, будь ласка, який варіант вам підходить — можна номер варіанта або точний час.',
    cs: 'Upřesněte prosím, která možnost vám vyhovuje — můžete poslat číslo možnosti nebo přesný čas.',
    en: 'Please clarify which option works for you — you can send the option number or exact time.',
  }[language];
}

function getSlotTime(slot: RuntimeProposedSlotMemory): string | null {
  const date = new Date(slot.start_at);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const timezone = typeof slot.provider_metadata.timezone === 'string' ? slot.provider_metadata.timezone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;

  return hour === undefined || minute === undefined ? null : `${hour}:${minute}`;
}

function isValidIsoDateTime(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function isValidHourMinute(value: string): boolean {
  const parts = value.split(':');

  if (parts.length !== 2 || parts[0]?.length !== 2 || parts[1]?.length !== 2) {
    return false;
  }

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);

  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isNonEmpty(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}
