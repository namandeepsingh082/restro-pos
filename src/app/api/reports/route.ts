import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { getSalesSummary } from '@/lib/reports';
import { getSettings } from '@/lib/settings';
import { resolveRange } from '@/lib/datetime';
import { PERMISSIONS } from '@/lib/constants';

export const GET = handler(async (req: Request) => {
  await requirePermission(PERMISSIONS.REPORTS_VIEW);
  const url = new URL(req.url);
  const settings = await getSettings();
  const { from, to, label } = resolveRange(
    url.searchParams.get('range') ?? 'today',
    settings.timeZone,
    url.searchParams.get('from'),
    url.searchParams.get('to'),
  );
  const summary = await getSalesSummary(from, to, settings.timeZone, url.searchParams.get('cashier') ?? undefined);
  return ok({ label, ...summary });
});
