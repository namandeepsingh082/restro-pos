import { prisma } from './db';
import { VOID_STATUSES } from './constants';
import { tzOffsetMinutes } from './datetime';

/**
 * All reporting in one place so the dashboard, the reports page and the CSV
 * export can never disagree with each other.
 *
 * Definition of a "sale": any order whose status is not DRAFT, HELD or
 * CANCELLED. Refunds are reported separately and subtracted into `netSales`
 * rather than being deleted from gross, which is what an accountant expects.
 */

export interface SalesSummary {
  from: Date;
  to: Date;
  grossSales: number;
  netSales: number;
  orderCount: number;
  avgOrderValue: number;
  unitsSold: number;
  discountTotal: number;
  taxTotal: number;
  packagingTotal: number;
  deliveryTotal: number;
  roundOffTotal: number;
  refundTotal: number;
  cancelledCount: number;
  cancelledValue: number;
  unpaidTotal: number;
  byMethod: { method: string; amount: number; count: number }[];
  byOrderType: { orderType: string; amount: number; count: number }[];
  byStatus: { status: string; count: number }[];
  byCashier: { cashier: string; amount: number; count: number }[];
  byCategory: { category: string; amount: number; qty: number }[];
  topItems: { name: string; qty: number; amount: number }[];
  slowItems: { name: string; qty: number; amount: number }[];
  hourly: { hour: number; amount: number; count: number }[];
}

const saleWhere = (from: Date, to: Date, cashierId?: string) => ({
  createdAt: { gte: from, lte: to },
  status: { notIn: VOID_STATUSES },
  ...(cashierId ? { cashierId } : {}),
});

export async function getSalesSummary(
  from: Date,
  to: Date,
  timeZone = 'Asia/Kolkata',
  cashierId?: string,
): Promise<SalesSummary> {
  const where = saleWhere(from, to, cashierId);

  const [agg, orders, cancelled, methodRows, typeRows, statusRows, cashierRows, itemRows, refundAgg] =
    await Promise.all([
      prisma.order.aggregate({
        where,
        _sum: {
          grandTotal: true, discountTotal: true, taxTotal: true,
          packagingCharge: true, deliveryCharge: true, roundOff: true,
          paidTotal: true, refundedTotal: true,
        },
        _count: true,
      }),
      // Hourly buckets need the raw timestamps; only two columns are pulled.
      prisma.order.findMany({ where, select: { createdAt: true, grandTotal: true } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: from, lte: to }, status: 'CANCELLED', ...(cashierId ? { cashierId } : {}) },
        _sum: { grandTotal: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ['method'],
        where: { createdAt: { gte: from, lte: to }, order: { status: { notIn: VOID_STATUSES }, ...(cashierId ? { cashierId } : {}) } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.order.groupBy({ by: ['orderType'], where, _sum: { grandTotal: true }, _count: true }),
      prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to }, ...(cashierId ? { cashierId } : {}) },
        _count: true,
      }),
      prisma.order.groupBy({ by: ['cashierId'], where, _sum: { grandTotal: true }, _count: true }),
      prisma.orderItem.findMany({
        where: { voided: false, order: where },
        select: {
          nameSnapshot: true, qty: true, lineTotal: true,
          menuItem: { select: { category: { select: { name: true } } } },
        },
      }),
      prisma.refund.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
    ]);

  const cashierIds = cashierRows.map((r) => r.cashierId);
  const cashiers = cashierIds.length
    ? await prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } })
    : [];
  const cashierName = new Map(cashiers.map((c) => [c.id, c.name]));

  // ---- item and category rollups ------------------------------------------
  const itemMap = new Map<string, { qty: number; amount: number }>();
  const catMap = new Map<string, { qty: number; amount: number }>();
  let unitsSold = 0;

  for (const row of itemRows) {
    unitsSold += row.qty;
    const item = itemMap.get(row.nameSnapshot) ?? { qty: 0, amount: 0 };
    item.qty += row.qty;
    item.amount += row.lineTotal;
    itemMap.set(row.nameSnapshot, item);

    const catName = row.menuItem?.category.name ?? 'Uncategorised';
    const cat = catMap.get(catName) ?? { qty: 0, amount: 0 };
    cat.qty += row.qty;
    cat.amount += row.lineTotal;
    catMap.set(catName, cat);
  }

  const itemList = [...itemMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty || b.amount - a.amount);

  // ---- hourly buckets in the restaurant's own timezone --------------------
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0, count: 0 }));
  for (const o of orders) {
    const offset = tzOffsetMinutes(o.createdAt, timeZone);
    const local = new Date(o.createdAt.getTime() + offset * 60_000);
    const bucket = hourly[local.getUTCHours()];
    bucket.amount += o.grandTotal;
    bucket.count += 1;
  }

  const grossSales = agg._sum.grandTotal ?? 0;
  const refundTotal = agg._sum.refundedTotal ?? 0;
  const orderCount = agg._count;

  return {
    from, to,
    grossSales,
    netSales: grossSales - refundTotal,
    orderCount,
    avgOrderValue: orderCount ? Math.round(grossSales / orderCount) : 0,
    unitsSold,
    discountTotal: agg._sum.discountTotal ?? 0,
    taxTotal: agg._sum.taxTotal ?? 0,
    packagingTotal: agg._sum.packagingCharge ?? 0,
    deliveryTotal: agg._sum.deliveryCharge ?? 0,
    roundOffTotal: agg._sum.roundOff ?? 0,
    refundTotal: Math.max(refundTotal, refundAgg._sum.amount ?? 0),
    cancelledCount: cancelled._count,
    cancelledValue: cancelled._sum.grandTotal ?? 0,
    unpaidTotal: grossSales - (agg._sum.paidTotal ?? 0),
    byMethod: methodRows
      .map((r) => ({ method: r.method, amount: r._sum.amount ?? 0, count: r._count }))
      .sort((a, b) => b.amount - a.amount),
    byOrderType: typeRows
      .map((r) => ({ orderType: r.orderType, amount: r._sum.grandTotal ?? 0, count: r._count }))
      .sort((a, b) => b.amount - a.amount),
    byStatus: statusRows.map((r) => ({ status: r.status, count: r._count })),
    byCashier: cashierRows
      .map((r) => ({
        cashier: cashierName.get(r.cashierId) ?? 'Unknown',
        amount: r._sum.grandTotal ?? 0,
        count: r._count,
      }))
      .sort((a, b) => b.amount - a.amount),
    byCategory: [...catMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.amount - a.amount),
    topItems: itemList.slice(0, 10),
    // Slowest movers that still sold at least once, excluding anything already
    // shown as a top seller (so a short menu does not list the same item twice).
    slowItems: (() => {
      const topNames = new Set(itemList.slice(0, 10).map((i) => i.name));
      return [...itemList].reverse().filter((i) => !topNames.has(i.name)).slice(0, 10);
    })(),
    hourly,
  };
}

