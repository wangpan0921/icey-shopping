import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { NotFoundError } from '../common/errors.js';

export const productsRouter = Router();

productsRouter.get('/', async (_req, res) => {
  const items = await prisma.product.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: items });
});

productsRouter.get('/:id', async (req, res) => {
  const item = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!item) throw new NotFoundError('Product not found');
  res.json({ data: item });
});
