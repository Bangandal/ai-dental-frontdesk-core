import Fastify, { type FastifyInstance } from 'fastify';

import { registerAvailabilityRoutes } from './http/routes/availability.routes.js';
import { registerAppointmentRoutes } from './http/routes/appointments.routes.js';
import { registerCaseRoutes } from './http/routes/cases.routes.js';
import { registerHealthRoutes } from './http/routes/health.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });

  await app.register(registerHealthRoutes);
  await app.register(registerAvailabilityRoutes);
  await app.register(registerAppointmentRoutes);
  await app.register(registerCaseRoutes);

  return app;
}
