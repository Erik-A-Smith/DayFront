import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/logger.js';

describe('logger redaction', () => {
  it('redacts credentials and authorization headers', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const logger = createLogger({ level: 'info', format: 'json' }, destination);

    logger.info(
      {
        caldav: { username: 'dayfront', password: 'calendar-secret' },
        req: { headers: { authorization: 'Basic private-token' } },
      },
      'configuration loaded',
    );
    logger.flush();

    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('calendar-secret');
    expect(output).not.toContain('private-token');
  });
});
