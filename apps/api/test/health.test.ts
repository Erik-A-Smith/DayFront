import {
  healthResponseSchema,
  publicConfigSchema,
  readinessResponseSchema,
} from '@dayfront/shared';
import request from 'supertest';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const config = loadConfig({
  environment: {
    DAYFRONT_CALDAV_URL: 'http://radicale:5232',
    DAYFRONT_CALDAV_USERNAME: 'dayfront',
    DAYFRONT_CALDAV_PASSWORD: 'test-secret',
  },
});
const app = createApp({
  config,
  logger: createLogger({ level: 'fatal', format: 'json' }),
});

describe('service status', () => {
  it('reports liveness with a request ID', async () => {
    const response = await request(app).get('/health').expect(200);
    const body = healthResponseSchema.parse(response.body);

    expect(body.data.status).toBe('ok');
    expect(response.headers['x-request-id']).toBe(body.meta.requestId);
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('exposes only public configuration', async () => {
    const response = await request(app).get('/api/v1/config').expect(200);
    const serialized = JSON.stringify(response.body);
    const body = publicConfigSchema.parse(response.body);
    expect(serialized).not.toContain('test-secret');
    expect(serialized).not.toContain('radicale');
    expect(body.data).toHaveProperty('ui');
    expect(body.data).toHaveProperty('calendar');
  });

  it('serves the production SPA without masking API errors', async () => {
    const webApp = createApp({
      config,
      logger: createLogger({ level: 'fatal', format: 'json' }),
      webRoot: resolve(import.meta.dirname, '../../../tests/fixtures/web'),
    });
    const page = await request(webApp)
      .get('/calendar/deep-link')
      .set('Accept', 'text/html')
      .expect(200);
    expect(page.text).toContain('DayFront production shell');
    await request(webApp).get('/api/v1/missing').expect(404);
  });

  it('reports pending readiness until configuration is implemented', async () => {
    const response = await request(app).get('/ready').expect(503);
    const body = readinessResponseSchema.parse(response.body);

    expect(body.data).toEqual({
      status: 'not-ready',
      checks: { configuration: 'ok', caldav: 'pending' },
    });
  });

  it('returns consistent errors with request IDs', async () => {
    const response = await request(app)
      .get('/missing')
      .set('x-request-id', 'test-request-id')
      .expect(404);

    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'No endpoint matches GET /missing.',
        requestId: 'test-request-id',
      },
    });
  });
});