/** Rows for the discount report. */
export async function getDiscountReport(from: Date, to: Date) {
  return prisma.orderDiscount.findMany({
    where: { createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: 'desc' },
    include: {
      appliedBy: { select: { name: true } },
      order: { select: { orderNo: true, billNo: true, grandTotal: true, status: true } },
    },
  });
}

/** Rows for the cancellation report. */
export async function getCancelledReport(from: Date, to: Date) {
  return prisma.order.findMany({
    where: { createdAt: { gte: from, lte: to }, status: 'CANCELLED' },
    orderBy: { createdAt: 'desc' },
    include: { cashier: { select: { name: true } } },
  });
}

/** Rows for the refund report. */
export async function getRefundReport(from: Date, to: Date) {
  return prisma.refund.findMany({
    where: { createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { name: true } },
      order: { select: { orderNo: true, billNo: true, grandTotal: true } },
    },
  });
}

/**
 * Tax report grouped by the rate that was actually charged.
 * The taxable value is derived from the stored line components
 * (lineSubtotal - discount) rather than recomputed from today's prices.
 */
export async function getTaxReport(from: Date, to: Date) {
  const detail = await prisma.orderItem.findMany({
    where: { voided: false, order: saleWhere(from, to) },
    select: { taxPct: true, lineSubtotal: true, discount: true, taxAmount: true },
  });
  const map = new Map<number, { taxable: number; tax: number }>();
  for (const d of detail) {
    const cur = map.get(d.taxPct) ?? { taxable: 0, tax: 0 };
    cur.taxable += d.lineSubtotal - d.discount;
    cur.tax += d.taxAmount;
    map.set(d.taxPct, cur);
  }
  return [...map.entries()]
    .map(([taxPct, v]) => ({ taxPct, taxableAmount: v.taxable, taxAmount: v.tax }))
    .sort((a, b) => a.taxPct - b.taxPct);
}
