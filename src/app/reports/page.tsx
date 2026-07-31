import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { getSettings } from '@/lib/settings';
import { resolveRange, formatDateTime } from '@/lib/datetime';
import { formatMoney } from '@/lib/money';
import {
  getSalesSummary, getDiscountReport, getCancelledReport, getRefundReport, getTaxReport,
} from '@/lib/reports';
import { ORDER_TYPE_LABEL, PAYMENT_METHOD_LABEL, type OrderType, type PaymentMethod } from '@/lib/constants';

export const metadata = { title: 'Reports — Restro POS' };
export const dynamic = 'force-dynamic';

const REPORTS = [
  { key: 'daily', label: 'Daily summary' },
  { key: 'items', label: 'Item-wise' },
  { key: 'categories', label: 'Category-wise' },
  { key: 'payments', label: 'Payment-wise' },
  { key: 'types', label: 'Order-type-wise' },
  { key: 'cashiers', label: 'Cashier-wise' },
  { key: 'hourly', label: 'Hourly' },
  { key: 'tax', label: 'Tax' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'cancelled', label: 'Cancellations' },
  { key: 'refunds', label: 'Refunds' },
];

const RANGES = ['today', 'yesterday', 'week', 'month'];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const settings = await getSettings();
  const report = str('report') ?? 'daily';
  const range = str('range') ?? 'today';
  const { from, to, label } = resolveRange(range, settings.timeZone, str('from'), str('to'));

  const money = (v: number) => formatMoney(v, settings.currency, settings.locale);
  const summary = await getSalesSummary(from, to, settings.timeZone);

  // Only the selected report's extra query is run.
  const discounts = report === 'discounts' ? await getDiscountReport(from, to) : [];
  const cancelled = report === 'cancelled' ? await getCancelledReport(from, to) : [];
  const refunds = report === 'refunds' ? await getRefundReport(from, to) : [];
  const taxRows = report === 'tax' ? await getTaxReport(from, to) : [];

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ report, range });
    if (str('from')) p.set('from', str('from')!);
    if (str('to')) p.set('to', str('to')!);
    for (const [k, v] of Object.entries(over)) p.set(k, v);
    return `/reports?${p.toString()}`;
  };

  // CSV export maps several on-screen reports onto the same file.
  const exportKey = ['items', 'discounts', 'cancelled', 'refunds', 'tax'].includes(report)
    ? report
    : report === 'daily'
      ? 'daily'
      : 'orders';

  return (
    <AppShell active="reports">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <h1 className="mr-auto text-lg font-semibold">Reports · {label}</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={link({ range: r })}
              className={`chip border px-2 py-1.5 ${
                range === r ? 'border-primary bg-primary text-white' : 'border-counter-line bg-white'
              }`}
            >
              {r === 'week' ? '7 days' : r === 'month' ? '30 days' : r}
            </Link>
          ))}
        </div>
        <form className="flex w-full flex-wrap items-end gap-1 sm:w-auto" action="/reports">
          <input type="hidden" name="report" value={report} />
          <input type="hidden" name="range" value="custom" />
          <input type="date" name="from" className="field min-h-[44px] min-w-0 flex-1 sm:flex-none" required aria-label="From date" />
          <input type="date" name="to" className="field min-h-[44px] min-w-0 flex-1 sm:flex-none" required aria-label="To date" />
          <button className="btn">Apply</button>
        </form>
        <a className="btn-primary" href={`/api/reports/export?report=${exportKey}&range=${range}`}>
          Download CSV
        </a>
        <a className="btn" href={`/api/reports/export?report=orders&range=${range}`}>
          All bills CSV
        </a>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {REPORTS.map((r) => (
          <Link
            key={r.key}
            href={link({ report: r.key })}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              report === r.key ? 'bg-primary text-white' : 'bg-white text-ink-soft hover:bg-counter-deep'
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div className="panel scroll-x p-0">
        {report === 'daily' && (
          <Table
            head={['Metric', 'Value']}
            rows={[
              ['Gross sales', money(summary.grossSales)],
              ['Refunds', money(summary.refundTotal)],
              ['Net sales', money(summary.netSales)],
              ['Orders', String(summary.orderCount)],
              ['Average bill', money(summary.avgOrderValue)],
              ['Items sold', String(summary.unitsSold)],
              ['Discounts', money(summary.discountTotal)],
              ['Tax collected', money(summary.taxTotal)],
              ['Packaging charges', money(summary.packagingTotal)],
              ['Delivery charges', money(summary.deliveryTotal)],
              ['Round off', money(summary.roundOffTotal)],
              ['Outstanding (unpaid)', money(summary.unpaidTotal)],
              ['Cancelled orders', `${summary.cancelledCount} · ${money(summary.cancelledValue)}`],
            ]}
          />
        )}

        {report === 'items' && (
          <Table
            head={['Item', 'Qty', 'Amount']}
            rows={[...summary.topItems, ...summary.slowItems].map((i) => [i.name, String(i.qty), money(i.amount)])}
            empty="Nothing sold in this period."
          />
        )}

        {report === 'categories' && (
          <Table
            head={['Category', 'Qty', 'Amount']}
            rows={summary.byCategory.map((c) => [c.category, String(c.qty), money(c.amount)])}
            empty="Nothing sold in this period."
          />
        )}

        {report === 'payments' && (
          <Table
            head={['Method', 'Transactions', 'Amount']}
            rows={summary.byMethod.map((m) => [
              PAYMENT_METHOD_LABEL[m.method as PaymentMethod] ?? m.method,
              String(m.count),
              money(m.amount),
            ])}
            empty="No payments recorded."
          />
        )}

        {report === 'types' && (
          <Table
            head={['Order type', 'Orders', 'Amount']}
            rows={summary.byOrderType.map((t) => [
              ORDER_TYPE_LABEL[t.orderType as OrderType] ?? t.orderType,
              String(t.count),
              money(t.amount),
            ])}
            empty="No orders in this period."
          />
        )}

        {report === 'cashiers' && (
          <Table
            head={['Cashier', 'Bills', 'Amount']}
            rows={summary.byCashier.map((c) => [c.cashier, String(c.count), money(c.amount)])}
            empty="No bills in this period."
          />
        )}

        {report === 'hourly' && (
          <Table
            head={['Hour', 'Orders', 'Amount']}
            rows={summary.hourly
              .filter((h) => h.count > 0)
              .map((h) => [`${String(h.hour).padStart(2, '0')}:00`, String(h.count), money(h.amount)])}
            empty="No orders in this period."
          />
        )}

        {report === 'tax' && (
          <Table
            head={['Rate', 'Taxable value', 'CGST', 'SGST', 'Total tax']}
            rows={taxRows.map((t) => [
              `${t.taxPct}%`,
              money(t.taxableAmount),
              money(Math.round(t.taxAmount / 2)),
              money(t.taxAmount - Math.round(t.taxAmount / 2)),
              money(t.taxAmount),
            ])}
            empty="No taxable sales in this period."
          />
        )}

        {report === 'discounts' && (
          <Table
            head={['When', 'Bill', 'Kind', 'Amount', 'Reason', 'Applied by']}
            rows={discounts.map((d) => [
              formatDateTime(d.createdAt, settings.timeZone, settings.locale),
              d.order.billNo ?? d.order.orderNo,
              d.code ? `${d.kind} ${d.code}` : d.kind,
              money(d.amount),
              d.reason || '—',
              d.appliedBy.name,
            ])}
            empty="No discounts given in this period."
          />
        )}

        {report === 'cancelled' && (
          <Table
            head={['When', 'Bill', 'Value', 'Reason', 'Cashier']}
            rows={cancelled.map((o) => [
              formatDateTime(o.createdAt, settings.timeZone, settings.locale),
              o.billNo ?? o.orderNo,
              money(o.grandTotal),
              o.cancelReason ?? '—',
              o.cashier.name,
            ])}
            empty="No cancellations in this period."
          />
        )}

        {report === 'refunds' && (
          <Table
            head={['When', 'Bill', 'Kind', 'Amount', 'Method', 'Reason', 'By']}
            rows={refunds.map((r) => [
              formatDateTime(r.createdAt, settings.timeZone, settings.locale),
              r.order.billNo ?? r.order.orderNo,
              r.kind,
              money(r.amount),
              r.method,
              r.reason,
              r.createdBy.name,
            ])}
            empty="No refunds in this period."
          />
        )}
      </div>
    </AppShell>
  );
}

function Table({
  head, rows, empty,
}: {
  head: string[];
  rows: string[][];
  empty?: string;
}) {
  return (
    <table className="w-full">
      <thead className="border-b border-counter-line bg-counter">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`th ${i > 0 ? 'text-right' : ''}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-counter-line">
        {rows.length === 0 && (
          <tr>
            <td colSpan={head.length} className="td py-10 text-center text-ink-mute">
              {empty ?? 'Nothing to show.'}
            </td>
          </tr>
        )}
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={`td ${j > 0 ? 'num text-right' : ''}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
