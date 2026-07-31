import { prisma } from '@/lib/db';
import { requirePermission, HttpError } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { addPaymentsSchema } from '@/lib/validation';
import { derivePaymentStatus } from '@/lib/pricing';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

/** Settle an unpaid or partly paid bill. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.ORDER_CREATE);
  const { id } = await ctx.params;
  const { payments } = addPaymentsSchema.parse(await req.json());

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new HttpError(404, 'Order not found.');
  if (order.status === 'CANCELLED') throw new HttpError(409, 'This bill was cancelled.');

  const added = payments.reduce((a, p) => a + p.amount, 0);
  const newPaid = order.paidTotal + added;
  if (newPaid > order.grandTotal) {
    throw new HttpError(400, 'That is more than the balance due on this bill.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payment.createMany({
      data: payments.map((p) => ({
        orderId: id, method: p.method, amount: p.amount, reference: p.reference || null,
      })),
    });
    return tx.order.update({
      where: { id },
      data: { paidTotal: newPaid, paymentStatus: derivePaymentStatus(order.grandTotal, newPaid) },
    });
  });

  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'order.payment', entity: 'Order', entityId: id,
    meta: { added, methods: payments.map((p) => p.method), paidTotal: newPaid },
  });
  return ok(updated);
});
