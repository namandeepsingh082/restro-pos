import { prisma } from '@/lib/db';
import { requireSession, requirePermission, HttpError } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { updateOrderStatusSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: 'asc' } },
      payments: true,
      discounts: { include: { appliedBy: { select: { name: true } } } },
      refunds: { include: { createdBy: { select: { name: true } } } },
      cashier: { select: { name: true } },
    },
  });
  if (!order) throw new HttpError(404, 'Order not found.');
  if (session.role !== 'ADMIN' && order.cashierId !== session.sub) {
    throw new HttpError(403, 'You can only open bills from your own counter.');
  }
  return ok(order);
});

/** Move an order along the floor: NEW -> PREPARING -> READY -> COMPLETED. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = updateOrderStatusSchema.parse(await req.json());

  // Cancelling, refunding and reopening have their own guarded endpoints.
  if (['CANCELLED', 'REFUNDED'].includes(body.status)) {
    throw new HttpError(400, 'Use the cancel or refund action for this change.');
  }

  const session =
    body.status === 'DRAFT' || body.status === 'HELD'
      ? await requirePermission(PERMISSIONS.ORDER_CREATE)
      : await requireSession();

  const before = await prisma.order.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, 'Order not found.');
  if (before.status === 'CANCELLED' || before.status === 'REFUNDED') {
    throw new HttpError(409, 'This bill is closed and cannot be changed.');
  }
  if (
    (before.status === 'COMPLETED' || before.status === 'DELIVERED') &&
    session.role !== 'ADMIN'
  ) {
    throw new HttpError(403, 'Reopening a completed bill needs admin approval.');
  }

  const order = await prisma.order.update({
    where: { id },
    data: {
      status: body.status,
      completedAt: body.status === 'COMPLETED' ? new Date() : before.completedAt,
      reopenedById:
        before.status === 'COMPLETED' && body.status !== 'COMPLETED' ? session.sub : before.reopenedById,
    },
  });

  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'order.status', entity: 'Order', entityId: id,
    meta: { from: before.status, to: body.status, reason: body.reason ?? '' },
  });
  return ok(order);
});
