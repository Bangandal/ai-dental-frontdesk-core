import { RUNTIME_KB_EMBEDDING_DIMENSIONS } from './runtimeEmbeddingClient.js';

export interface RuntimeKnowledgeSnippet {
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  score: number | null;
  source_type: string | null;
}

export interface RuntimeKnowledgeResult {
  found: boolean;
  snippets: RuntimeKnowledgeSnippet[];
  count: number;
  top_similarity: number | null;
  context_text: string | null;
}

export interface RuntimeKnowledgeRetrieveInput {
  clinicId: string;
  queryEmbedding: number[];
  limit?: number;
  minSimilarity?: number;
  trace_id?: string;
}

export interface RuntimeKnowledgeRepository {
  retrieve(input: RuntimeKnowledgeRetrieveInput): Promise<RuntimeKnowledgeResult>;
}

export interface RuntimeKnowledgeQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

interface RuntimeKnowledgeRow extends Record<string, unknown> {
  result: unknown;
}

export const DEFAULT_KB_RETRIEVAL_LIMIT = 5;
export const DEFAULT_KB_MIN_SIMILARITY = 0.55;
export const RUNTIME_KB_RETRIEVAL_SQL = 'select kb.rpc_retrieve_context_json($1::uuid, $2::public.vector, $3::integer, $4::real) as result';

export class NoopRuntimeKnowledgeRepository implements RuntimeKnowledgeRepository {
  async retrieve(): Promise<RuntimeKnowledgeResult> {
    return emptyRuntimeKnowledgeResult();
  }
}

export interface PgRuntimeKnowledgeRepositoryOptions {
  retrievalLimit?: number;
  minSimilarity?: number;
}

export class PgRuntimeKnowledgeRepository implements RuntimeKnowledgeRepository {
  constructor(
    private readonly db: RuntimeKnowledgeQueryable,
    private readonly options: PgRuntimeKnowledgeRepositoryOptions = {},
  ) {}

  async retrieve(input: RuntimeKnowledgeRetrieveInput): Promise<RuntimeKnowledgeResult> {
    validateEmbeddingDimension(input.queryEmbedding);

    const result = await this.db.query<RuntimeKnowledgeRow>(
      RUNTIME_KB_RETRIEVAL_SQL,
      [
        input.clinicId,
        formatPgVector(input.queryEmbedding),
        input.limit ?? this.options.retrievalLimit ?? DEFAULT_KB_RETRIEVAL_LIMIT,
        input.minSimilarity ?? this.options.minSimilarity ?? DEFAULT_KB_MIN_SIMILARITY,
      ],
    );

    return mapRuntimeKnowledgeResult(result.rows[0]?.result);
  }
}

export function validateEmbeddingDimension(embedding: number[]): void {
  if (embedding.length !== RUNTIME_KB_EMBEDDING_DIMENSIONS) {
    throw new Error(`Runtime KB embedding dimension ${embedding.length} does not match required ${RUNTIME_KB_EMBEDDING_DIMENSIONS}.`);
  }

  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error('Runtime KB embedding contains a non-finite number.');
    }
  }
}

export function formatPgVector(embedding: number[]): string {
  validateEmbeddingDimension(embedding);

  return `[${embedding.map((value) => String(value)).join(',')}]`;
}

function mapRuntimeKnowledgeResult(value: unknown): RuntimeKnowledgeResult {
  const record = readRecord(value);

  if (record === null) {
    return emptyRuntimeKnowledgeResult();
  }

  const snippets = readKnowledgeHits(record.hits);
  const count = readFiniteNumber(record.count) ?? snippets.length;
  const topSimilarity = readFiniteNumber(record.top_similarity);
  const contextText = readNonEmptyString(record.context_text);

  return {
    found: count > 0 && snippets.length > 0,
    snippets,
    count,
    top_similarity: topSimilarity,
    context_text: contextText,
  };
}

function readKnowledgeHits(value: unknown): RuntimeKnowledgeSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const snippets: RuntimeKnowledgeSnippet[] = [];

  for (const item of value) {
    const record = readRecord(item);

    if (record === null) {
      continue;
    }

    const content = readNonEmptyString(record.content);

    if (content === null) {
      continue;
    }

    const metadata = readRecord(record.metadata) ?? {};
    const sourceType = readNonEmptyString(metadata.source_type);

    snippets.push({
      title: readNonEmptyString(record.title),
      content,
      metadata,
      score: readFiniteNumber(record.similarity) ?? readFiniteNumber(record.score),
      source_type: sourceType,
    });
  }

  return snippets;
}

function emptyRuntimeKnowledgeResult(): RuntimeKnowledgeResult {
  return {
    found: false,
    snippets: [],
    count: 0,
    top_similarity: null,
    context_text: null,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
