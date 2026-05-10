import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = await buildApp();

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

await app.listen({ host: env.HOST, port: env.PORT });
