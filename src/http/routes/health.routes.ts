import type { FastifyInstance } from 'fastify';

const healthResponse = {
  ok: true,
  service: 'ai-intake-core',
} as const;

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => healthResponse);
}
