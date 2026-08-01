import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../src/errors.js';
import { createLogger } from '../src/logger.js';
import { mutationRateLimit, securityHeaders } from '../src/security.js';

describe('HTTP hardening', () => {
  it('sets browser security headers without enabling cross-origin access', async () => {
    const app = express()
      .use(securityHeaders())
      .get('/', (_request, response) => {
        response.json({ ok: true });
      });
    const response = await request(app).get('/').expect(200);

    expect(response.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('throttles repeated mutations by client address', async () => {
    const app = express();
    app.use(mutationRateLimit(2, 60_000));
    app.post('/', (_request, response) => response.status(204).send());
    app.use(errorHandler(createLogger({ level: 'fatal', format: 'json' })));

    await request(app).post('/').expect(204);
    await request(app).post('/').expect(204);
    const response = await request(app).post('/').expect(429);
    expect(response.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(response.headers['retry-after']).toBeDefined();
  });
});
