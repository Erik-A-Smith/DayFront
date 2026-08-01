import { createApp } from './app.js';
import {
  ConfigurationError,
  getConfigurationWarnings,
  loadConfig,
} from './config.js';
import { createLogger } from './logger.js';

let config;
try {
  config = loadConfig();
} catch (error: unknown) {
  const message =
    error instanceof ConfigurationError
      ? error.message
      : 'DayFront configuration could not be loaded.';
  console.error(message);
  process.exit(1);
}

const logger = createLogger(config.logging);
for (const warning of getConfigurationWarnings(config)) logger.warn(warning);
const { host, port } = config.server;

const webRoot = process.env.DAYFRONT_WEB_ROOT;
const server = createApp({
  config,
  logger,
  ...(webRoot ? { webRoot } : {}),
}).listen(port, host, () => {
  logger.info({ host, port }, 'DayFront API listening');
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down DayFront API');
  const forcedShutdown = setTimeout(() => {
    logger.error('DayFront API graceful shutdown timed out');
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);
  forcedShutdown.unref();
  server.closeIdleConnections();
  server.close((error) => {
    clearTimeout(forcedShutdown);
    if (error) {
      logger.error({ err: error }, 'DayFront API shutdown failed');
      process.exitCode = 1;
    } else {
      logger.info('DayFront API shutdown complete');
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
