/**
 * The pricing engine.
 *
 * This module is PURE and is imported by both the browser (to preview the cart
 * as the cashier types) and the API route (to recompute the authoritative
 * totals from database prices before saving). Because both sides run the same
 * function against the same integer inputs, the preview always matches the
 * saved bill — and a tampered client payload can never change what is stored,
 * because the server re-reads unit prices from the database first.
 *
 * All amounts are integers in minor units (paise). See src/lib/money.ts.
 *
 * Tax treatment: taxes are EXCLUSIVE (added on top) and are computed on the
 * post-discount taxable value of each line, which is what Indian GST rules
 * require. Packaging and delivery charges are not taxed in this build; if you
 * need them taxed, add them to `taxableAmount` in `computeOrder` and give them
 * a percent from settings.
 */

import { percentOf, roundOffDelta } from './money';
import type { DiscountKind } from './constants';

export interface CartAddOn {
  id?: string;
  name: string;
  price: number; // minor units, per unit of the parent item
}

export interface PricingLineInput {
  /** Stable row key so the UI can reconcile results back to cart rows. */
  key: string;
  /** Absent on a quick-added line: it was typed at the counter, not picked. */
  menuItemId?: string | null;
  variantId?: string | null;
  name: string;
  variantName?: string | null;
  unitPrice: number;
  qty: number;
  taxPct: number;
  isVeg?: boolean;
  prepArea?: string | null;
  addOns?: CartAddOn[];
  /** Line-level discount. */
  discountKind?: DiscountKind | null;
  discountValue?: number;
  /** Free item: the whole line is discounted to zero but still hits the KOT. */
  isComplimentary?: boolean;
  instructions?: string;
}

export interface PricingOrderInput {
  lines: PricingLineInput[];
  packagingCharge?: number;
  deliveryCharge?: number;
  orderDiscount?: {
    kind: DiscountKind;
    /** Whole percent for PERCENT/COUPON-as-percent, else minor units. */
    value: number;
    /** 0 or undefined = uncapped. */
    maxDiscount?: number;
    code?: string | null;
    reason?: string;
  } | null;
  roundOffTotals?: boolean;
}

export interface PricingLineResult extends PricingLineInput {
  addOnTotal: number;
  /** (unitPrice + addOnTotal) * qty, before any discount. */
  lineSubtotal: number;
  /** Line-level discount only. */
  discount: number;
  /** Share of the whole-order discount allocated to this line. */
  allocatedOrderDiscount: number;
  /** lineSubtotal - discount - allocatedOrderDiscount */
  taxableAmount: number;
  taxAmount: number;
  /** taxableAmount + taxAmount */
  lineTotal: number;
}

export interface PricingResult {
  lines: PricingLineResult[];
  itemsSubtotal: number;
  itemDiscount: number;
  orderDiscount: number;
  discountTotal: number;
  taxableAmount: number;
  taxTotal: number;
  packagingCharge: number;
  deliveryCharge: number;
  roundOff: number;
  grandTotal: number;
  /** Convenience: how many physical items are in the cart. */
  itemCount: number;
  unitCount: number;
}

/**
 * Split `total` across `weights` so that the parts are proportional AND sum
 * exactly to `total` (largest-remainder method). Without this, rounding each
 * share independently loses or gains a paisa on most multi-line bills.
 */
export function allocateProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out;
}

/** Resolve a discount definition against a base amount. */
export function resolveDiscount(
  kind: DiscountKind,
  value: number,
  base: number,
  maxDiscount = 0,
): number {
  if (base <= 0) return 0;
  let amount = 0;
  switch (kind) {
    case 'PERCENT':
    case 'COUPON':
      amount = percentOf(base, Math.max(0, Math.min(100, value)));
      break;
    case 'FIXED':
      amount = Math.max(0, value);
      break;
    case 'COMPLIMENTARY':
      amount = base;
      break;
  }
  if (maxDiscount > 0) amount = Math.min(amount, maxDiscount);
  return Math.min(amount, base);
}

export function computeOrder(input: PricingOrderInput): PricingResult {
  const packagingCharge = Math.max(0, Math.round(input.packagingCharge ?? 0));
  const deliveryCharge = Math.max(0, Math.round(input.deliveryCharge ?? 0));

  // ---- 1. per-line subtotal and line-level discount -----------------------
  const staged = input.lines
    .filter((l) => l.qty > 0)
    .map((l) => {
      const addOns = l.addOns ?? [];
      const addOnTotal = addOns.reduce((a, x) => a + Math.max(0, Math.round(x.price)), 0);
      const lineSubtotal = (Math.max(0, Math.round(l.unitPrice)) + addOnTotal) * Math.round(l.qty);

      const discount = l.isComplimentary
        ? lineSubtotal
        : l.discountKind
          ? resolveDiscount(l.discountKind, l.discountValue ?? 0, lineSubtotal)
          : 0;

      return { ...l, addOns, addOnTotal, lineSubtotal, discount };
    });

  const itemsSubtotal = staged.reduce((a, l) => a + l.lineSubtotal, 0);
  const itemDiscount = staged.reduce((a, l) => a + l.discount, 0);
  const netAfterItemDiscount = itemsSubtotal - itemDiscount;

  // ---- 2. whole-order discount, then spread it back over the lines --------
  const orderDiscount = input.orderDiscount
    ? resolveDiscount(
        input.orderDiscount.kind,
        input.orderDiscount.value,
        netAfterItemDiscount,
        input.orderDiscount.maxDiscount ?? 0,
      )
    : 0;

  // Weight by each line's own net value so a line already discounted to zero
  // does not absorb any of the order discount.
  const allocations = allocateProportional(
    orderDiscount,
    staged.map((l) => Math.max(0, l.lineSubtotal - l.discount)),
  );

  // ---- 3. tax per line on the fully discounted value ---------------------
  const lines: PricingLineResult[] = staged.map((l, i) => {
    const allocatedOrderDiscount = allocations[i] ?? 0;
    const taxableAmount = Math.max(0, l.lineSubtotal - l.discount - allocatedOrderDiscount);
    const taxAmount = percentOf(taxableAmount, Math.max(0, l.taxPct ?? 0));
    return {
      ...l,
      allocatedOrderDiscount,
      taxableAmount,
      taxAmount,
      lineTotal: taxableAmount + taxAmount,
    };
  });

  const taxableAmount = lines.reduce((a, l) => a + l.taxableAmount, 0);
  const taxTotal = lines.reduce((a, l) => a + l.taxAmount, 0);

  // ---- 4. charges, rounding, grand total ---------------------------------
  const preRound = taxableAmount + taxTotal + packagingCharge + deliveryCharge;
  const roundOff = input.roundOffTotals ? roundOffDelta(preRound) : 0;

  return {
    lines,
    itemsSubtotal,
    itemDiscount,
    orderDiscount,
    discountTotal: itemDiscount + orderDiscount,
    taxableAmount,
    taxTotal,
    packagingCharge,
    deliveryCharge,
    roundOff,
    grandTotal: preRound + roundOff,
    itemCount: lines.length,
    unitCount: lines.reduce((a, l) => a + l.qty, 0),
  };
}

/** Derive UNPAID / PARTIAL / PAID from what has actually been collected. */
export function derivePaymentStatus(grandTotal: number, paidTotal: number) {
  if (paidTotal <= 0) return 'UNPAID' as const;
  if (paidTotal >= grandTotal) return 'PAID' as const;
  return 'PARTIAL' as const;
}
