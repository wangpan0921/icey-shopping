import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './common/logger.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV, provider: config.PAYMENT_PROVIDER },
    '[server] listening',
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, '[server] shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
