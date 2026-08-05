import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const fixtures = resolve(import.meta.dirname, '../../../tests/fixtures/caldav');
const multistatus = (name: string) =>
  new Response(readFileSync(resolve(fixtures, `${name}.fixture`), 'utf8'), {
    status: 207,
  });

function loginConfig(
  secret = 'a-secure-test-secret-with-at-least-32-characters',
) {
  return loadConfig({
    environment: {
      DAYFRONT_CALDAV_URL: 'https://caldav.test/',
      DAYFRONT_AUTH_MODE: 'caldav-login',
      DAYFRONT_AUTH_SESSION_SECRET: secret,
      DAYFRONT_AUTH_SESSION_TTL_HOURS: '24',
    },
  });
}

function discoveryFetch() {
  let call = 0;
  return vi.fn<typeof fetch>((_input, init) => {
    const authorization = new Headers(init?.headers).get('authorization');
    if (
      authorization !==
      `Basic ${Buffer.from('alice:correct horse').toString('base64')}`
    )
      return Promise.resolve(new Response(null, { status: 401 }));
    const responses = [
      multistatus('principal.xml'),
      multistatus('home.xml'),
      multistatus('calendars.xml'),
    ];
    return Promise.resolve(responses[call++ % responses.length]!);
  });
}

function app(fetchMock: typeof fetch, secret?: string) {
  return createApp({
    config: loginConfig(secret),
    logger: createLogger({ level: 'fatal', format: 'json' }),
    caldavFetch: fetchMock,
  });
}

function sessionCookie(response: request.Response): string {
  const values: unknown = response.headers['set-cookie'];
  const header: unknown = Array.isArray(values)
    ? (values as unknown[])[0]
    : values;
  if (typeof header !== 'string') throw new Error('Expected a session cookie.');
  return header.split(';')[0]!;
}

describe('CalDAV login authentication', () => {
  it('authenticates against CalDAV and restores an encrypted persistent session', async () => {
    const fetchMock = discoveryFetch();
    const login = await request(app(fetchMock))
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'correct horse' })
      .expect(200);
    const cookie = sessionCookie(login);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('alice');
    expect(cookie).not.toContain('correct');

    const restartedApp = app(fetchMock);
    const status = await request(restartedApp)
      .get('/api/v1/auth/session')
      .set('Cookie', cookie)
      .expect(200);
    const statusBody: unknown = status.body;
    expect(statusBody).toMatchObject({
      data: {
        mode: 'caldav-login',
        authenticated: true,
        username: 'alice',
      },
    });
    await request(restartedApp)
      .get('/api/v1/calendars')
      .set('Cookie', cookie)
      .expect(200);
  });

  it('rejects absent, modified, and differently keyed sessions', async () => {
    const login = await request(app(discoveryFetch()))
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'correct horse' });
    const cookie = sessionCookie(login);
    const modified = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;
    await request(app(discoveryFetch())).get('/api/v1/calendars').expect(401);
    await request(app(discoveryFetch()))
      .get('/api/v1/calendars')
      .set('Cookie', modified)
      .expect(401);
    await request(
      app(discoveryFetch(), 'a-different-secret-that-is-also-long-enough'),
    )
      .get('/api/v1/calendars')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('uses generic errors, rejects cross-origin login, and clears logout cookies', async () => {
    const testApp = app(discoveryFetch());
    const invalid = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'wrong' })
      .expect(401);
    const invalidBody: unknown = invalid.body;
    expect(invalidBody).toMatchObject({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.',
      },
    });
    await request(testApp)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://attacker.example')
      .send({ username: 'alice', password: 'correct horse' })
      .expect(403);

    const login = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'correct horse' });
    const result = await request(testApp)
      .post('/api/v1/auth/logout')
      .set('Cookie', sessionCookie(login))
      .expect(204);
    expect(String(result.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('limits repeated login attempts per address and username', async () => {
    const testApp = app(discoveryFetch());
    for (let attempt = 0; attempt < 10; attempt += 1)
      await request(testApp)
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'wrong' })
        .expect(401);
    await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'wrong' })
      .expect(429);
  });

  it('limits aggregate login failures across changing usernames', async () => {
    const fetchMock = discoveryFetch();
    const testApp = app(fetchMock);
    for (let attempt = 0; attempt < 30; attempt += 1)
      await request(testApp)
        .post('/api/v1/auth/login')
        .send({ username: `unknown-${attempt}`, password: 'wrong' })
        .expect(401);
    const limited = await request(testApp)
      .post('/api/v1/auth/login')
      .send({ username: 'another-user', password: 'wrong' })
      .expect(429);
    expect(limited.headers['retry-after']).toBe('900');
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });
});
