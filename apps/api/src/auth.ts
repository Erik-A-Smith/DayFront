import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { CalDavClient } from './caldav/client.js';
import { CalDavError } from './caldav/errors.js';
import type { DayFrontConfig } from './config.js';
import { ApiError } from './errors.js';

const cookieName = 'dayfront_session';
const tokenVersion = 'v1';

export interface AuthContext {
  username: string;
  password: string;
}

interface SessionPayload extends AuthContext {
  issuedAt: number;
  expiresAt: number;
}

const contexts = new WeakMap<Request, AuthContext>();

function cookies(header: string | undefined): Map<string, string> {
  return new Map(
    (header ?? '').split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator < 1) return [];
      return [[part.slice(0, separator).trim(), part.slice(separator + 1)]];
    }),
  );
}

function key(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

function seal(payload: SessionPayload, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from(`dayfront-session:${tokenVersion}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    tokenVersion,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

function unseal(
  token: string,
  secret: string,
  now = Date.now(),
): SessionPayload | undefined {
  try {
    const [version, ivValue, encryptedValue, tagValue, extra] =
      token.split('.');
    if (
      version !== tokenVersion ||
      !ivValue ||
      !encryptedValue ||
      !tagValue ||
      extra
    )
      return undefined;
    const iv = Buffer.from(ivValue, 'base64url');
    const encrypted = Buffer.from(encryptedValue, 'base64url');
    const tag = Buffer.from(tagValue, 'base64url');
    if (
      iv.toString('base64url') !== ivValue ||
      encrypted.toString('base64url') !== encryptedValue ||
      tag.toString('base64url') !== tagValue ||
      iv.length !== 12 ||
      tag.length !== 16
    )
      return undefined;
    const decipher = createDecipheriv('aes-256-gcm', key(secret), iv);
    decipher.setAAD(Buffer.from(`dayfront-session:${tokenVersion}`));
    decipher.setAuthTag(tag);
    const value: unknown = JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
        'utf8',
      ),
    );
    if (
      typeof value !== 'object' ||
      value === null ||
      !('username' in value) ||
      typeof value.username !== 'string' ||
      !('password' in value) ||
      typeof value.password !== 'string' ||
      !('issuedAt' in value) ||
      typeof value.issuedAt !== 'number' ||
      !('expiresAt' in value) ||
      typeof value.expiresAt !== 'number' ||
      value.expiresAt <= now ||
      value.issuedAt > now + 60_000
    )
      return undefined;
    return value as SessionPayload;
  } catch {
    return undefined;
  }
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return [
    `${cookieName}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1_000))}`,
  ].join('; ');
}

function sameOrigin(request: Request): boolean {
  const origin = request.header('origin');
  if (!origin) return true;
  try {
    const expectedProtocol = request.protocol;
    const expectedHost = request.get('host');
    const parsed = new URL(origin);
    return (
      parsed.protocol === `${expectedProtocol}:` && parsed.host === expectedHost
    );
  } catch {
    return false;
  }
}

interface AttemptBucket {
  attempts: number;
  resetAt: number;
}

export function createAuthentication(
  config: DayFrontConfig,
  options: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const ipAttempts = new Map<string, AttemptBucket>();
  const identityAttempts = new Map<string, AttemptBucket>();
  const now = options.now ?? Date.now;
  const multiUser = config.authentication.mode === 'caldav-login';
  const secret = config.authentication.sessionSecret;
  const ttlMs = config.authentication.sessionTtlHours * 3_600_000;
  const attemptWindowMs = 15 * 60_000;

  function activeAttempts(
    buckets: Map<string, AttemptBucket>,
    attemptKey: string,
    currentTime: number,
  ): number {
    const bucket = buckets.get(attemptKey);
    if (!bucket || bucket.resetAt <= currentTime) {
      if (bucket) buckets.delete(attemptKey);
      return 0;
    }
    return bucket.attempts;
  }

  function recordFailure(
    buckets: Map<string, AttemptBucket>,
    attemptKey: string,
    currentTime: number,
  ) {
    const current = activeAttempts(buckets, attemptKey, currentTime);
    buckets.set(attemptKey, {
      attempts: current + 1,
      resetAt: currentTime + attemptWindowMs,
    });
    if (buckets.size <= 10_000) return;
    for (const [key, value] of buckets)
      if (value.resetAt <= currentTime) buckets.delete(key);
    if (buckets.size > 10_000) {
      const oldest = buckets.keys().next().value;
      if (typeof oldest === 'string') buckets.delete(oldest);
    }
  }

  function rateLimited(response: Response, next: NextFunction) {
    response.setHeader('Retry-After', String(attemptWindowMs / 1_000));
    next(
      new ApiError(
        429,
        'RATE_LIMITED',
        'Too many sign-in attempts. Try again later.',
      ),
    );
  }

  const session: RequestHandler = (request, _response, next) => {
    if (!multiUser) {
      contexts.set(request, {
        username: config.caldav.username!,
        password: config.caldav.password!,
      });
      next();
      return;
    }
    const token = cookies(request.header('cookie')).get(cookieName);
    const payload = token && secret ? unseal(token, secret, now()) : undefined;
    if (payload)
      contexts.set(request, {
        username: payload.username,
        password: payload.password,
      });
    next();
  };

  const requireSession: RequestHandler = (request, _response, next) => {
    if (!contexts.has(request)) {
      next(
        new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.'),
      );
      return;
    }
    next();
  };

  const requireSameOrigin: RequestHandler = (request, _response, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      next();
      return;
    }
    if (multiUser && !sameOrigin(request)) {
      next(
        new ApiError(
          403,
          'ORIGIN_REJECTED',
          'The request origin was rejected.',
        ),
      );
      return;
    }
    next();
  };

  const login = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    if (!multiUser) {
      next(new ApiError(404, 'NOT_FOUND', 'Login is not enabled.'));
      return;
    }
    const currentTime = now();
    const ipKey = request.ip ?? 'unknown';
    if (activeAttempts(ipAttempts, ipKey, currentTime) >= 30) {
      rateLimited(response, next);
      return;
    }
    const body: unknown = request.body;
    const username =
      typeof body === 'object' &&
      body !== null &&
      'username' in body &&
      typeof body.username === 'string'
        ? body.username.trim()
        : '';
    const password =
      typeof body === 'object' &&
      body !== null &&
      'password' in body &&
      typeof body.password === 'string'
        ? body.password
        : '';
    if (
      !username ||
      username.length > 256 ||
      !password ||
      password.length > 2_048
    ) {
      recordFailure(ipAttempts, ipKey, currentTime);
      next(
        new ApiError(
          401,
          'INVALID_CREDENTIALS',
          'Invalid username or password.',
        ),
      );
      return;
    }
    const attemptKey = `${ipKey}:${username.toLocaleLowerCase('en-US')}`;
    if (activeAttempts(identityAttempts, attemptKey, currentTime) >= 10) {
      rateLimited(response, next);
      return;
    }
    try {
      await new CalDavClient(
        { ...config.caldav, username, password },
        options.fetch ? { fetch: options.fetch } : {},
      ).discover();
      identityAttempts.delete(attemptKey);
      const payload: SessionPayload = {
        username,
        password,
        issuedAt: currentTime,
        expiresAt: currentTime + ttlMs,
      };
      response.setHeader(
        'Set-Cookie',
        cookie(seal(payload, secret!), ttlMs, request.secure),
      );
      response.setHeader('Cache-Control', 'no-store');
      response.json({
        data: { authenticated: true, username },
        meta: { requestId: String(response.locals.requestId) },
      });
    } catch (error: unknown) {
      if (
        error instanceof CalDavError &&
        ['AUTHENTICATION_FAILED', 'FORBIDDEN'].includes(error.code)
      ) {
        recordFailure(ipAttempts, ipKey, currentTime);
        recordFailure(identityAttempts, attemptKey, currentTime);
        next(
          new ApiError(
            401,
            'INVALID_CREDENTIALS',
            'Invalid username or password.',
          ),
        );
        return;
      }
      next(
        new ApiError(
          503,
          'CALDAV_UNAVAILABLE',
          'The CalDAV server could not verify the login.',
        ),
      );
    }
  };

  const logout = (request: Request, response: Response) => {
    response.setHeader('Set-Cookie', cookie('', 0, request.secure));
    response.setHeader('Cache-Control', 'no-store');
    response.status(204).send();
  };

  const status = (request: Request, response: Response) => {
    const context = contexts.get(request);
    response.setHeader('Cache-Control', 'no-store');
    response.json({
      data: {
        mode: config.authentication.mode,
        authenticated: Boolean(context),
        ...(multiUser && context ? { username: context.username } : {}),
      },
      meta: { requestId: String(response.locals.requestId) },
    });
  };

  return {
    session,
    requireSession,
    requireSameOrigin,
    login,
    logout,
    status,
    client(request: Request) {
      const context = contexts.get(request);
      if (!context)
        throw new ApiError(
          401,
          'AUTHENTICATION_REQUIRED',
          'Sign in to continue.',
        );
      return new CalDavClient(
        { ...config.caldav, ...context },
        options.fetch ? { fetch: options.fetch } : {},
      );
    },
  };
}
