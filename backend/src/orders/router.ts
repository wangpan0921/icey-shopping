import { Router } from 'express';
import { z } from 'zod';
import { createOrder, getOrderById, getOrderByNo } from './service.js';

export const ordersRouter = Router();

const createSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  buyerEmail: z.string().email().optional(),
  buyerName: z.string().min(1).max(100).optional(),
  currency: z.string().length(3).optional(),
});

ordersRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const order = await createOrder(body);
    res.status(201).json({ data: order });
  } catch (err) {
    next(err);
  }
});

ordersRouter.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);
    res.json({ data: order });
  } catch (err) {
    next(err);
  }
});

ordersRouter.get('/by-no/:orderNo', async (req, res, next) => {
  try {
    const order = await getOrderByNo(req.params.orderNo);
    res.json({ data: order });
  } catch (err) {
    next(err);
  }
});
