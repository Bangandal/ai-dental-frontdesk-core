import { describe, expect, it, vi } from 'vitest';

import { OpenAIRuntimeEmbeddingClient } from './runtimeEmbeddingClient.js';

function makeEmbedding(): number[] {
  return Array.from({ length: 1536 }, (_, index) => index / 1536);
}

describe('OpenAIRuntimeEmbeddingClient', () => {
  it('returns a 1536-dimension embedding from the OpenAI embeddings client', async () => {
    const embedding = makeEmbedding();
    const embeddingsClient = {
      create: vi.fn().mockResolvedValue({ data: [{ embedding }] }),
    };
    const client = new OpenAIRuntimeEmbeddingClient({
      embeddingsClient,
      model: 'text-embedding-3-small',
    });

    await expect(client.embedText({ text: 'faq_topic: price', trace_id: 'trace-1' })).resolves.toEqual(embedding);
    expect(embeddingsClient.create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'faq_topic: price',
    });
  });

  it('rejects embedding responses that are not 1536 dimensions', async () => {
    const client = new OpenAIRuntimeEmbeddingClient({
      embeddingsClient: { create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }) },
    });

    await expect(client.embedText({ text: 'faq_topic: price' })).rejects.toMatchObject({
      code: 'openai_embedding_dimension_mismatch',
    });
  });
});
