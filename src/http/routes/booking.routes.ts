import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppointmentLifecycleService } from '../../domain/appointments/appointmentLifecycle.js';
import { PgAppointmentRepository } from '../../domain/appointments/appointmentRepository.js';
import { BookingApplyService } from '../../domain/booking/bookingApply.js';
import type { BookingApplyRequest } from '../../domain/booking/bookingApply.js';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const bookingApplySchema = z.object({
  clinicId: z.string().uuid(),
  contactId: z.string().uuid(),
  caseId: z.string().uuid().nullable().optional(),
  bookingAction: z.enum(['none', 'propose_slot', 'confirm_slot', 'cancel_hold']),
  serviceInterest: z.string().min(1).nullable().optional(),
  preferredDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredWeekday: z.string().min(1).nullable().optional(),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'any']).default('any'),
  preferredTimeWindow: z.object({
    startTime: timeSchema.nullable(),
    endTime: timeSchema.nullable(),
  }).optional(),
  exactTime: timeSchema.nullable().optional(),
  activeHoldId: z.string().min(1).nullable().optional(),
  patientName: z.string().min(1).nullable().optional(),
  channel: z.string().min(1).nullable().optional(),
  traceId: z.string().uuid().nullable().optional(),
  durationMinutes: z.number().int().positive().default(30),
  metadata: z.record(z.unknown()).default({}),
});

export interface BookingRoutesOptions {
  bookingApplyService?: BookingApplyService;
}

let defaultBookingApplyService: BookingApplyService | undefined;

export async function registerBookingRoutes(
  app: FastifyInstance,
  options: BookingRoutesOptions = {},
): Promise<void> {
  app.post('/booking/apply', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = bookingApplySchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      const service = options.bookingApplyService ?? await createDefaultBookingApplyService();
      const response = await service.apply(parsed.data as BookingApplyRequest);

      return reply.send(response);
    } catch {
      return reply.code(500).send({
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred while applying the booking decision.',
        },
      });
    }
  });
}

async function createDefaultBookingApplyService(): Promise<BookingApplyService> {
  if (defaultBookingApplyService !== undefined) {
    return defaultBookingApplyService;
  }

  const { pool } = await import('../../db/pool.js');
  const repository = new PgAppointmentRepository(pool);
  const appointmentLifecycle = new AppointmentLifecycleService({ repository });
  defaultBookingApplyService = new BookingApplyService(appointmentLifecycle, repository);

  return defaultBookingApplyService;
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

export const bookingRouteSchemas = {
  bookingApplySchema,
};
