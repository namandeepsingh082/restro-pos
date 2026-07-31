import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { getSettings } from '@/lib/settings';
import { getSalesSummary } from '@/lib/reports';
import { resolveRange, formatDate } from '@/lib/datetime';
import { formatMoney } from '@/lib/money';
import { ORDER_TYPE_LABEL, PAYMENT_METHOD_LABEL, type OrderType, type PaymentMethod } from '@/lib/constants';

export const metadata = { title: 'Sales — Restro POS' };
export const dynamic = 'force-dynamic';

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const settings = await getSettings();
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const range = str('range') ?? 'today';
  const { from, to, label } = resolveRange(range, settings.timeZone, str('from'), str('to'));
  const s = await getSalesSummary(from, to, settings.timeZone);

  const money = (v: number) => formatMoney(v, settings.currency, settings.locale);
  const peak = Math.max(1, ...s.hourly.map((h) => h.amount));

  return (
    <AppShell active="dashboard">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Sales · {label}</h1>
          <p className="text-xs text-ink-mute">
            {formatDate(from, settings.timeZone, settings.locale)} —{' '}
            {formatDate(to, settings.timeZone, settings.locale)} · {settings.timeZone}
          </p>
        </div>

        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/dashboard?range=${r.key}`}
              className={`chip border px-2 py-1.5 ${
                range === r.key ? 'border-primary bg-primary text-white' : 'border-counter-line bg-white'
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>

        <form className="flex w-full flex-wrap items-end gap-1 sm:w-auto" action="/dashboard">
          <input type="hidden" name="range" value="custom" />
          <label className="min-w-0 flex-1 text-xs sm:flex-none">
            <span className="label">From</span>
            <input type="date" name="from" className="field min-h-[44px] w-full" required />
          </label>
          <label className="min-w-0 flex-1 text-xs sm:flex-none">
            <span className="label">To</span>
            <input type="date" name="to" className="field min-h-[44px] w-full" required />
          </label>
          <button className="btn min-h-[44px]">Apply</button>
        </form>

        <a className="btn" href={`/api/reports/export?report=daily&range=${range}`}>
          Export CSV
        </a>
      </div>

      {/* headline figures */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Net sales" value={money(s.netSales)} big />
        <Stat label="Orders" value={String(s.orderCount)} big />
        <Stat label="Average bill" value={money(s.avgOrderValue)} />
        <Stat label="Items sold" value={String(s.unitsSold)} />
        <Stat label="Discounts" value={money(s.discountTotal)} />
        <Stat label="Tax collected" value={money(s.taxTotal)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* payment + order type */}
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            Collected by method
          </h2>
          {s.byMethod.length === 0 ? (
            <Empty>No payments recorded in this period.</Empty>
          ) : (
            <Bars
              rows={s.byMethod.map((m) => ({
                label: PAYMENT_METHOD_LABEL[m.method as PaymentMethod] ?? m.method,
                value: m.amount,
                note: `${m.count} txn`,
              }))}
              format={money}
            />
          )}

          <h2 className="mb-3 mt-5 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            By order type
          </h2>
          {s.byOrderType.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : (
            <Bars
              rows={s.byOrderType.map((t) => ({
                label: ORDER_TYPE_LABEL[t.orderType as OrderType] ?? t.orderType,
                value: t.amount,
                note: `${t.count} orders`,
              }))}
              format={money}
            />
          )}
        </div>

        {/* hourly */}
        <div className="panel p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            Hour by hour
          </h2>
          <div className="flex h-40 items-end gap-[3px]">
            {s.hourly.map((h) => (
              <div key={h.hour} className="flex flex-1 flex-col items-center justify-end">
                <div
                  className="w-full rounded-sm bg-primary/80"
                  style={{ height: `${(h.amount / peak) * 100}%` }}
                  title={`${String(h.hour).padStart(2, '0')}:00 — ${money(h.amount)} · ${h.count} orders`}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[3px] text-[9px] text-ink-mute">
            {s.hourly.map((h) => (
              <span key={h.hour} className="num flex-1 text-center">
                {h.hour % 3 === 0 ? String(h.hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Packaging" value={money(s.packagingTotal)} />
            <Stat label="Delivery" value={money(s.deliveryTotal)} />
            <Stat label="Outstanding" value={money(s.unpaidTotal)} tone={s.unpaidTotal > 0 ? 'warn' : undefined} />
            <Stat label="Round off" value={money(s.roundOffTotal)} />
            <Stat label="Cancelled" value={`${s.cancelledCount} · ${money(s.cancelledValue)}`} tone={s.cancelledCount ? 'warn' : undefined} />
            <Stat label="Refunded" value={money(s.refundTotal)} tone={s.refundTotal ? 'warn' : undefined} />
            <Stat label="Gross sales" value={money(s.grossSales)} />
            <Stat label="Categories sold" value={String(s.byCategory.length)} />
          </div>
        </div>

        {/* items */}
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            Top sellers
          </h2>
          {s.topItems.length === 0 ? (
            <Empty>Nothing sold yet in this period.</Empty>
          ) : (
            <ol className="space-y-1.5">
              {s.topItems.map((i, n) => (
                <li key={i.name} className="flex items-baseline gap-2 text-sm">
                  <span className="num w-5 text-right text-xs text-ink-mute">{n + 1}</span>
                  <span className="flex-1 truncate">{i.name}</span>
                  <span className="num text-xs text-ink-mute">{i.qty}×</span>
                  <span className="num font-medium">{money(i.amount)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            Slow movers
          </h2>
          {s.slowItems.length === 0 ? (
            <Empty>Not enough sales to compare yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {s.slowItems.map((i) => (
                <li key={i.name} className="flex items-baseline gap-2 text-sm">
                  <span className="flex-1 truncate">{i.name}</span>
                  <span className="num text-xs text-ink-mute">{i.qty}×</span>
                  <span className="num font-medium">{money(i.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-mute">
            Items with no sales at all do not appear here — check the full menu report for those.
          </p>
        </div>

        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            By category
          </h2>
          {s.byCategory.length === 0 ? (
            <Empty>No sales yet.</Empty>
          ) : (
            <Bars
              rows={s.byCategory.map((c) => ({ label: c.category, value: c.amount, note: `${c.qty} items` }))}
              format={money}
            />
          )}

          <h2 className="mb-3 mt-5 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            By cashier
          </h2>
          {s.byCashier.length === 0 ? (
            <Empty>No sales yet.</Empty>
          ) : (
            <Bars
              rows={s.byCashier.map((c) => ({ label: c.cashier, value: c.amount, note: `${c.count} bills` }))}
              format={money}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({
  label, value, big, tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'warn';
}) {
  return (
    <div className={`panel px-3 py-2 ${tone === 'warn' ? 'border-marigold/40 bg-marigold-light' : ''}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={`num font-semibold ${big ? 'text-2xl' : 'text-lg'}`}>{value}</div>
    </div>
  );
}

function Bars({
  rows, format,
}: {
  rows: { label: string; value: number; note?: string }[];
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-0.5 flex items-baseline justify-between text-sm">
            <span>{r.label}</span>
            <span className="num font-medium">{format(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-sm bg-counter-deep">
            <div
              className="h-1.5 rounded-sm bg-primary"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
          {r.note && <div className="mt-0.5 text-[11px] text-ink-mute">{r.note}</div>}
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-ink-mute">{children}</p>;
}
