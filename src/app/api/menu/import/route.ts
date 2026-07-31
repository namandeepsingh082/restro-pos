import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { parseCsvObjects } from '@/lib/csv';
import { toMinor } from '@/lib/money';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

/**
 * Import (upsert) menu items from CSV. Matching is by `code`, so re-importing
 * an edited export updates prices instead of creating duplicates.
 *
 * Required columns: code, name, category, price
 * Optional: tax_pct, veg, available, enabled, prep_area, description,
 *           variants ("Half:150|Full:260"), addons ("Extra Butter:20")
 */
export const POST = handler(async (req: Request) => {
  const session = await requirePermission(PERMISSIONS.MENU_WRITE);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return ok({ error: 'Choose a CSV file first.' }, { status: 400 });

  const rows = parseCsvObjects(await file.text());
  const yes = (v: string | undefined, dflt = true) =>
    v === undefined || v === '' ? dflt : ['yes', 'y', 'true', '1'].includes(v.toLowerCase());

  const result = { created: 0, updated: 0, skipped: [] as string[] };
  const categoryCache = new Map<string, string>();

  for (const [index, row] of rows.entries()) {
    const line = index + 2; // +1 header, +1 to 1-based
    const code = (row.code ?? '').toUpperCase();
    const name = row.name ?? '';
    const categoryName = row.category ?? '';

    if (!code || !name || !categoryName) {
      result.skipped.push(`Line ${line}: code, name and category are all required.`);
      continue;
    }

    const cacheKey = categoryName.toLowerCase();
    let categoryId = categoryCache.get(cacheKey);
    if (categoryId === undefined) {
      const category = await prisma.menuCategory.upsert({
        where: { name: categoryName },
        update: {},
        create: { name: categoryName },
      });
      categoryId = String(category.id);
      categoryCache.set(cacheKey, categoryId);
    }

    const price = toMinor(row.price);
    if (price <= 0 && !(row.variants ?? '').trim()) {
      result.skipped.push(`Line ${line}: "${name}" needs a price or at least one variant.`);
      continue;
    }

    const taxPctRaw = (row.tax_pct ?? '').trim();
    const data = {
      name,
      description: row.description ?? '',
      categoryId,
      price,
      taxPct: taxPctRaw === '' ? null : Math.max(0, Math.min(100, Math.round(Number(taxPctRaw) || 0))),
      isVeg: (row.veg ?? 'veg').toLowerCase() !== 'nonveg',
      available: yes(row.available),
      enabled: yes(row.enabled),
      prepArea: (row.prep_area ?? '') || null,
    };

    const existing = await prisma.menuItem.findUnique({ where: { code } });
    const item = existing
      ? await prisma.menuItem.update({ where: { code }, data })
      : await prisma.menuItem.create({ data: { ...data, code } });
    existing ? result.updated++ : result.created++;

    for (const [vi, chunk] of (row.variants ?? '').split('|').filter(Boolean).entries()) {
      const [vName, vPrice] = chunk.split(':');
      if (!vName) continue;
      await prisma.menuItemVariant.upsert({
        where: { menuItemId_name: { menuItemId: item.id, name: vName.trim() } },
        update: { price: toMinor(vPrice), sortOrder: vi },
        create: { menuItemId: item.id, name: vName.trim(), price: toMinor(vPrice), sortOrder: vi },
      });
    }
    for (const chunk of (row.addons ?? '').split('|').filter(Boolean)) {
      const [aName, aPrice] = chunk.split(':');
      if (!aName) continue;
      await prisma.menuItemAddOn.upsert({
        where: { menuItemId_name: { menuItemId: item.id, name: aName.trim() } },
        update: { price: toMinor(aPrice) },
        create: { menuItemId: item.id, name: aName.trim(), price: toMinor(aPrice) },
      });
    }
  }

  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'menu.import', entity: 'MenuItem',
    meta: { created: result.created, updated: result.updated, skipped: result.skipped.length },
  });
  return ok(result);
});
