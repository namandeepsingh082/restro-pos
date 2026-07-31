import { prisma } from './db';
import { getSettings } from './settings';
import { formatDate, formatTime } from './datetime';
import { ORDER_TYPE_LABEL, PAYMENT_METHOD_LABEL, type OrderType, type PaymentMethod } from './constants';

/**
 * Builds the printable shape of a bill or a kitchen ticket.
 *
 * Nothing here is recalculated: every figure is read from the order row as it
 * was saved. A reprint six months later must produce a byte-identical slip even
 * if prices, tax rates or the restaurant's address have changed since.
 */

export interface ReceiptLine {
  name: string;
  variant: string | null;
  qty: number;
  unitPrice: number;
  amount: number;
  addOns: { name: string; price: number }[];
  instructions: string;
  isVeg: boolean;
  isComplimentary: boolean;
  prepArea: string | null;
}

export interface TaxBreakupRow {
  pct: number;
  taxable: number;
  amount: number;
}

export interface ReceiptData {
  kind: 'BILL';
  width: 58 | 80;
  restaurant: {
    name: string;
    logoDataUrl: string | null;
    addressLines: string[];
    phone: string;
    email: string;
    gstNumber: string;
    fssaiNumber: string;
    footer: string;
  };
  currency: string;
  billNo: string | null;
  orderNo: string;
  date: string;
  time: string;
  orderType: string;
  tableNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  cashier: string;
  instructions: string;
  lines: ReceiptLine[];
  itemsSubtotal: number;
  discountTotal: number;
  discountLabel: string;
  packagingCharge: number;
  deliveryCharge: number;
  taxBreakup: TaxBreakupRow[];
  taxTotal: number;
  splitTax: boolean;
  roundOff: number;
  grandTotal: number;
  payments: { label: string; amount: number; reference: string | null }[];
  paymentStatus: string;
  paidTotal: number;
  balanceDue: number;
  refundedTotal: number;
  status: string;
  isReprint: boolean;
}

export interface KotData {
  kind: 'KOT';
  width: 58 | 80;
  restaurantName: string;
  kotLabel: string;
  batch: number;
  orderNo: string;
  date: string;
  time: string;
  orderType: string;
  tableNo: string | null;
  customerName: string | null;
  cashier: string;
  instructions: string;
  /** Prices are deliberately absent from this structure. */
  lines: { name: string; variant: string | null; qty: number; instructions: string; isVeg: boolean; addOns: string[]; prepArea: string | null }[];
  isAdditional: boolean;
}

