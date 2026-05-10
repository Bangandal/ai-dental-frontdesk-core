import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppointmentLifecycleService } from '../../domain/appointments/appointmentLifecycle.js';
import { createDefaultAppointmentLifecycleService, sendLifecycleResult, sendUnexpectedError, slotSchema } from './appointmentRouteSupport.js';

const checkAvailabilitySchema = z.object({
  clinicId: z.string().uuid(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  durationMinutes: z.number().int().positive().optional(),
  service: z.string().min(1).optional(),
  providerMetadata: z.record(z.unknown()).optional(),
});

export interface AvailabilityRoutesOptions {
  appointmentLifecycle?: AppointmentLifecycleService;
}

export async function registerAvailabilityRoutes(
  app: FastifyInstance,
  options: AvailabilityRoutesOptions = {},
): Promise<void> {
  app.post('/availability/check', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = checkAvailabilitySchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      const service = options.appointmentLifecycle ?? await createDefaultAppointmentLifecycleService();
      const result = await service.checkAvailability(parsed.data);

      return sendLifecycleResult(reply, result);
    } catch {
      return sendUnexpectedError(reply);
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

export const availabilityRouteSchemas = {
  checkAvailabilitySchema,
  slotSchema,
};
