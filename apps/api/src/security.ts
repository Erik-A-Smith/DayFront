import type { RequestHandler } from 'express';

import { ApiError } from './errors.js';

export function securityHeaders(): RequestHandler {
  return (request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
    if (request.secure)
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    next();
  };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function mutationRateLimit(
  limit = 120,
  windowMs = 60_000,
): RequestHandler {
  const buckets = new Map<string, RateBucket>();
  return (request, response, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      next();
      return;
    }
    const now = Date.now();
    const key = request.ip ?? 'unknown';
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    response.setHeader('RateLimit-Limit', String(limit));
    response.setHeader(
      'RateLimit-Reset',
      String(Math.ceil((bucket.resetAt - now) / 1_000)),
    );
    if (bucket.count > limit) {
      response.setHeader('Retry-After', String(Math.ceil(windowMs / 1_000)));
      next(
        new ApiError(
          429,
          'RATE_LIMITED',
          'Too many calendar changes. Try again shortly.',
        ),
      );
      return;
    }
    next();
  };
}
