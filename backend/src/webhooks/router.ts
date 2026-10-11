// Webhook 入口
// 关键约定：
//   1. 使用 express.raw() 保留原始 body（Stripe 验签必需）
//   2. 用 PaymentEvent.(provider,eventId) 唯一键做幂等
//   3. 核对金额 + 币种后再推进订单状态；金额不符立即拒绝（防止被欺骗）
import { Router, raw } from 'express';
import { prisma } from '../db/prisma.js';
import { getProvider } from '../payments/registry.js';
import { logger } from '../common/logger.js';
import type { ProviderName } from '../payments/types.js';
import { Prisma } from '@prisma/client';

export const webhooksRouter = Router();

// 用一个共享 handler，适配不同 provider
function makeHandler(providerName: ProviderName) {
  return async (
    req: import('express').Request,
    res: import('express').Response,
  ) => {
    try {
      const provider = getProvider(providerName);
      const event = await provider.verifyAndParseWebhook({
        rawBody: req.body as Buffer,
        headers: req.headers,
      });

      // 幂等去重：同一事件 ID 已处理过则直接 2xx
      try {
        await prisma.paymentEvent.create({
          data: {
            provider: providerName,
            eventId: event.eventId,
            eventType: event.eventType,
            payload: JSON.stringify(event.rawPayload),
            paymentId: null, // 稍后链接
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' // Unique constraint failed
        ) {
          logger.info(
            { provider: providerName, eventId: event.eventId },
            '[webhook] duplicate event ignored',
          );
          return res.status(200).json({ received: true, dedup: true });
        }
        throw err;
      }

      // 定位到对应 Payment
      const payment = await prisma.payment.findFirst({
        where: { provider: providerName, providerRef: event.providerRef },
        include: { order: true },
      });
      if (!payment) {
        // 不认得这个 providerRef，可能是其他商户/其他环境打过来的，忽略但 2xx
        logger.warn({ event }, '[webhook] payment not found by providerRef, ignored');
        return res.status(200).json({ received: true, ignored: true });
      }

      // 金额 / 币种一致性校验（SUCCEEDED 事件才需要）
      if (event.status === 'SUCCEEDED') {
        if (
          typeof event.amountCents === 'number' &&
          event.amountCents !== payment.amountCents
        ) {
          logger.error(
            { paymentId: payment.id, got: event.amountCents, expected: payment.amountCents },
            '[webhook] amount mismatch, refusing to mark paid',
          );
          return res.status(400).json({ error: 'amount mismatch' });
        }
        if (event.currency && event.currency.toLowerCase() !== payment.currency.toLowerCase()) {
          logger.error(
            { paymentId: payment.id, got: event.currency, expected: payment.currency },
            '[webhook] currency mismatch',
          );
          return res.status(400).json({ error: 'currency mismatch' });
        }
      }

      // 状态流转（原子事务）
      await prisma.$transaction(async (tx) => {
        const nextPaymentStatus =
          event.status === 'SUCCEEDED'
            ? 'SUCCEEDED'
            : event.status === 'FAILED'
              ? 'FAILED'
              : event.status === 'EXPIRED'
                ? 'EXPIRED'
                : event.status === 'REFUNDED'
                  ? 'REFUNDED'
                  : payment.status;

        await tx.payment.update({
          where: { id: payment.id },
          data: { status: nextPaymentStatus },
        });

        // 关联 PaymentEvent 到 Payment
        await tx.paymentEvent.updateMany({
          where: { provider: providerName, eventId: event.eventId },
          data: { paymentId: payment.id },
        });

        if (event.status === 'SUCCEEDED') {
          // 订单置 PAID；FULFILLING / DONE 由业务侧另外推进
          if (payment.order.status !== 'PAID' && payment.order.status !== 'DONE') {
            await tx.order.update({
              where: { id: payment.orderId },
              data: { status: 'PAID' },
            });
          }
        } else if (event.status === 'FAILED' || event.status === 'EXPIRED') {
          if (payment.order.status === 'AWAITING_PAYMENT' || payment.order.status === 'PENDING') {
            await tx.order.update({
              where: { id: payment.orderId },
              data: { status: event.status === 'EXPIRED' ? 'CANCELLED' : 'FAILED' },
            });
          }
        } else if (event.status === 'REFUNDED') {
          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: 'REFUNDED' },
          });
        }
      });

      logger.info(
        {
          provider: providerName,
          eventType: event.eventType,
          paymentId: payment.id,
          status: event.status,
        },
        '[webhook] processed',
      );

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, '[webhook] handler error');
      // Stripe 要求 4xx 以让其重试；其他渠道按规范各异
      return res.status(400).json({ error: (err as Error).message });
    }
  };
}

// 必须用 raw 以保留原始 bytes（供 HMAC 验签）
webhooksRouter.post(
  '/stripe',
  raw({ type: '*/*' }),
  makeHandler('stripe'),
);

webhooksRouter.post(
  '/mock',
  raw({ type: '*/*' }),
  makeHandler('mock'),
);

// 未来扩展：
// webhooksRouter.post('/wechat', raw({ type: '*/*' }), makeHandler('wechat'));
// webhooksRouter.post('/alipay', raw({ type: '*/*' }), makeHandler('alipay'));
