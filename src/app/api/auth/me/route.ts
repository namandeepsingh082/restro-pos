import { getSession } from '@/lib/session';
import { ok, handler } from '@/lib/api';

/** Used by the offline queue to confirm the session is still valid. */
export const GET = handler(async () => {
  const session = await getSession();
  return ok(
    session
      ? {
          id: session.sub, name: session.name, role: session.role,
          maxDiscountPct: session.maxDiscountPct, maxDiscountAmt: session.maxDiscountAmt,
        }
      : null,
  );
});
