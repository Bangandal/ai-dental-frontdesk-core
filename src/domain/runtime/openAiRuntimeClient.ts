import { parseRuntimeAIOutput, type RuntimeAIClient, type RuntimeAIExtractionInput } from './runtimeAiClient.js';
import { runtimeAIOutputJsonSchema } from './runtimeAiSchema.js';
import type { RuntimeAIOutput } from './runtimeContracts.js';

export interface OpenAIResponsesClient {
  create(params: OpenAIResponsesCreateParams): Promise<OpenAIResponsesResponse>;
}

export interface OpenAIResponsesCreateParams {
  model: string;
  instructions: string;
  input: string;
  text: {
    format: {
      type: 'json_schema';
      name: string;
      schema: typeof runtimeAIOutputJsonSchema;
      strict: true;
    };
  };
}

export interface OpenAIResponsesResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

export interface OpenAIRuntimeAIClientOptions {
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  responsesClient?: OpenAIResponsesClient;
  openAIClientFactory?: (options: OpenAIClientFactoryOptions) => Promise<{ responses: OpenAIResponsesClient }>;
}

export interface OpenAIClientFactoryOptions {
  apiKey: string;
  timeout?: number;
}

export class RuntimeAIProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly provider: string,
    readonly model: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RuntimeAIProviderError';
  }
}

export class OpenAIRuntimeAIClient implements RuntimeAIClient {
  readonly provider = 'openai';
  readonly model: string;

  private responsesClientPromise: Promise<OpenAIResponsesClient> | undefined;

  constructor(private readonly options: OpenAIRuntimeAIClientOptions) {
    if (options.model.trim() === '') {
      throw new Error('OPENAI_MODEL is required to construct OpenAIRuntimeAIClient.');
    }

    if (options.responsesClient === undefined && (options.apiKey === undefined || options.apiKey.trim() === '')) {
      throw new Error('OPENAI_API_KEY is required to construct OpenAIRuntimeAIClient.');
    }

    this.model = options.model;
  }

  async extract(input: RuntimeAIExtractionInput): Promise<RuntimeAIOutput> {
    const responsesClient = await this.getResponsesClient();

    try {
      const response = await responsesClient.create({
        model: this.model,
        instructions: input.system_prompt,
        input: JSON.stringify({
          trace_id: input.trace_id,
          prompt_version: input.prompt_version,
          context: input.context,
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'runtime_ai_output',
            schema: runtimeAIOutputJsonSchema,
            strict: true,
          },
        },
      });
      const responseText = readOpenAIResponseText(response);
      const parsedJson = JSON.parse(responseText) as unknown;

      return parseRuntimeAIOutput(parsedJson);
    } catch (error) {
      if (error instanceof RuntimeAIProviderError) {
        throw error;
      }

      throw new RuntimeAIProviderError(
        readSafeErrorMessage(error),
        readSafeErrorCode(error),
        this.provider,
        this.model,
        error,
      );
    }
  }

  private async getResponsesClient(): Promise<OpenAIResponsesClient> {
    if (this.options.responsesClient !== undefined) {
      return this.options.responsesClient;
    }

    this.responsesClientPromise ??= this.createResponsesClient();

    return this.responsesClientPromise;
  }

  private async createResponsesClient(): Promise<OpenAIResponsesClient> {
    const apiKey = this.options.apiKey;

    if (apiKey === undefined || apiKey.trim() === '') {
      throw new Error('OPENAI_API_KEY is required to construct OpenAIRuntimeAIClient.');
    }

    const factory = this.options.openAIClientFactory ?? defaultOpenAIClientFactory;
    const client = await factory({ apiKey, timeout: this.options.timeoutMs });

    return client.responses;
  }
}

export function readOpenAIResponseText(response: OpenAIResponsesResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text;
  }

  for (const outputItem of response.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (typeof contentItem.text === 'string' && contentItem.text.length > 0) {
        return contentItem.text;
      }
    }
  }

  throw Object.assign(new Error('OpenAI response did not include structured output text.'), {
    code: 'openai_empty_response',
  });
}

async function defaultOpenAIClientFactory(options: OpenAIClientFactoryOptions): Promise<{ responses: OpenAIResponsesClient }> {
  const openAIModule = await importOpenAIModule();
  const OpenAI = openAIModule.default;

  return new OpenAI({ apiKey: options.apiKey, timeout: options.timeout });
}

async function importOpenAIModule(): Promise<{ default: new (options: OpenAIClientFactoryOptions) => { responses: OpenAIResponsesClient } }> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ default: new (options: OpenAIClientFactoryOptions) => { responses: OpenAIResponsesClient } }>;

  return dynamicImport('openai');
}

function readSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'OpenAI runtime AI extraction failed.';
}

function readSafeErrorCode(error: unknown): string {
  if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) {
    return 'invalid_ai_output';
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;

    if (typeof code === 'string' && code.trim() !== '') {
      return code;
    }
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;

    if (typeof status === 'number') {
      return `openai_http_${status}`;
    }
  }

  return 'openai_request_failed';
}
