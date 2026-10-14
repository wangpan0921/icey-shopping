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

  // 中间件挂载顺序关键：
  // 1. CORS 最前：所有路由（包括 webhooks）都需要返回 Access-Control-Allow-Origin，
  //    否则浏览器从前端 fetch webhook（dev 期的 mock 调用场景）会被 CORS 拦截显示 "Failed to fetch"。
  // 2. webhooks 用 express.raw 保留原始 bytes（Stripe HMAC 验签必需），且必须在 express.json 之前挂载。
  // 3. express.json 其他路由用。
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
    }),
  );

  app.use('/api/webhooks', webhooksRouter);

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
