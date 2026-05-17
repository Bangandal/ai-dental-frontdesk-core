import type { RuntimeTurnInput } from './runtimeContracts.js';
import type { RuntimeClinicRecord } from './runtimeTurnService.js';

export type RuntimeReplyLanguage = 'ru' | 'uk' | 'cs' | 'en';

const supportedLanguages = new Set<RuntimeReplyLanguage>(['ru', 'uk', 'cs', 'en']);
const fallbackLanguage: RuntimeReplyLanguage = 'ru';

export function resolveRuntimeReplyLanguage(input: {
  meta?: RuntimeTurnInput['meta'];
  clinic: RuntimeClinicRecord;
}): RuntimeReplyLanguage {
  return normalizeRuntimeReplyLanguage(input.meta?.language_code)
    ?? normalizeRuntimeReplyLanguage(readDefaultLanguage(input.clinic.settings))
    ?? fallbackLanguage;
}

export function normalizeRuntimeReplyLanguage(value: unknown): RuntimeReplyLanguage | null {
  if (typeof value !== 'string') {
    return null;
  }

  const primarySubtag = value.trim().toLowerCase().split('-')[0];

  return supportedLanguages.has(primarySubtag as RuntimeReplyLanguage) ? primarySubtag as RuntimeReplyLanguage : null;
}

function readDefaultLanguage(settings: Record<string, unknown>): unknown {
  return settings.default_language ?? settings.defaultLanguage;
}
