import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { CaseRepository } from '../../domain/cases/caseRepository.js';
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

export interface CaseRoutesOptions {
  caseRepository?: CaseRepository;
}

export async function registerCaseRoutes(
  app: FastifyInstance,
  options: CaseRoutesOptions = {},
): Promise<void> {
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
      const repository = options.caseRepository ?? await createDefaultCaseRepository();
      const result = await resolveCase(parsed.data, repository);
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

async function createDefaultCaseRepository(): Promise<CaseRepository> {
  const { pool } = await import('../../db/pool.js');
  return new PgCaseRepository(pool);
}

export const caseRouteSchemas = {
  resolveCaseSchema,
};
