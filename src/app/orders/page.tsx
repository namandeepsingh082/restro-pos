import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { resolveRange, formatTime } from '@/lib/datetime';
import { formatMoney } from '@/lib/money';
import { OrderRowActions } from './OrderRowActions';
import { OPEN_STATUSES, ORDER_TYPE_LABEL, type OrderType } from '@/lib/constants';

export const metadata = { title: 'Orders — Restro POS' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  HELD: 'bg-marigold-light text-marigold',
  DRAFT: 'bg-marigold-light text-marigold',
  NEW: 'bg-primary-light text-primary',
  PREPARING: 'bg-primary-light text-primary',
  READY: 'bg-primary-light text-primary',
  DELIVERED: 'bg-green-50 text-veg',
  COMPLETED: 'bg-green-50 text-veg',
  CANCELLED: 'bg-red-50 text-nonveg',
  REFUNDED: 'bg-red-50 text-nonveg',
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const settings = await getSettings();
  const sp = await searchParams;
  const isAdmin = session?.role === 'ADMIN';

  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  // A cashier's list is always their own shift, today. Nothing to configure.
  const range = isAdmin ? (str('range') ?? 'today') : 'today';
  const { from, to, label } = resolveRange(range, settings.timeZone, str('from'), str('to'));
  const filter = str('filter') ?? 'all';
  const q = (str('q') ?? '').trim();

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(filter === 'open' ? { status: { in: OPEN_STATUSES } } : {}),
      ...(filter === 'unpaid' ? { paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, status: { notIn: ['CANCELLED'] } } : {}),
      ...(filter === 'cancelled' ? { status: 'CANCELLED' } : {}),
      ...(isAdmin ? {} : { cashierId: session?.sub }),
      ...(q
        ? {
            OR: [
              { orderNo: { contains: q } },
              { billNo: { contains: q } },
              { customerPhone: { contains: q } },
              { customerName: { contains: q } },
              { tableNo: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      cashier: { select: { name: true } },
      payments: { select: { method: true } },
      _count: { select: { items: true } },
    },
  });

  const money = (v: number) => formatMoney(v, settings.currency, settings.locale);
  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open / held' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'cancelled', label: 'Cancelled' },
  ];
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (isAdmin && range !== 'today') p.set('range', range);
    if (q) p.set('q', q);
    if (filter !== 'all') p.set('filter', filter);
    for (const [k, v] of Object.entries(over)) v ? p.set(k, v) : p.delete(k);
    return `?${p.toString()}`;
  };

  const totalValue = orders
    .filter((o) => o.status !== 'CANCELLED' && o.status !== 'HELD' && o.status !== 'DRAFT')
    .reduce((a, o) => a + o.grandTotal, 0);

  return (
    <AppShell active="orders">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-base font-semibold sm:text-lg">
          Orders · {label}
          <span className="num ml-2 block text-sm font-normal text-ink-mute sm:ml-2 sm:inline">
            {orders.length} listed · {money(totalValue)}
          </span>
        </h1>

        {isAdmin && (
          <div className="flex gap-1">
            {['today', 'yesterday', 'week', 'month'].map((r) => (
              <Link
                key={r}
                href={qs({ range: r })}
                className={`chip border px-2 py-1 ${
                  range === r ? 'border-primary bg-primary text-white' : 'border-counter-line bg-white'
                }`}
              >
                {r === 'week' ? '7 days' : r === 'month' ? '30 days' : r}
              </Link>
            ))}
          </div>
        )}

        <form className="flex w-full gap-1 sm:w-auto" action="/orders">
          {isAdmin && range !== 'today' && <input type="hidden" name="range" value={range} />}
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
          <input
            name="q"
            defaultValue={q}
            className="field min-h-[44px] flex-1 sm:w-48 sm:flex-none"
            placeholder="Bill no, phone, table"
            enterKeyHint="search"
          />
          <button className="btn min-h-[44px]">Find</button>
        </form>
      </div>

      {/* Four filters do not fit across a phone; the row scrolls instead of
          stacking, so the list keeps the screen. */}
      <div className="scroll-x mb-2 flex gap-1 pb-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={qs({ filter: t.key })}
            className={`flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded px-3 text-sm font-medium ${
              filter === t.key ? 'bg-primary text-white' : 'bg-white text-ink-soft hover:bg-counter-deep'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* ------------------------------------------------------------------
          One markup path, two presentations.

          The old version was a 10-column table with an 860px minimum, so on a
          phone the Actions column — the whole point of the screen — sat off the
          right edge behind a sideways scroll. This is a CSS grid instead: a
          stacked card per order on a phone, and from `md` up the same rows snap
          into aligned columns under a header. Rows share one column template,
          so the alignment is real, and there is no second copy of the markup to
          keep in step.
      ------------------------------------------------------------------ */}
      <div className="hidden md:grid md:grid-cols-orders md:gap-3 md:px-3 md:py-2 md:[&>*]:min-w-0">
        <span className="th px-0">Bill / order</span>
        <span className="th px-0">Type · customer</span>
        <span className="th px-0 text-right">Items</span>
        <span className="th px-0 text-right">Total</span>
        <span className="th px-0">Payment</span>
        <span className="th px-0">Status</span>
        <span className="th px-0 text-right">Actions</span>
      </div>

      {orders.length === 0 && (
        <p className="panel p-10 text-center text-sm text-ink-mute">
          No orders in this view yet. Bills appear here the moment they are saved.
        </p>
      )}

      <ul className="space-y-2 md:space-y-1">
        {orders.map((o) => (
          <li
            key={o.id}
            className="card-row grid gap-2 md:grid-cols-orders md:items-start md:gap-3 md:rounded md:py-2 md:shadow-none md:[&>*]:min-w-0"
          >
            {/* bill / order / time / cashier */}
            <div className="flex items-baseline justify-between gap-2 md:block">
              <span>
                <span className="num text-sm font-semibold">{o.billNo ?? '—'}</span>
                <span className="num block text-xs text-ink-mute">
                  #{o.orderNo} · {formatTime(o.createdAt, settings.timeZone, settings.locale)}
                </span>
                <span className="block text-xs text-ink-mute">by {o.cashier.name}</span>
                {/* Only here and in the audit log — never on the customer's slip.
                    An owner scanning the day's bills can see which times were
                    entered by hand and when the money actually came in. */}
                {o.actualCreatedAt && (
                  <span
                    className="chip mt-0.5 bg-marigold-light text-marigold"
                    title={`Billed for ${formatTime(o.createdAt, settings.timeZone, settings.locale)}; saved at ${formatTime(o.actualCreatedAt, settings.timeZone, settings.locale)}`}
                  >
                    time edited
                  </span>
                )}
              </span>
              {/* On a phone the status belongs beside the bill number, where the
                  eye already is. On a laptop it has its own column. */}
              <span className={`chip md:hidden ${STATUS_STYLE[o.status] ?? 'bg-counter-deep text-ink-soft'}`}>
                {o.status}
              </span>
            </div>

            {/* type + customer */}
            <div className="text-sm">
              <span className="card-label md:hidden">Type · customer</span>
              <span className="block">
                {ORDER_TYPE_LABEL[o.orderType as OrderType] ?? o.orderType}
                {o.tableNo && <span className="font-medium"> · Table {o.tableNo}</span>}
              </span>
              {o.customerName && <span className="block">{o.customerName}</span>}
              {o.customerPhone && (
                <a
                  href={`tel:${o.customerPhone}`}
                  className="num block text-xs text-primary underline md:no-underline"
                >
                  {o.customerPhone}
                </a>
              )}
            </div>

            {/* items */}
            <div className="hidden md:block md:text-right">
              <span className="num text-sm">{o._count.items}</span>
            </div>

            {/* total */}
            <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
              <span className="card-label md:hidden">
                Total · {o._count.items} item{o._count.items === 1 ? '' : 's'}
              </span>
              <span className="num text-base font-semibold md:text-sm">
                {money(o.grandTotal)}
                {o.discountTotal > 0 && (
                  <span className="block text-xs font-normal text-ink-mute">
                    disc {money(o.discountTotal)}
                  </span>
                )}
              </span>
            </div>

            {/* payment */}
            <div className="flex items-center gap-2 md:block">
              <span
                className={`chip ${
                  o.paymentStatus === 'PAID'
                    ? 'bg-green-50 text-veg'
                    : o.paymentStatus === 'PARTIAL'
                      ? 'bg-marigold-light text-marigold'
                      : 'bg-red-50 text-nonveg'
                }`}
              >
                {o.paymentStatus}
              </span>
              <span className="text-xs text-ink-mute md:block">
                {[...new Set(o.payments.map((p) => p.method))].join(' + ') || '—'}
              </span>
            </div>

            {/* status — laptop column only; the phone copy sits next to the bill no */}
            <div className="hidden md:block">
              <span className={`chip ${STATUS_STYLE[o.status] ?? 'bg-counter-deep text-ink-soft'}`}>
                {o.status}
              </span>
              {o.refundedTotal > 0 && (
                <span className="num block text-xs text-nonveg">−{money(o.refundedTotal)}</span>
              )}
            </div>

            <div className="border-t border-counter-line pt-2 md:border-0 md:pt-0">
              <OrderRowActions
                order={{
                  id: o.id,
                  orderNo: o.orderNo,
                  billNo: o.billNo,
                  status: o.status,
                  paymentStatus: o.paymentStatus,
                  grandTotal: o.grandTotal,
                  paidTotal: o.paidTotal,
                  refundedTotal: o.refundedTotal,
                  kotBatches: o.kotBatches,
                }}
                isAdmin={isAdmin}
                currency={settings.currency}
                locale={settings.locale}
              />
            </div>
          </li>
        ))}
      </ul>

    </AppShell>
  );
}
