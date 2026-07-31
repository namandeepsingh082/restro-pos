import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { cancelSchema } from '@/lib/validation';
import { cancelOrder } from '@/lib/orderService';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.ORDER_CANCEL);
  const { id } = await ctx.params;
  const { reason } = cancelSchema.parse(await req.json());
  return ok(await cancelOrder(id, reason, session));
});
