import type { RuntimeKnowledgeResult, RuntimeKnowledgeSnippet } from './runtimeKnowledgeRepository.js';
import type { RuntimeReplyLanguage } from './runtimeReplyLanguage.js';

export interface RuntimeKnowledgeReplyComposerInput {
  knowledge_result: RuntimeKnowledgeResult;
  language: RuntimeReplyLanguage;
  trace_id: string;
  debug: Record<string, unknown>;
}

export interface RuntimeKnowledgeReplyComposerOutput {
  reply_text: string | null;
}

export interface RuntimeKnowledgeReplyComposer {
  readonly provider: string;
  readonly model?: string;
  compose(input: RuntimeKnowledgeReplyComposerInput): Promise<RuntimeKnowledgeReplyComposerOutput>;
}

const maxReplyLength = 600;

export class DeterministicRuntimeKnowledgeReplyComposer implements RuntimeKnowledgeReplyComposer {
  readonly provider = 'deterministic';

  async compose(input: RuntimeKnowledgeReplyComposerInput): Promise<RuntimeKnowledgeReplyComposerOutput> {
    const replyText = buildDeterministicKnowledgeReply(input.knowledge_result, input.language);

    input.debug.kb_reply_composer = {
      provider: this.provider,
      model: null,
      language: input.language,
      used: replyText !== null,
      fallback: true,
    };

    return { reply_text: replyText };
  }
}

export function buildDeterministicKnowledgeReply(
  knowledgeResult: RuntimeKnowledgeResult | null | undefined,
  language: RuntimeReplyLanguage,
): string | null {
  if (knowledgeResult?.found !== true) {
    return null;
  }

  const candidates = [knowledgeResult.context_text, ...knowledgeResult.snippets.map((snippet) => snippet.content)];

  for (const candidate of candidates) {
    const cleaned = cleanKnowledgeText(candidate, language, knowledgeResult.snippets);

    if (cleaned !== null) {
      return cleaned;
    }
  }

  return null;
}

function cleanKnowledgeText(
  value: string | null | undefined,
  language: RuntimeReplyLanguage,
  snippets: RuntimeKnowledgeSnippet[],
): string | null {
  const trimmed = readNonEmpty(value);

  if (trimmed === null) {
    return null;
  }

  const languageSection = selectLanguageSection(trimmed, language);
  const source = languageSection ?? trimmed;
  const cleaned = source
    .split('\n')
    .map((line) => line.replace(/^\s*\[\d+\]\s*/u, '').replace(/^\s*(?:chunk|source|snippet)\s*[:#-]?\s*/iu, '').trim())
    .filter((line) => line !== '')
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();

  const withoutLanguageLabels = cleaned.replace(/^(?:ru|uk|cs|en|рус(?:ский)?|укр(?:аїнська)?|cz|чешский|english)\s*[:：-]\s*/iu, '').trim();
  const concise = firstReasonableSentence(withoutLanguageLabels, snippets) ?? withoutLanguageLabels;

  if (concise === '' || concise.length > maxReplyLength) {
    return concise.slice(0, maxReplyLength).trim() || null;
  }

  return concise;
}

function selectLanguageSection(text: string, language: RuntimeReplyLanguage): string | null {
  const labels = languageLabels(language).join('|');
  const otherLabels = ['ru', 'uk', 'cs', 'cz', 'en', 'русский', 'рус', 'українська', 'укр', 'украинский', 'чешский', 'english']
    .filter((label) => !languageLabels(language).includes(label))
    .join('|');
  const sectionPattern = new RegExp(`(?:^|\\n)\\s*(?:${labels})\\s*[:：-]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${otherLabels})\\s*[:：-]|$)`, 'iu');
  const match = sectionPattern.exec(text);

  return readNonEmpty(match?.[1]) ?? null;
}

function languageLabels(language: RuntimeReplyLanguage): string[] {
  if (language === 'ru') {
    return ['ru', 'русский', 'рус'];
  }

  if (language === 'uk') {
    return ['uk', 'укр', 'українська', 'украинский'];
  }

  if (language === 'cs') {
    return ['cs', 'cz', 'чешский'];
  }

  return ['en', 'english'];
}

function firstReasonableSentence(value: string, snippets: RuntimeKnowledgeSnippet[]): string | null {
  const maxSentences = snippets.length > 1 ? 2 : 1;
  const parts = value.split(/(?<=[.!?。])\s+/u).filter((part) => part.trim() !== '');

  if (parts.length === 0) {
    return null;
  }

  return parts.slice(0, maxSentences).join(' ').trim();
}

function readNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
