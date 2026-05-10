import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { PgCaseRepository } from '../../domain/cases/caseRepository.js';
import { resolveCase } from '../../domain/cases/resolveCase.js';

const resolveCaseSchema = z.object({
  clinic_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  conversation_intent: z.string().min(1),
  requested_action: z.string().min(1).optional(),
  slot_updates: z.record(z.unknown()).optional(),
  booking: z.record(z.unknown()).optional(),
  current_text: z.string().optional(),
});

export async function registerCaseRoutes(app: FastifyInstance): Promise<void> {
  app.post('/cases/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = resolveCaseSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Request body failed validation.',
          details: parsed.error.flatten(),
        },
      });
    }

    try {
      const { pool } = await import('../../db/pool.js');
      const result = await resolveCase(parsed.data, new PgCaseRepository(pool));
      return reply.send(result);
    } catch {
      return reply.code(500).send({
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred while resolving the case.',
        },
      });
    }
  });
}

export const caseRouteSchemas = {
  resolveCaseSchema,
};
