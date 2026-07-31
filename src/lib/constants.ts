/**
 * Status / type vocabularies.
 *
 * These live in code rather than as database enums so the schema stays
 * portable between SQLite and PostgreSQL. Anything writing one of these
 * columns must validate through the Zod schemas in src/lib/validation.ts.
 */

export const ROLES = ['ADMIN', 'CASHIER'] as const;
export type RoleKey = (typeof ROLES)[number];

export const ORDER_TYPES = ['DINEIN', 'TAKEAWAY', 'DELIVERY'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  DINEIN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

export const ORDER_STATUSES = [
  'DRAFT', 'HELD', 'NEW', 'PREPARING', 'READY',
  'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that still count as "in progress" on the floor. */
export const OPEN_STATUSES: OrderStatus[] = ['DRAFT', 'HELD', 'NEW', 'PREPARING', 'READY'];
/** Statuses excluded from sales totals. */
export const VOID_STATUSES: OrderStatus[] = ['DRAFT', 'HELD', 'CANCELLED'];

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'ONLINE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  ONLINE: 'Online',
  OTHER: 'Other',
};

export const DISCOUNT_KINDS = ['PERCENT', 'FIXED', 'COUPON', 'COMPLIMENTARY'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const RECEIPT_WIDTHS = [58, 80] as const;
export type ReceiptWidth = (typeof RECEIPT_WIDTHS)[number];

/** Permission keys. Admin implicitly holds all of them. */
export const PERMISSIONS = {
  ORDER_CREATE: 'order.create',
  ORDER_REPRINT: 'order.reprint',
  ORDER_CANCEL: 'order.cancel',
  ORDER_REFUND: 'order.refund',
  ORDER_REOPEN: 'order.reopen',
  MENU_WRITE: 'menu.write',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  SETTINGS_WRITE: 'settings.write',
  USERS_WRITE: 'users.write',
  CASH_REGISTER: 'cash.register',
} as const;

export const CASHIER_PERMISSIONS: string[] = [
  PERMISSIONS.ORDER_CREATE,
  PERMISSIONS.ORDER_REPRINT,
  PERMISSIONS.CASH_REGISTER,
];
