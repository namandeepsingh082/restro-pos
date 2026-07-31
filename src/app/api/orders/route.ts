import { prisma } from '@/lib/db';
import { requirePermission, requireSession } from '@/lib/session';
import { ok, handler, clientIp } from '@/lib/api';
import { createOrderSchema } from '@/lib/validation';
import { createOrder } from '@/lib/orderService';
import { getSettings } from '@/lib/settings';
import { resolveRange } from '@/lib/datetime';
import { PERMISSIONS, OPEN_STATUSES } from '@/lib/constants';

/** Create an order. Safe to retry: the idempotency key de-duplicates. */
export const POST = handler(async (req: Request) => {
  const session = await requirePermission(PERMISSIONS.ORDER_CREATE);
  const input = createOrderSchema.parse(await req.json());
  const result = await createOrder(input, session, clientIp(req));
  return ok(result, { status: result.duplicate ? 200 : 201 });
});

/**
 * List orders. Cashiers see the current day only (their own shift view);
 * admins can query any range and any cashier.
 */
export const GET = handler(async (req: Request) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const settings = await getSettings();

  const isAdmin = session.role === 'ADMIN';
  const range = isAdmin ? (url.searchParams.get('range') ?? 'today') : 'today';
  const { from, to } = resolveRange(
    range, settings.timeZone,
    url.searchParams.get('from'), url.searchParams.get('to'),
  );

  const status = url.searchParams.get('status');
  const orderType = url.searchParams.get('type');
  const q = (url.searchParams.get('q') ?? '').trim();
  const take = Math.min(Number(url.searchParams.get('take') ?? 100), 200);
  const skip = Math.max(Number(url.searchParams.get('skip') ?? 0), 0);

  const where = {
    createdAt: { gte: from, lte: to },
    ...(status === 'open' ? { status: { in: OPEN_STATUSES } } : status ? { status } : {}),
    ...(orderType ? { orderType } : {}),
    ...(isAdmin ? {} : { cashierId: session.sub }),
    ...(q
      ? {
          OR: [
            { orderNo: { contains: q } },
            { billNo: { contains: q } },
            { customerPhone: { contains: q } },
            { customerName: { contains: q } },
            { tableNo: { contains: q } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take, skip,
      include: {
        cashier: { select: { name: true } },
        payments: { select: { method: true, amount: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return ok({
    total, take, skip,
    orders: orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      billNo: o.billNo,
      orderType: o.orderType,
      status: o.status,
      paymentStatus: o.paymentStatus,
      tableNo: o.tableNo,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      grandTotal: o.grandTotal,
      discountTotal: o.discountTotal,
      paidTotal: o.paidTotal,
      refundedTotal: o.refundedTotal,
      itemCount: o._count.items,
      cashier: o.cashier.name,
      methods: [...new Set(o.payments.map((p) => p.method))],
      createdAt: o.createdAt,
    })),
  });
});
