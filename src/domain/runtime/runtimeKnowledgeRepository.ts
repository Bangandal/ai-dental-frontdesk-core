import type { RuntimeAIOutput, RuntimeTurnInput } from './runtimeContracts.js';

export interface RuntimeKnowledgeSearchInput {
  clinic_id: string;
  faq_topic: RuntimeAIOutput['faq_topic'];
  service_interest: string | null;
  user_text: string;
  language: string | null;
  channel: RuntimeTurnInput['channel'];
  trace_id: string;
  limit: number;
}

export interface RuntimeKnowledgeSnippet {
  title?: string;
  content: string;
  source_type?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeKnowledgeResult {
  found: boolean;
  snippets: RuntimeKnowledgeSnippet[];
  debug?: Record<string, unknown>;
}

export interface RuntimeKnowledgeRepository {
  searchClinicKnowledge(input: RuntimeKnowledgeSearchInput): Promise<RuntimeKnowledgeResult>;
}

export class NoopRuntimeKnowledgeRepository implements RuntimeKnowledgeRepository {
  async searchClinicKnowledge(): Promise<RuntimeKnowledgeResult> {
    return {
      found: false,
      snippets: [],
      debug: { provider: 'noop', reason: 'kb_repository_not_configured' },
    };
  }
}

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface PgRuntimeKnowledgeRepositoryOptions {
  rpcName: string;
}

export class PgRuntimeKnowledgeRepository implements RuntimeKnowledgeRepository {
  private readonly rpcSqlName: string;

  constructor(
    private readonly db: Queryable,
    options: PgRuntimeKnowledgeRepositoryOptions,
  ) {
    this.rpcSqlName = formatQualifiedRpcName(options.rpcName);
  }

  async searchClinicKnowledge(input: RuntimeKnowledgeSearchInput): Promise<RuntimeKnowledgeResult> {
    const result = await this.db.query<{ result: unknown }>(
      `select ${this.rpcSqlName}($1::jsonb) as result`,
      [JSON.stringify(input)],
    );

    return normalizeKnowledgeResult(result.rows[0]?.result);
  }
}

function normalizeKnowledgeResult(value: unknown): RuntimeKnowledgeResult {
  const objectValue = readRecord(value);
  const snippetsValue = objectValue?.snippets;
  const snippets = Array.isArray(snippetsValue)
    ? snippetsValue.map(normalizeKnowledgeSnippet).filter((snippet): snippet is RuntimeKnowledgeSnippet => snippet !== null)
    : [];
  const foundValue = objectValue?.found;

  return {
    found: typeof foundValue === 'boolean' ? foundValue && snippets.length > 0 : snippets.length > 0,
    snippets,
    debug: readRecord(objectValue?.debug),
  };
}

function normalizeKnowledgeSnippet(value: unknown): RuntimeKnowledgeSnippet | null {
  const objectValue = readRecord(value);
  const content = readNonEmptyString(objectValue?.content);

  if (content === undefined) {
    return null;
  }

  const snippet: RuntimeKnowledgeSnippet = { content };
  const title = readNonEmptyString(objectValue?.title);
  const sourceType = readNonEmptyString(objectValue?.source_type);
  const score = readFiniteNumber(objectValue?.score);
  const metadata = readRecord(objectValue?.metadata);

  if (title !== undefined) {
    snippet.title = title;
  }

  if (sourceType !== undefined) {
    snippet.source_type = sourceType;
  }

  if (score !== undefined) {
    snippet.score = score;
  }

  if (metadata !== undefined) {
    snippet.metadata = metadata;
  }

  return snippet;
}

function formatQualifiedRpcName(rpcName: string): string {
  const parts = rpcName.split('.');

  if (parts.length < 1 || parts.length > 2) {
    throw new Error('Runtime KB RPC name must be either function_name or schema.function_name.');
  }

  return parts.map(formatSqlIdentifier).join('.');
}

function formatSqlIdentifier(identifier: string): string {
  if (!isSafeSqlIdentifier(identifier)) {
    throw new Error('Runtime KB RPC name contains an unsafe SQL identifier.');
  }

  return `"${identifier}"`;
}

function isSafeSqlIdentifier(identifier: string): boolean {
  if (identifier.length === 0) {
    return false;
  }

  const first = identifier.charCodeAt(0);

  if (!isAsciiLetter(first) && first !== underscoreCode) {
    return false;
  }

  for (let index = 1; index < identifier.length; index += 1) {
    const code = identifier.charCodeAt(index);

    if (!isAsciiLetter(code) && !isAsciiDigit(code) && code !== underscoreCode) {
      return false;
    }
  }

  return true;
}

function isAsciiLetter(code: number): boolean {
  return (code >= uppercaseACode && code <= uppercaseZCode) || (code >= lowercaseACode && code <= lowercaseZCode);
}

function isAsciiDigit(code: number): boolean {
  return code >= zeroCode && code <= nineCode;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const uppercaseACode = 65;
const uppercaseZCode = 90;
const lowercaseACode = 97;
const lowercaseZCode = 122;
const zeroCode = 48;
const nineCode = 57;
const underscoreCode = 95;
