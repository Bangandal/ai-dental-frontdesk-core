import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppointmentLifecycleService } from '../../domain/appointments/appointmentLifecycle.js';
import { createDefaultAppointmentLifecycleService, sendLifecycleResult, sendUnexpectedError, slotSchema } from './appointmentRouteSupport.js';

const holdSlotSchema = z.object({
  clinicId: z.string().uuid(),
  contactId: z.string().uuid(),
  caseId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  dedupeKey: z.string().min(1),
  slot: slotSchema,
  patientName: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
});

const confirmAppointmentSchema = z.object({
  clinicId: z.string().uuid(),
  dedupeKey: z.string().min(1),
  holdId: z.string().optional(),
  slot: slotSchema,
  contactId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  patientName: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
});

export interface AppointmentRoutesOptions {
  appointmentLifecycle?: AppointmentLifecycleService;
}

export async function registerAppointmentRoutes(
  app: FastifyInstance,
  options: AppointmentRoutesOptions = {},
): Promise<void> {
  app.post('/appointments/hold', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = holdSlotSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      const service = options.appointmentLifecycle ?? await createDefaultAppointmentLifecycleService();
      const result = await service.holdAppointment(parsed.data);

      return sendLifecycleResult(reply, result);
    } catch {
      return sendUnexpectedError(reply);
    }
  });

  app.post('/appointments/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = confirmAppointmentSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      const service = options.appointmentLifecycle ?? await createDefaultAppointmentLifecycleService();
      const result = await service.confirmAppointment(parsed.data);

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

export const appointmentRouteSchemas = {
  holdSlotSchema,
  confirmAppointmentSchema,
};