function parseAddOns(json: string): { name: string; price: number }[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function buildReceipt(
  orderId: string,
  widthOverride?: 58 | 80,
  isReprint = false,
): Promise<ReceiptData | null> {
  const settings = await getSettings();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { where: { voided: false }, orderBy: { id: 'asc' } },
      payments: { orderBy: { createdAt: 'asc' } },
      discounts: true,
      cashier: { select: { name: true } },
    },
  });
  if (!order) return null;

  const tz = settings.timeZone;
  const locale = settings.locale;

  // Group tax by the rate charged on each line, so a bill mixing 5% and 18%
  // items prints two tax rows instead of one meaningless blended figure.
  const taxMap = new Map<number, { taxable: number; amount: number }>();
  for (const it of order.items) {
    const cur = taxMap.get(it.taxPct) ?? { taxable: 0, amount: 0 };
    cur.taxable += it.lineSubtotal - it.discount;
    cur.amount += it.taxAmount;
    taxMap.set(it.taxPct, cur);
  }

  const orderLevel = order.discounts.find((d) => d.amount > 0 && !d.reason.startsWith('Item'));
  const discountLabel = order.discountTotal
    ? orderLevel?.code
      ? `Discount (${orderLevel.code})`
      : orderLevel?.kind === 'PERCENT'
        ? `Discount (${orderLevel.value}%)`
        : 'Discount'
    : 'Discount';

  return {
    kind: 'BILL',
    width: widthOverride ?? ((settings.receiptWidth === 58 ? 58 : 80) as 58 | 80),
    restaurant: {
      name: settings.name,
      logoDataUrl: settings.logoDataUrl,
      addressLines: [settings.addressLine1, settings.addressLine2, settings.city].filter(Boolean),
      phone: settings.phone,
      email: settings.email,
      gstNumber: settings.gstNumber,
      fssaiNumber: settings.fssaiNumber,
      footer: settings.receiptFooter,
    },
    currency: settings.currency,
    billNo: order.billNo,
    orderNo: order.orderNo,
    date: formatDate(order.createdAt, tz, locale),
    time: formatTime(order.createdAt, tz, locale),
    orderType: ORDER_TYPE_LABEL[order.orderType as OrderType] ?? order.orderType,
    tableNo: order.tableNo,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: order.address,
    cashier: order.cashier.name,
    instructions: order.instructions,
    lines: order.items.map((it) => ({
      name: it.nameSnapshot,
      variant: it.variantSnapshot,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.lineSubtotal - it.discount,
      addOns: parseAddOns(it.addOnsJson),
      instructions: it.instructions,
      isVeg: it.isVeg,
      isComplimentary: it.isComplimentary,
      prepArea: it.prepArea,
    })),
    itemsSubtotal: order.itemsSubtotal,
    discountTotal: order.discountTotal,
    discountLabel,
    packagingCharge: order.packagingCharge,
    deliveryCharge: order.deliveryCharge,
    taxBreakup: [...taxMap.entries()]
      .filter(([pct, v]) => pct > 0 && v.amount > 0)
      .map(([pct, v]) => ({ pct, taxable: v.taxable, amount: v.amount }))
      .sort((a, b) => a.pct - b.pct),
    taxTotal: order.taxTotal,
    splitTax: settings.splitTaxOnReceipt,
    roundOff: order.roundOff,
    grandTotal: order.grandTotal,
    payments: order.payments.map((p) => ({
      label: PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method,
      amount: p.amount,
      reference: p.reference,
    })),
    paymentStatus: order.paymentStatus,
    paidTotal: order.paidTotal,
    balanceDue: Math.max(0, order.grandTotal - order.paidTotal),
    refundedTotal: order.refundedTotal,
    status: order.status,
    isReprint,
  };
}

export async function buildKot(
  orderId: string,
  batch?: number,
  widthOverride?: 58 | 80,
): Promise<KotData | null> {
  const settings = await getSettings();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        where: { voided: false, ...(batch ? { kotBatch: batch } : {}) },
        orderBy: { id: 'asc' },
      },
      cashier: { select: { name: true } },
    },
  });
  if (!order) return null;

  return {
    kind: 'KOT',
    width: widthOverride ?? ((settings.receiptWidth === 58 ? 58 : 80) as 58 | 80),
    restaurantName: settings.name,
    kotLabel: batch && batch > 1 ? `KOT #${batch} (ADDITIONAL)` : 'KOT',
    batch: batch ?? 1,
    orderNo: order.orderNo,
    date: formatDate(order.createdAt, settings.timeZone, settings.locale),
    time: formatTime(new Date(), settings.timeZone, settings.locale),
    orderType: ORDER_TYPE_LABEL[order.orderType as OrderType] ?? order.orderType,
    tableNo: order.tableNo,
    customerName: order.customerName,
    cashier: order.cashier.name,
    instructions: order.instructions,
    lines: order.items.map((it) => ({
      name: it.nameSnapshot,
      variant: it.variantSnapshot,
      qty: it.qty,
      instructions: it.instructions,
      isVeg: it.isVeg,
      addOns: parseAddOns(it.addOnsJson).map((a) => a.name),
      prepArea: it.prepArea,
    })),
    isAdditional: Boolean(batch && batch > 1),
  };
}

/** Plain-text version of a bill, for sharing on WhatsApp. Lives in its own
 *  module so the browser can use it too — see receiptText.ts. */
export { receiptToText } from './receiptText';
