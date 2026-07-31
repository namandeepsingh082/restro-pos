import { PrismaClient } from '@prisma/client';

/**
 * A single Prisma client per process. Next.js hot-reloads modules in dev, so
 * without this cache each reload would open a new pool of connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
