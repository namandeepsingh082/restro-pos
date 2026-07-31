import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { getSettings, publicSettings } from '@/lib/settings';

/**
 * The whole menu in one request. The billing screen loads this once, keeps it
 * in memory and stores a copy on the device so it can still take orders with
 * the network down.
 */
export const GET = handler(async (req: Request) => {
  await requireSession();
  const includeHidden = new URL(req.url).searchParams.get('all') === '1';

  const [categories, settings] = await Promise.all([
    prisma.menuCategory.findMany({
      where: includeHidden ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: {
          where: includeHidden ? {} : { enabled: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            variants: { where: includeHidden ? {} : { active: true }, orderBy: { sortOrder: 'asc' } },
            addOns: { where: includeHidden ? {} : { active: true }, orderBy: { name: 'asc' } },
            tax: true,
          },
        },
      },
    }),
    getSettings(),
  ]);

  const defaultTaxPct = settings.defaultTaxPct;

  return ok({
    settings: publicSettings(settings),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      active: c.active,
      prepArea: c.prepArea,
      items: c.items.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        description: i.description,
        price: i.price,
        // Resolved once here so the client never has to work out precedence.
        taxPct: i.taxPct ?? i.tax?.percent ?? defaultTaxPct,
        isVeg: i.isVeg,
        available: i.available,
        enabled: i.enabled,
        prepArea: i.prepArea ?? c.prepArea,
        categoryId: c.id,
        categoryName: c.name,
        variants: i.variants.map((v) => ({ id: v.id, name: v.name, price: v.price })),
        addOns: i.addOns.map((a) => ({ id: a.id, name: a.name, price: a.price })),
      })),
    })),
  });
});
