import { prisma } from '@/lib/db';
import { requirePermission, requireSession } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { settingsSchema } from '@/lib/validation';
import { getSettings, publicSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

export const GET = handler(async () => {
  const session = await requireSession();
  const settings = await getSettings();
  // A cashier only needs the handful of fields the billing screen reads.
  return ok(session.role === 'ADMIN' ? settings : publicSettings(settings));
});

export const PUT = handler(async (req: Request) => {
  const session = await requirePermission(PERMISSIONS.SETTINGS_WRITE);
  const data = settingsSchema.parse(await req.json());
  const before = await getSettings();
  const updated = await prisma.restaurantSettings.update({ where: { id: 1 }, data });
  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'settings.update', entity: 'RestaurantSettings', entityId: '1',
    meta: {
      changed: Object.keys(data).filter(
        (k) => (before as unknown as Record<string, unknown>)[k] !== (data as unknown as Record<string, unknown>)[k],
      ),
    },
  });
  return ok(updated);
});
