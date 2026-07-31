import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { refundSchema } from '@/lib/validation';
import { refundOrder } from '@/lib/orderService';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.ORDER_REFUND);
  const { id } = await ctx.params;
  const body = refundSchema.parse(await req.json());
  return ok(await refundOrder(id, body, session));
});
