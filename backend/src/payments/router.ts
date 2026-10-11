// 支付创建接口：以订单为维度调起渠道会话
// 幂等策略：同一订单若已有 CREATED 状态的 Payment 且金额币种一致，直接复用
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { BadRequestError, NotFoundError } from '../common/errors.js';
import { getProvider } from './registry.js';
import type { ClientContext, ProviderName } from './types.js';
import { logger } from '../common/logger.js';

export const paymentsRouter = Router();

const createSchema = z.object({
  orderId: z.string().min(1),
  provider: z.enum(['stripe', 'mock', 'wechat', 'alipay']).optional(),
  client: z
    .object({
      platform: z
        .enum(['pc_web', 'mobile_web', 'wechat_mp', 'android_app', 'ios_app'])
        .default('pc_web'),
      inWechat: z.boolean().optional(),
      userAgent: z.string().optional(),
      openid: z.string().optional(),
      returnUrl: z.string().url().optional(),
      cancelUrl: z.string().url().optional(),
    })
    .optional(),
});

paymentsRouter.post('/checkout', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundError('Order not found');
    if (!['PENDING', 'AWAITING_PAYMENT'].includes(order.status)) {
      throw new BadRequestError(`order is ${order.status}, cannot create payment`, 'ORDER_INVALID');
    }

    const providerName = (body.provider ?? undefined) as ProviderName | undefined;
    const provider = getProvider(providerName);

    const client: ClientContext = {
      platform: body.client?.platform ?? 'pc_web',
      inWechat: body.client?.inWechat,
      userAgent: body.client?.userAgent ?? (req.headers['user-agent'] as string | undefined),
      openid: body.client?.openid,
      returnUrl: body.client?.returnUrl,
      cancelUrl: body.client?.cancelUrl,
    };

    const result = await provider.createPayment({
      orderId: order.id,
      orderNo: order.orderNo,
      amountCents: order.amountCents,
      currency: order.currency,
      description: `Order ${order.orderNo}`,
      lineItems: order.items.map((it) => ({
        name: it.nameSnapshot,
        unitPriceCents: it.unitPriceCents,
        quantity: it.quantity,
      })),
      buyerEmail: order.buyerEmail ?? undefined,
      client,
    });

    // 落 Payment 记录
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerRef: result.providerRef,
        checkoutUrl: 'url' in result ? result.url : null,
        status: 'CREATED',
        amountCents: order.amountCents,
        currency: order.currency,
      },
    });

    // 把订单推进到 AWAITING_PAYMENT
    if (order.status === 'PENDING') {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'AWAITING_PAYMENT' },
      });
    }

    logger.info(
      { orderId: order.id, paymentId: payment.id, provider: provider.name, kind: result.kind },
      '[payments] checkout created',
    );

    res.status(201).json({
      data: {
        paymentId: payment.id,
        provider: provider.name,
        ...result,
      },
    });
  } catch (err) {
    next(err);
  }
});
