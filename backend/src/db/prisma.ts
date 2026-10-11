import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/index.js';

// 单例，避免 dev watch 时重复创建连接
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;
