import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { HealthResponse, ReadinessResponse } from '@dayfront/shared';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Logger } from 'pino';

import { getPublicConfig, type DayFrontConfig } from './config.js';
import { CalDavClient } from './caldav/client.js';
import { calendarRouter } from './calendar/routes.js';
import { CalendarSubscriptionService } from './calendar/subscriptions.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { mutationRateLimit, securityHeaders } from './security.js';

interface DayFrontLocals {
  requestId: string;
}

export interface AppDependencies {
  config: DayFrontConfig;
  logger: Logger;
  caldav?: CalDavClient;
  webRoot?: string;
  subscriptionFetch?: typeof fetch;
}

export function createApp({
  config,
  logger,
  caldav,
  webRoot,
  subscriptionFetch,
}: AppDependencies) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);
  app.use(securityHeaders());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    (
      request: Request,
      response: Response<unknown, DayFrontLocals>,
      next: NextFunction,
    ) => {
      const requestId = request.header('x-request-id') ?? randomUUID();
      response.locals.requestId = requestId;
      response.setHeader('x-request-id', requestId);
      response.on('finish', () => {
        logger.info(
          {
            requestId,
            method: request.method,
            path: request.path,
            status: response.statusCode,
          },
          'request completed',
        );
      });
      next();
    },
  );

  app.get(
    '/health',
    (_request: Request, response: Response<HealthResponse, DayFrontLocals>) => {
      const body: HealthResponse = {
        data: { status: 'ok', service: 'dayfront-api' },
        meta: { requestId: response.locals.requestId },
      };

      response.json(body);
    },
  );

  app.get(
    '/ready',
    (
      _request: Request,
      response: Response<ReadinessResponse, DayFrontLocals>,
    ) => {
      // The live CalDAV readiness check remains pending.
      const body: ReadinessResponse = {
        data: {
          status: 'not-ready',
          checks: { configuration: 'ok', caldav: 'pending' },
        },
        meta: { requestId: response.locals.requestId },
      };

      response.status(503).json(body);
    },
  );

  app.get('/api/v1/config', (_request, response) => {
    response.json({
      data: getPublicConfig(config),
      meta: { requestId: String(response.locals.requestId) },
    });
  });

  app.use(
    '/api/v1',
    mutationRateLimit(),
    calendarRouter(
      caldav ?? new CalDavClient(config.caldav),
      config.calendar.maxOccurrences,
      new CalendarSubscriptionService(
        config.calendarSubscriptions,
        logger,
        subscriptionFetch,
      ),
    ),
  );

  if (webRoot) {
    const index = resolve(webRoot, 'index.html');
    app.use(express.static(webRoot, { index: false }));
    app.use((request, response, next) => {
      if (
        request.method === 'GET' &&
        !request.path.startsWith('/api/') &&
        request.accepts('html')
      ) {
        response.sendFile(index);
        return;
      }
      next();
    });
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
