import { requirePermission } from '@/lib/session';
import { handler } from '@/lib/api';
import { toCsv } from '@/lib/csv';
import { toMajor } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { resolveRange, formatDateTime } from '@/lib/datetime';
import {
  getSalesSummary, getDiscountReport, getCancelledReport, getRefundReport, getTaxReport,
} from '@/lib/reports';
import { prisma } from '@/lib/db';
import { VOID_STATUSES, PERMISSIONS, ORDER_TYPE_LABEL, type OrderType } from '@/lib/constants';

/**
 * CSV export for every report. `?report=` selects which one.
 * The file opens directly in Excel (UTF-8 BOM, CRLF) — the brief's "export as
 * Excel" is served by this rather than a binary .xlsx, which keeps the app
 * dependency-free. Money is exported in major units so spreadsheet formulas
 * work without dividing by 100.
 */
export const GET = handler(async (req: Request) => {
  await requirePermission(PERMISSIONS.REPORTS_EXPORT);
  const url = new URL(req.url);
  const report = url.searchParams.get('report') ?? 'daily';
  const settings = await getSettings();
  const tz = settings.timeZone;
  const { from, to, label } = resolveRange(
    url.searchParams.get('range') ?? 'today', tz,
    url.searchParams.get('from'), url.searchParams.get('to'),
  );
  const m = (v: number) => toMajor(v).toFixed(2);

  let rows: (string | number)[][] = [];

  switch (report) {
    case 'orders': {
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
        include: { cashier: { select: { name: true } }, payments: true },
      });
      rows = [
        ['Bill No', 'Order No', 'Date/time', 'Type', 'Status', 'Payment status', 'Table', 'Customer',
         'Phone', 'Subtotal', 'Discount', 'Packaging', 'Delivery', 'Tax', 'Round off', 'Total',
         'Paid', 'Refunded', 'Methods', 'Cashier'],
        ...orders.map((o) => [
          o.billNo ?? '', o.orderNo, formatDateTime(o.createdAt, tz),
          ORDER_TYPE_LABEL[o.orderType as OrderType] ?? o.orderType,
          o.status, o.paymentStatus, o.tableNo ?? '', o.customerName ?? '', o.customerPhone ?? '',
          m(o.itemsSubtotal), m(o.discountTotal), m(o.packagingCharge), m(o.deliveryCharge),
          m(o.taxTotal), m(o.roundOff), m(o.grandTotal), m(o.paidTotal), m(o.refundedTotal),
          [...new Set(o.payments.map((p) => p.method))].join('+'), o.cashier.name,
        ]),
      ];
      break;
    }
    case 'items': {
      const items = await prisma.orderItem.findMany({
        where: { voided: false, order: { createdAt: { gte: from, lte: to }, status: { notIn: VOID_STATUSES } } },
        select: { nameSnapshot: true, variantSnapshot: true, qty: true, lineSubtotal: true, discount: true, taxAmount: true, lineTotal: true },
      });
      const map = new Map<string, { qty: number; gross: number; disc: number; tax: number; net: number }>();
      for (const i of items) {
        const key = i.variantSnapshot ? `${i.nameSnapshot} (${i.variantSnapshot})` : i.nameSnapshot;
        const cur = map.get(key) ?? { qty: 0, gross: 0, disc: 0, tax: 0, net: 0 };
        cur.qty += i.qty; cur.gross += i.lineSubtotal; cur.disc += i.discount;
        cur.tax += i.taxAmount; cur.net += i.lineTotal;
        map.set(key, cur);
      }
      rows = [
        ['Item', 'Qty sold', 'Gross', 'Discount', 'Tax', 'Net'],
        ...[...map.entries()].sort((a, b) => b[1].qty - a[1].qty)
          .map(([name, v]) => [name, v.qty, m(v.gross), m(v.disc), m(v.tax), m(v.net)]),
      ];
      break;
    }
    case 'discounts': {
      const list = await getDiscountReport(from, to);
      rows = [
        ['Date/time', 'Bill No', 'Order No', 'Kind', 'Value', 'Amount', 'Code', 'Reason', 'Applied by', 'Order status'],
        ...list.map((d) => [
          formatDateTime(d.createdAt, tz), d.order.billNo ?? '', d.order.orderNo, d.kind,
          d.kind === 'PERCENT' || d.kind === 'COUPON' ? `${d.value}%` : m(d.value),
          m(d.amount), d.code ?? '', d.reason, d.appliedBy.name, d.order.status,
        ]),
      ];
      break;
    }
    case 'cancelled': {
      const list = await getCancelledReport(from, to);
      rows = [
        ['Date/time', 'Bill No', 'Order No', 'Type', 'Value', 'Reason', 'Cashier'],
        ...list.map((o) => [
          formatDateTime(o.createdAt, tz), o.billNo ?? '', o.orderNo, o.orderType,
          m(o.grandTotal), o.cancelReason ?? '', o.cashier.name,
        ]),
      ];
      break;
    }
    case 'refunds': {
      const list = await getRefundReport(from, to);
      rows = [
        ['Date/time', 'Bill No', 'Order No', 'Kind', 'Amount', 'Method', 'Reason', 'By'],
        ...list.map((r) => [
          formatDateTime(r.createdAt, tz), r.order.billNo ?? '', r.order.orderNo, r.kind,
          m(r.amount), r.method, r.reason, r.createdBy.name,
        ]),
      ];
      break;
    }
    case 'tax': {
      const list = await getTaxReport(from, to);
      rows = [
        ['Tax rate %', 'Taxable value', 'Tax collected', 'CGST', 'SGST'],
        ...list.map((t) => [
          t.taxPct, m(t.taxableAmount), m(t.taxAmount),
          m(Math.round(t.taxAmount / 2)), m(t.taxAmount - Math.round(t.taxAmount / 2)),
        ]),
      ];
      break;
    }
    case 'daily':
    default: {
      const s = await getSalesSummary(from, to, tz);
      rows = [
        ['Report', `Daily sales — ${label}`],
        ['From', formatDateTime(from, tz)],
        ['To', formatDateTime(to, tz)],
        [],
        ['Metric', 'Value'],
        ['Gross sales', m(s.grossSales)],
        ['Refunds', m(s.refundTotal)],
        ['Net sales', m(s.netSales)],
        ['Orders', s.orderCount],
        ['Average order value', m(s.avgOrderValue)],
        ['Items sold', s.unitsSold],
        ['Discounts given', m(s.discountTotal)],
        ['Tax collected', m(s.taxTotal)],
        ['Packaging charges', m(s.packagingTotal)],
        ['Delivery charges', m(s.deliveryTotal)],
        ['Round off', m(s.roundOffTotal)],
        ['Outstanding (unpaid)', m(s.unpaidTotal)],
        ['Cancelled orders', s.cancelledCount],
        ['Cancelled value', m(s.cancelledValue)],
        [],
        ['Payment method', 'Amount', 'Count'],
        ...s.byMethod.map((r) => [r.method, m(r.amount), r.count]),
        [],
        ['Order type', 'Amount', 'Count'],
        ...s.byOrderType.map((r) => [ORDER_TYPE_LABEL[r.orderType as OrderType] ?? r.orderType, m(r.amount), r.count]),
        [],
        ['Cashier', 'Amount', 'Orders'],
        ...s.byCashier.map((r) => [r.cashier, m(r.amount), r.count]),
        [],
        ['Category', 'Amount', 'Qty'],
        ...s.byCategory.map((r) => [r.category, m(r.amount), r.qty]),
        [],
        ['Top items', 'Qty', 'Amount'],
        ...s.topItems.map((r) => [r.name, r.qty, m(r.amount)]),
        [],
        ['Hour', 'Amount', 'Orders'],
        ...s.hourly.filter((h) => h.count > 0).map((h) => [`${String(h.hour).padStart(2, '0')}:00`, m(h.amount), h.count]),
      ];
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report}-report-${stamp}.csv"`,
    },
  });
});
