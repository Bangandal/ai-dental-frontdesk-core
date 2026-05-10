import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AppointmentLifecycleResult } from '../../domain/appointments/appointmentLifecycle.js';
import { AppointmentLifecycleService } from '../../domain/appointments/appointmentLifecycle.js';
import { PgAppointmentRepository } from '../../domain/appointments/appointmentRepository.js';

export const slotSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().min(1),
  provider: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

let defaultService: AppointmentLifecycleService | undefined;

export async function createDefaultAppointmentLifecycleService(): Promise<AppointmentLifecycleService> {
  if (defaultService !== undefined) {
    return defaultService;
  }

  const { pool } = await import('../../db/pool.js');
  defaultService = new AppointmentLifecycleService({
    repository: new PgAppointmentRepository(pool),
  });

  return defaultService;
}

export function sendLifecycleResult<T>(
  reply: FastifyReply,
  result: AppointmentLifecycleResult<T>,
): FastifyReply {
  if (result.ok) {
    return reply.send(result.data);
  }

  return reply.code(result.error.statusCode).send({
    error: {
      code: result.error.code,
      message: result.error.message,
      details: result.error.details,
    },
  });
}

export function sendUnexpectedError(reply: FastifyReply): FastifyReply {
  return reply.code(500).send({
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred while processing the request.',
    },
  });
}
