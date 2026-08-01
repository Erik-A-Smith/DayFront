import type { ErrorRequestHandler, RequestHandler } from 'express';

import type { Logger } from 'pino';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: readonly { path?: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFoundHandler(): RequestHandler {
  return (request, _response, next) => {
    next(
      new ApiError(
        404,
        'NOT_FOUND',
        `No endpoint matches ${request.method} ${request.path}.`,
      ),
    );
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    void next;
    const requestId = String(response.locals.requestId ?? 'unknown');
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');

    if (apiError.status >= 500)
      logger.error({ err: error, requestId }, apiError.message);
    else logger.warn({ code: apiError.code, requestId }, apiError.message);

    response.status(apiError.status).json({
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details ? { details: apiError.details } : {}),
        requestId,
      },
    });
  };
}
