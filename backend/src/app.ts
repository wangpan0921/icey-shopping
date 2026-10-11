import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { config } from './config/index.js';
import { logger } from './common/logger.js';
import { errorHandler } from './common/errors.js';
import { productsRouter } from './products/router.js';
import { ordersRouter } from './orders/router.js';
import { paymentsRouter } from './payments/router.js';
import { webhooksRouter } from './webhooks/router.js';

export function createApp() {
  const app = express();

  // 顺序注意：webhooks 必须在 json 之前挂载，否则 express.json 会先消费 body 导致 Stripe 验签失败
  app.use('/api/webhooks', webhooksRouter);

  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, provider: config.PAYMENT_PROVIDER, env: config.NODE_ENV });
  });

  app.use('/api/products', productsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);

  app.use(errorHandler);

  return app;
}
