import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authenticationRequiredEvent,
  getCalendars,
  login,
} from '../src/api.js';

describe('API authentication handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('signals when a protected request requires authentication', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to continue.',
            requestId: 'expired-session',
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    const listener = vi.fn();
    window.addEventListener(authenticationRequiredEvent, listener, {
      once: true,
    });

    await expect(getCalendars()).rejects.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not treat rejected login credentials as an expired session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password.',
            requestId: 'invalid-login',
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    const listener = vi.fn();
    window.addEventListener(authenticationRequiredEvent, listener, {
      once: true,
    });

    await expect(login('alice', 'wrong')).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(authenticationRequiredEvent, listener);
  });
});
