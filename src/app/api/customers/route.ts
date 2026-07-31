import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { ok, handler } from '@/lib/api';

/** Phone lookup for the billing screen: type a number, get the saved address. */
export const GET = handler(async (req: Request) => {
  await requireSession();
  const q = (new URL(req.url).searchParams.get('phone') ?? '').trim();
  if (q.length < 4) return ok([]);

  const customers = await prisma.customer.findMany({
    where: { OR: [{ phone: { contains: q } }, { name: { contains: q } }] },
    orderBy: { lastOrderAt: 'desc' },
    take: 8,
    select: {
      id: true, name: true, phone: true, addressLine: true, landmark: true,
      totalOrders: true, totalSpend: true, lastOrderAt: true,
    },
  });
  return ok(customers);
});
