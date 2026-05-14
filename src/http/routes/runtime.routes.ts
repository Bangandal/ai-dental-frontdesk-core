import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { RuntimeTurnService } from '../../domain/runtime/runtimeTurnService.js';
import { runtimeTurnInputSchema } from '../../domain/runtime/runtimeContracts.js';

export interface RuntimeRoutesOptions {
  runtimeTurnService?: RuntimeTurnService;
}

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
      const service = options.runtimeTurnService ?? new RuntimeTurnService();
      const response = await service.handleTurn(parsed.data);

      request.log.info({ trace_id: response.trace_id }, 'runtime turn handled');

      return reply.send(response);
    } catch {
      return reply.code(500).send({
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred while handling the runtime turn.',
        },
      });
    }
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
