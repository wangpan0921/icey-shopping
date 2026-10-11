// 订单领域：创建/查询，含金额在服务端重算（防前端篡改）
import { prisma } from '../db/prisma.js';
import { newOrderNo } from '../common/order-no.js';
import { BadRequestError, NotFoundError } from '../common/errors.js';

export interface CreateOrderInput {
  items: Array<{ productId: string; quantity: number }>;
  buyerEmail?: string;
  buyerName?: string;
  currency?: string;
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.items.length) throw new BadRequestError('items is empty');

  // 1. 捞商品
  const productIds = input.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, active: true } });
  if (products.length !== productIds.length) {
    throw new BadRequestError('some products not found or inactive', 'PRODUCT_INVALID');
  }

  // 2. 币种一致性：当前简化为单一币种订单
  const currency = input.currency ?? products[0]!.currency;
  const mixed = products.some((p) => p.currency !== currency);
  if (mixed) throw new BadRequestError('products currency mismatch', 'CURRENCY_MISMATCH');

  // 3. 服务端重算金额（关键：永远不要信前端传来的 price）
  const productMap = new Map(products.map((p) => [p.id, p]));
  const items = input.items.map((it) => {
    const p = productMap.get(it.productId)!;
    if (it.quantity <= 0 || !Number.isInteger(it.quantity)) {
      throw new BadRequestError(`invalid quantity for ${it.productId}`);
    }
    return {
      productId: p.id,
      nameSnapshot: p.name,
      unitPriceCents: p.priceCents,
      quantity: it.quantity,
    };
  });
  const amountCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);

  // 4. 落单
  const order = await prisma.order.create({
    data: {
      orderNo: newOrderNo(),
      status: 'PENDING',
      currency,
      amountCents,
      buyerEmail: input.buyerEmail,
      buyerName: input.buyerName,
      items: { create: items },
    },
    include: { items: true },
  });

  return order;
}

export async function getOrderById(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, payments: true },
  });
  if (!order) throw new NotFoundError('Order not found');
  return order;
}

export async function getOrderByNo(orderNo: string) {
  const order = await prisma.order.findUnique({
    where: { orderNo },
    include: { items: true, payments: true },
  });
  if (!order) throw new NotFoundError('Order not found');
  return order;
}
