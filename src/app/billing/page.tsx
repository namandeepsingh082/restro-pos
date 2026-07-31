import { AppShell } from '@/components/AppShell';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getSettings, publicSettings, printProfile } from '@/lib/settings';
import { BillingScreen, type MenuItemView, type ResumedOrder } from './BillingScreen';

export const metadata = { title: 'New bill — Restro POS' };
export const dynamic = 'force-dynamic';

/**
 * Everything the billing screen needs is delivered with the first paint: the
 * whole menu, the restaurant settings and — if the cashier tapped Resume on a
 * held order — that order's lines. No spinner, no second round trip. The menu
 * of a single restaurant is small enough that this is the right trade.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const sp = await searchParams;
  const settings = await getSettings();

  const categories = await prisma.menuCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      items: {
        where: { enabled: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          variants: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
          addOns: { where: { active: true }, orderBy: { name: 'asc' } },
          tax: true,
        },
      },
    },
  });

  const items: MenuItemView[] = categories.flatMap((c) =>
    c.items.map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      price: i.price,
      taxPct: i.taxPct ?? i.tax?.percent ?? settings.defaultTaxPct,
      isVeg: i.isVeg,
      available: i.available,
      categoryId: c.id,
      categoryName: c.name,
      variants: i.variants.map((v) => ({ id: v.id, name: v.name, price: v.price })),
      addOns: i.addOns.map((a) => ({ id: a.id, name: a.name, price: a.price })),
    })),
  );

  /* ---- a cart loaded from an existing order -------------------------------
     Two ways in, and the difference matters:

       ?resume=<id>  a held bill is reopened. Saving it replaces the original,
                     which is only allowed because a held order never received a
                     bill number.
       ?repeat=<id>  "same again" — the items of a finished bill are copied into
                     a fresh cart. The original is untouched and a new bill
                     number is issued, so a second round at the same table is
                     one tap rather than eight.
  --------------------------------------------------------------------------- */
  const resumeId = typeof sp.resume === 'string' ? sp.resume : null;
  const repeatId = typeof sp.repeat === 'string' ? sp.repeat : null;
  let resumed: ResumedOrder | null = null;

  if (resumeId || repeatId) {
    const order = await prisma.order.findFirst({
      where: {
        id: (resumeId ?? repeatId)!,
        // A repeat may come from any bill; a resume only from an open one.
        ...(resumeId ? { status: { in: ['DRAFT', 'HELD'] } } : {}),
        ...(session?.role === 'ADMIN' ? {} : { cashierId: session?.sub }),
      },
      include: { items: { where: { voided: false } } },
    });
    if (order) {
      resumed = {
        mode: resumeId ? 'resume' : 'repeat',
        id: order.id,
        orderNo: order.orderNo,
        billNo: order.billNo,
        orderType: order.orderType as ResumedOrder['orderType'],
        tableNo: order.tableNo ?? '',
        customerName: order.customerName ?? '',
        customerPhone: order.customerPhone ?? '',
        address: order.address ?? '',
        instructions: order.instructions,
        packagingCharge: order.packagingCharge,
        deliveryCharge: order.deliveryCharge,
        lines: order.items.map((it) => ({
          menuItemId: it.menuItemId,
          // A quick-added line has no menu row to look up on the way back in,
          // so the snapshot it was saved with is what rebuilds the cart row.
          custom: it.menuItemId
            ? null
            : {
                name: it.nameSnapshot,
                unitPrice: it.unitPrice,
                taxPct: it.taxPct,
                isVeg: it.isVeg,
              },
          variantId: it.variantId,
          qty: it.qty,
          instructions: it.instructions,
          addOns: (() => {
            try {
              return JSON.parse(it.addOnsJson) as { name: string; price: number }[];
            } catch {
              return [];
            }
          })(),
        })),
      };
    }
  }

  return (
    <AppShell active="billing" wide>
      <BillingScreen
        items={items}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        settings={publicSettings(settings)}
        printProfile={printProfile(settings)}
        cashierName={session?.name ?? ''}
        isAdmin={session?.role === 'ADMIN'}
        maxDiscountPct={session?.maxDiscountPct ?? 0}
        maxDiscountAmt={session?.maxDiscountAmt ?? 0}
        resumed={resumed}
      />
    </AppShell>
  );
}
