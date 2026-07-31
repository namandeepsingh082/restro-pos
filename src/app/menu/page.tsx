import { AppShell } from '@/components/AppShell';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { MenuManager, type AdminItem, type AdminCategory } from './MenuManager';

export const metadata = { title: 'Menu — Restro POS' };
export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const settings = await getSettings();
  const [categories, items] = await Promise.all([
    prisma.menuCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { items: true } } } }),
    prisma.menuItem.findMany({
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        category: { select: { name: true } },
        variants: { orderBy: { sortOrder: 'asc' } },
        addOns: { orderBy: { name: 'asc' } },
      },
    }),
  ]);

  const adminCategories: AdminCategory[] = categories.map((c) => ({
    id: c.id, name: c.name, active: c.active, sortOrder: c.sortOrder,
    prepArea: c.prepArea, itemCount: c._count.items,
  }));

  const adminItems: AdminItem[] = items.map((i) => ({
    id: i.id, code: i.code, name: i.name, description: i.description,
    categoryId: i.categoryId, categoryName: i.category.name,
    price: i.price, taxPct: i.taxPct, isVeg: i.isVeg,
    available: i.available, enabled: i.enabled, prepArea: i.prepArea,
    variants: i.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, active: v.active })),
    addOns: i.addOns.map((a) => ({ id: a.id, name: a.name, price: a.price, active: a.active })),
  }));

  return (
    <AppShell active="menu">
      <MenuManager
        categories={adminCategories}
        items={adminItems}
        currency={settings.currency}
        locale={settings.locale}
        defaultTaxPct={settings.defaultTaxPct}
      />
    </AppShell>
  );
}
