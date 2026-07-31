import { z } from 'zod';
import {
  DISCOUNT_KINDS, ORDER_STATUSES, ORDER_TYPES, PAYMENT_METHODS, RECEIPT_WIDTHS, ROLES,
} from './constants';

/**
 * Every API input is parsed through one of these. Money fields arrive as
 * integers in minor units — the client converts before sending, so we never
 * accept a float here.
 */

const minor = z.number().int().min(0).max(100_000_000);
const percent = z.number().int().min(0).max(100);

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const cartAddOnSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  price: minor,
});

/**
 * A quick-added line: an item that exists on this bill and nowhere else.
 *
 * This is the one place where a price from the client is stored as sent, because
 * there is no menu row to read it back from — see the note in orderService.ts.
 */
export const customLineSchema = z.object({
  name: z.string().trim().min(1, 'Give the item a name.').max(60),
  unitPrice: minor,
  /** Falls back to the restaurant's default rate when the cashier leaves it. */
  taxPct: percent.optional(),
  isVeg: z.boolean().default(true),
});

export const cartLineSchema = z
  .object({
    key: z.string().min(1),
    /** Null or absent on a quick-added line. */
    menuItemId: z.string().min(1).nullable().optional(),
    custom: customLineSchema.nullable().optional(),
    variantId: z.string().nullable().optional(),
    qty: z.number().int().min(1).max(999),
    addOns: z.array(cartAddOnSchema).max(20).default([]),
    discountKind: z.enum(DISCOUNT_KINDS).nullable().optional(),
    discountValue: z.number().int().min(0).optional(),
    isComplimentary: z.boolean().optional(),
    instructions: z.string().trim().max(200).default(''),
  })
  .superRefine((line, ctx) => {
    // Exactly one origin: a menu item or a typed-in one, never both or neither.
    if (!line.menuItemId && !line.custom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['menuItemId'],
        message: 'A line must be either a menu item or a quick-added item.',
      });
    }
    if (line.menuItemId && line.custom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['custom'],
        message: 'A menu item cannot also carry quick-add details.',
      });
    }
    // Add-ons are validated against the parent menu item, and a quick-added
    // line has no parent — the cashier puts extras in the price or the note.
    if (line.custom && line.addOns.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['addOns'],
        message: 'A quick-added item cannot have add-ons.',
      });
    }
    if (line.custom && line.variantId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variantId'],
        message: 'A quick-added item cannot have a size.',
      });
    }
  });

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: minor,
  reference: z.string().trim().max(40).optional(),
});

export const createOrderSchema = z.object({
  /** Client-generated UUID; makes the whole request replay-safe. */
  idempotencyKey: z.string().min(8).max(64),
  orderType: z.enum(ORDER_TYPES),
  /** DRAFT/HELD keep the order open; NEW/COMPLETED close the sale. */
  status: z.enum(['DRAFT', 'HELD', 'NEW', 'COMPLETED']).default('COMPLETED'),
  tableNo: z.string().trim().max(20).optional(),
  customerName: z.string().trim().max(80).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  instructions: z.string().trim().max(300).default(''),
  lines: z.array(cartLineSchema).min(1, 'Add at least one item.'),
  packagingCharge: minor.default(0),
  deliveryCharge: minor.default(0),
  orderDiscount: z
    .object({
      kind: z.enum(DISCOUNT_KINDS),
      value: z.number().int().min(0),
      code: z.string().trim().max(30).nullable().optional(),
      reason: z.string().trim().max(120).default(''),
    })
    .nullable()
    .optional(),
  payments: z.array(paymentSchema).max(5).default([]),
  /** Set by the offline queue when replaying a stored order. */
  offlineCreatedAt: z.string().datetime().optional(),
  /**
   * Bill this order as if it were placed at this moment — the lunch a customer
   * asks to pay for at night. Admin only, and enforced in orderService.ts.
   *
   * Bounded on purpose: never in the future beyond a minute of clock skew, and
   * no more than 30 days back. A bill dated next week is a mistake, and one
   * dated last quarter is somebody rewriting a closed month.
   */
  billedAt: z.string().datetime().optional(),
  saveCustomer: z.boolean().default(false),
  /**
   * When a held order is resumed, edited and saved again, the original is
   * removed as part of the same transaction. Only DRAFT and HELD orders — which
   * never received a bill number — can be replaced this way, so nothing that
   * has been billed is ever deleted.
   */
  replacesOrderId: z.string().nullable().optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(200).optional(),
});

export const addPaymentsSchema = z.object({
  payments: z.array(paymentSchema).min(1),
});

export const refundSchema = z.object({
  amount: minor,
  method: z.enum(PAYMENT_METHODS),
  reason: z.string().trim().min(3, 'A refund needs a reason.').max(200),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'A cancellation needs a reason.').max(200),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  sortOrder: z.number().int().min(0).max(999).default(0),
  prepArea: z.string().trim().max(30).nullable().optional(),
  active: z.boolean().default(true),
});

export const variantSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(30),
  price: minor,
  active: z.boolean().default(true),
});

export const addOnSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(40),
  price: minor,
  active: z.boolean().default(true),
});

export const menuItemSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  categoryId: z.string().min(1),
  price: minor,
  taxPct: percent.nullable().optional(),
  isVeg: z.boolean().default(true),
  available: z.boolean().default(true),
  enabled: z.boolean().default(true),
  prepArea: z.string().trim().max(30).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  variants: z.array(variantSchema).max(12).default([]),
  addOns: z.array(addOnSchema).max(20).default([]),
});

export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  logoDataUrl: z.string().max(200_000).nullable().optional(),
  addressLine1: z.string().trim().max(120).default(''),
  addressLine2: z.string().trim().max(120).default(''),
  city: z.string().trim().max(60).default(''),
  phone: z.string().trim().max(40).default(''),
  email: z.string().trim().max(80).default(''),
  gstNumber: z.string().trim().max(30).default(''),
  fssaiNumber: z.string().trim().max(30).default(''),
  receiptFooter: z.string().trim().max(200).default(''),
  currency: z.string().trim().length(3).default('INR'),
  locale: z.string().trim().max(10).default('en-IN'),
  timeZone: z.string().trim().max(40).default('Asia/Kolkata'),
  receiptWidth: z.union([z.literal(58), z.literal(80)]),
  defaultTaxPct: percent,
  splitTaxOnReceipt: z.boolean().default(true),
  defaultPackagingChg: minor,
  defaultDeliveryChg: minor,
  roundOffTotals: z.boolean().default(true),
  billNumberFormat: z.string().trim().min(1).max(40),
  orderNumberFormat: z.string().trim().min(1).max(40),
  kotNumberFormat: z.string().trim().min(1).max(40),
  printKotOnSave: z.boolean().default(true),
});

export const userSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email(),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(8).max(72).optional(),
  role: z.enum(ROLES),
  maxDiscountPct: percent.default(0),
  maxDiscountAmt: minor.default(0),
  active: z.boolean().default(true),
});

export const receiptWidthSchema = z.coerce
  .number()
  .refine((n): n is 58 | 80 => (RECEIPT_WIDTHS as readonly number[]).includes(n), 'Unsupported width');
