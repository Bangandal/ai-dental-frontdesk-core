import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  NoopRuntimeAIClient,
  type RuntimeAIClient,
} from '../../domain/runtime/runtimeAiClient.js';
import {
  PgRuntimeTurnRepository,
  RuntimeClinicNotFoundError,
  RuntimeTurnService,
} from '../../domain/runtime/runtimeTurnService.js';
import { runtimeTurnInputSchema } from '../../domain/runtime/runtimeContracts.js';

export interface RuntimeRoutesOptions {
  runtimeTurnService?: RuntimeTurnService;
}

export interface RuntimeAIClientFactoryConfig {
  openaiRuntimeEnabled: boolean;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTimeoutMs?: number;
}

let defaultRuntimeTurnService: RuntimeTurnService | undefined;

export async function registerRuntimeRoutes(
  app: FastifyInstance,
  options: RuntimeRoutesOptions = {},
): Promise<void> {
  app.post('/runtime/turn', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = runtimeTurnInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      const service = options.runtimeTurnService ?? await createDefaultRuntimeTurnService();
      const response = await service.handleTurn(parsed.data);

      request.log.info({ trace_id: response.trace_id }, 'runtime turn handled');

      return reply.send(response);
    } catch (error) {
      if (error instanceof RuntimeClinicNotFoundError) {
        request.log.info({ trace_id: error.traceId, clinic_code: error.clinicCode }, 'runtime clinic not found');

        return reply.code(404).send({
          error: {
            code: 'clinic_not_found',
            message: 'Active clinic was not found for the provided clinic_code.',
            trace_id: error.traceId,
          },
        });
      }

      return reply.code(500).send({
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred while handling the runtime turn.',
        },
      });
    }
  });
}

async function createDefaultRuntimeTurnService(): Promise<RuntimeTurnService> {
  if (defaultRuntimeTurnService !== undefined) {
    return defaultRuntimeTurnService;
  }

  const [{ pool }, { env }] = await Promise.all([
    import('../../db/pool.js'),
    import('../../config/env.js'),
  ]);
  const aiClient = await createRuntimeAIClient({
    openaiRuntimeEnabled: env.OPENAI_RUNTIME_ENABLED,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    openaiTimeoutMs: env.OPENAI_TIMEOUT_MS,
  });

  defaultRuntimeTurnService = new RuntimeTurnService(new PgRuntimeTurnRepository(pool), aiClient);

  return defaultRuntimeTurnService;
}

export async function createRuntimeAIClient(config: RuntimeAIClientFactoryConfig): Promise<RuntimeAIClient> {
  if (!config.openaiRuntimeEnabled) {
    return new NoopRuntimeAIClient();
  }

  if (config.openaiApiKey === undefined || config.openaiApiKey.trim() === '') {
    throw new Error('OPENAI_API_KEY is required when OPENAI_RUNTIME_ENABLED=true.');
  }

  if (config.openaiModel === undefined || config.openaiModel.trim() === '') {
    throw new Error('OPENAI_MODEL is required when OPENAI_RUNTIME_ENABLED=true.');
  }

  const { OpenAIRuntimeAIClient } = await import('../../domain/runtime/openAiRuntimeClient.js');

  return new OpenAIRuntimeAIClient({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    timeoutMs: config.openaiTimeoutMs,
  });
}

function sendValidationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.code(400).send({
    error: {
      code: 'validation_failed',
      message: 'Request body failed validation.',
      details,
    },
  });
}
