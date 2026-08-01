import type { Writable } from 'node:stream';

import pino, { type Logger } from 'pino';

import type { DayFrontConfig } from './config.js';

const redactPaths = [
  'password',
  'caldav.password',
  'config.caldav.password',
  'radicale.password',
  'config.radicale.password',
  'req.headers.authorization',
  'request.headers.authorization',
  'headers.authorization',
];

export function createLogger(
  config: DayFrontConfig['logging'],
  destination?: Writable,
): Logger {
  const options: pino.LoggerOptions = {
    level: config.level,
    redact: { paths: redactPaths, censor: '[Redacted]' },
  };

  if (destination) return pino(options, destination);
  if (config.format === 'pretty') {
    return pino(
      options,
      pino.transport({ target: 'pino-pretty', options: { colorize: true } }),
    );
  }
  return pino(options);
}
