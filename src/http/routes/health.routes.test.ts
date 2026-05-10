import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';

describe('GET /health', () => {
  it('returns the service health payload', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, service: 'ai-intake-core' });
    } finally {
      await app.close();
    }
  });
});
