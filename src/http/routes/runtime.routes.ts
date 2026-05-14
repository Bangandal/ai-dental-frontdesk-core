import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  PgRuntimeTurnRepository,
  RuntimeClinicNotFoundError,
  RuntimeTurnService,
} from '../../domain/runtime/runtimeTurnService.js';
import { runtimeTurnInputSchema } from '../../domain/runtime/runtimeContracts.js';

export interface RuntimeRoutesOptions {
  runtimeTurnService?: RuntimeTurnService;
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

  const { pool } = await import('../../db/pool.js');
  defaultRuntimeTurnService = new RuntimeTurnService(new PgRuntimeTurnRepository(pool));

  return defaultRuntimeTurnService;
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
