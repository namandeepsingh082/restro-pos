import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { handler } from '@/lib/api';
import { toCsv } from '@/lib/csv';
import { toMajor } from '@/lib/money';
import { PERMISSIONS } from '@/lib/constants';

/** CSV in exactly the shape the importer accepts, so export -> edit -> import
 *  is a complete round trip. */
export const GET = handler(async () => {
  await requirePermission(PERMISSIONS.MENU_WRITE);

  const items = await prisma.menuItem.findMany({
    include: { category: true, variants: { orderBy: { sortOrder: 'asc' } }, addOns: true },
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });

  const rows: (string | number)[][] = [
    ['code', 'name', 'category', 'price', 'tax_pct', 'veg', 'available', 'enabled', 'prep_area', 'description', 'variants', 'addons'],
    ...items.map((i) => [
      i.code,
      i.name,
      i.category.name,
      toMajor(i.price).toFixed(2),
      i.taxPct ?? '',
      i.isVeg ? 'veg' : 'nonveg',
      i.available ? 'yes' : 'no',
      i.enabled ? 'yes' : 'no',
      i.prepArea ?? '',
      i.description,
      i.variants.map((v) => `${v.name}:${toMajor(v.price).toFixed(2)}`).join('|'),
      i.addOns.map((a) => `${a.name}:${toMajor(a.price).toFixed(2)}`).join('|'),
    ]),
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="menu-${stamp}.csv"`,
    },
  });
});
