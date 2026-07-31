import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { claimKotBatch } from '@/lib/orderService';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Claim the next kitchen ticket. Returns the batch number to print. If nothing
 * new has been added since the last ticket, it returns the previous batch so
 * the cashier gets a reprint rather than a blank ticket.
 */
export const POST = handler(async (_req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.ORDER_CREATE);
  const { id } = await ctx.params;
  return ok(await claimKotBatch(id, session));
});
