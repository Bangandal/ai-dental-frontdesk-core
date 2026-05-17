export interface RuntimeEmbeddingClient {
  embedText(input: { text: string; trace_id?: string }): Promise<number[]>;
}

export interface OpenAIEmbeddingsClient {
  create(params: OpenAIEmbeddingsCreateParams): Promise<OpenAIEmbeddingsResponse>;
}

export interface OpenAIEmbeddingsCreateParams {
  model: string;
  input: string;
}

export interface OpenAIEmbeddingsResponse {
  data?: Array<{
    embedding?: unknown;
  }>;
}

export interface OpenAIRuntimeEmbeddingClientOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  embeddingsClient?: OpenAIEmbeddingsClient;
  openAIClientFactory?: (options: OpenAIEmbeddingClientFactoryOptions) => Promise<{ embeddings: OpenAIEmbeddingsClient }>;
}

export interface OpenAIEmbeddingClientFactoryOptions {
  apiKey: string;
  timeout?: number;
}

export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const RUNTIME_KB_EMBEDDING_DIMENSIONS = 1536;

export class RuntimeEmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly provider: string,
    readonly model: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RuntimeEmbeddingProviderError';
  }
}

export class OpenAIRuntimeEmbeddingClient implements RuntimeEmbeddingClient {
  readonly provider = 'openai';
  readonly model: string;

  private embeddingsClientPromise: Promise<OpenAIEmbeddingsClient> | undefined;

  constructor(private readonly options: OpenAIRuntimeEmbeddingClientOptions) {
    this.model = options.model?.trim() === '' || options.model === undefined
      ? DEFAULT_OPENAI_EMBEDDING_MODEL
      : options.model;

    if (options.embeddingsClient === undefined && (options.apiKey === undefined || options.apiKey.trim() === '')) {
      throw new Error('OPENAI_API_KEY is required to construct OpenAIRuntimeEmbeddingClient.');
    }
  }

  async embedText(input: { text: string; trace_id?: string }): Promise<number[]> {
    const text = input.text.trim();

    if (text === '') {
      throw new RuntimeEmbeddingProviderError(
        'Embedding input text must not be empty.',
        'embedding_empty_input',
        this.provider,
        this.model,
      );
    }

    const embeddingsClient = await this.getEmbeddingsClient();

    try {
      const response = await embeddingsClient.create({
        model: this.model,
        input: text,
      });
      const embedding = response.data?.[0]?.embedding;

      if (!Array.isArray(embedding) || !embedding.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) {
        throw Object.assign(new Error('OpenAI embedding response did not include a numeric embedding vector.'), {
          code: 'openai_embedding_invalid_response',
        });
      }

      if (embedding.length !== RUNTIME_KB_EMBEDDING_DIMENSIONS) {
        throw Object.assign(new Error(`OpenAI embedding dimension ${embedding.length} does not match required ${RUNTIME_KB_EMBEDDING_DIMENSIONS}.`), {
          code: 'openai_embedding_dimension_mismatch',
        });
      }

      return embedding;
    } catch (error) {
      if (error instanceof RuntimeEmbeddingProviderError) {
        throw error;
      }

      throw new RuntimeEmbeddingProviderError(
        readSafeEmbeddingErrorMessage(error),
        readSafeEmbeddingErrorCode(error),
        this.provider,
        this.model,
        error,
      );
    }
  }

  private async getEmbeddingsClient(): Promise<OpenAIEmbeddingsClient> {
    if (this.options.embeddingsClient !== undefined) {
      return this.options.embeddingsClient;
    }

    this.embeddingsClientPromise ??= this.createEmbeddingsClient();

    return this.embeddingsClientPromise;
  }

  private async createEmbeddingsClient(): Promise<OpenAIEmbeddingsClient> {
    const apiKey = this.options.apiKey;

    if (apiKey === undefined || apiKey.trim() === '') {
      throw new Error('OPENAI_API_KEY is required to construct OpenAIRuntimeEmbeddingClient.');
    }

    const factory = this.options.openAIClientFactory ?? defaultOpenAIClientFactory;
    const client = await factory({ apiKey, timeout: this.options.timeoutMs });

    return client.embeddings;
  }
}

async function defaultOpenAIClientFactory(options: OpenAIEmbeddingClientFactoryOptions): Promise<{ embeddings: OpenAIEmbeddingsClient }> {
  const openAIModule = await importOpenAIModule();
  const OpenAI = openAIModule.default;

  return new OpenAI({ apiKey: options.apiKey, timeout: options.timeout });
}

async function importOpenAIModule(): Promise<{ default: new (options: OpenAIEmbeddingClientFactoryOptions) => { embeddings: OpenAIEmbeddingsClient } }> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ default: new (options: OpenAIEmbeddingClientFactoryOptions) => { embeddings: OpenAIEmbeddingsClient } }>;

  return dynamicImport('openai');
}

function readSafeEmbeddingErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'OpenAI runtime embedding failed.';
}

function readSafeEmbeddingErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return 'openai_embedding_failed';
}
