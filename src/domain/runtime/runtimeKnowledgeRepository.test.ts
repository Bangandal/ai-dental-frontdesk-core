import { describe, expect, it } from 'vitest';

import {
  formatPgVector,
  PgRuntimeKnowledgeRepository,
  RUNTIME_KB_RETRIEVAL_SQL,
} from './runtimeKnowledgeRepository.js';

function makeEmbedding(value = 0.1): number[] {
  return Array.from({ length: 1536 }, () => value);
}

describe('PgRuntimeKnowledgeRepository', () => {
  it('calls the real kb.rpc_retrieve_context_json pgvector RPC and maps hits', async () => {
    const db = new FakeQueryable({
      hits: [{
        title: 'Hygiene price',
        content: 'Професійна гігієна коштує від 1200 грн.',
        metadata: { source_type: 'faq' },
        similarity: 0.82,
      }],
      count: 1,
      top_similarity: 0.82,
      context_text: 'Професійна гігієна коштує від 1200 грн.',
    });
    const repository = new PgRuntimeKnowledgeRepository(db, { retrievalLimit: 7, minSimilarity: 0.66 });
    const embedding = makeEmbedding();

    const result = await repository.retrieve({
      clinicId: '11111111-1111-1111-1111-111111111111',
      queryEmbedding: embedding,
    });

    expect(db.calls).toEqual([{ 
      sql: RUNTIME_KB_RETRIEVAL_SQL,
      values: [
        '11111111-1111-1111-1111-111111111111',
        formatPgVector(embedding),
        7,
        0.66,
      ],
    }]);
    expect(result).toEqual({
      found: true,
      count: 1,
      top_similarity: 0.82,
      context_text: 'Професійна гігієна коштує від 1200 грн.',
      snippets: [{
        title: 'Hygiene price',
        content: 'Професійна гігієна коштує від 1200 грн.',
        metadata: { source_type: 'faq' },
        score: 0.82,
        source_type: 'faq',
      }],
    });
  });

  it('formats vectors safely for pgvector', () => {
    const embedding = [0.1, 0.2, ...Array.from({ length: 1534 }, () => 0)];

    expect(formatPgVector(embedding)).toBe(`[0.1,0.2,${Array.from({ length: 1534 }, () => '0').join(',')}]`);
  });

  it('rejects wrong embedding dimensions before SQL', async () => {
    const db = new FakeQueryable({});
    const repository = new PgRuntimeKnowledgeRepository(db);

    await expect(repository.retrieve({
      clinicId: '11111111-1111-1111-1111-111111111111',
      queryEmbedding: [0.1, 0.2],
    })).rejects.toThrow('Runtime KB embedding dimension 2 does not match required 1536.');
    expect(db.calls).toEqual([]);
  });
});

class FakeQueryable {
  constructor(private readonly result: unknown) {}

  readonly calls: Array<{ sql: string; values?: unknown[] }> = [];

  async query<T extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ sql, values });

    return { rows: [{ result: this.result } as T] };
  }
}
