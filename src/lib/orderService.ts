import { prisma } from './db';
import { getSettings } from './settings';
import { generateNumber } from './numbering';
import { computeOrder, derivePaymentStatus, type PricingLineInput } from './pricing';
import { audit } from './audit';
import { HttpError, type SessionPayload } from './session';
import type { CreateOrderInput } from './validation';

/**
 * Everything that writes an order goes through here.
 *
 * The single most important rule in this file: the client's prices are ignored.
 * The cart payload only says *which* item, *which* variant, how many, and what
 * discount was asked for. Unit prices, tax percentages and add-on prices are
 * re-read from the database, and the totals are recomputed with the same pure
 * function the browser used for its preview. A modified payload can change what
 * is ordered, never what it costs.
 *
 * There is exactly one exception, and it is deliberate: a quick-added line
 * (`line.custom`) has no menu row to read a price from — the cashier typed the
 * name and the amount at the counter for this bill only. Those two values are
 * therefore stored as sent. Every such line is written to the audit trail with
 * the cashier's id so an admin can see what was invented and for how much. If a
 * shop wants this gated, `assertQuickAddAllowed` below is the single place to
 * put the check.
 */

export interface CreateOrderResult {
  id: string;
  orderNo: string;
  billNo: string | null;
  grandTotal: number;
  /** True when this exact request had already been saved (idempotent replay). */
  duplicate: boolean;
}

export async function createOrder(
  input: CreateOrderInput,
  session: SessionPayload,
  ip?: string | null,
): Promise<CreateOrderResult> {
  // ---- 0. replay protection ----------------------------------------------
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, orderNo: true, billNo: true, grandTotal: true },
  });
  if (existing) return { ...existing, duplicate: true };

  const settings = await getSettings();

  // ---- 1. re-read the menu ------------------------------------------------
  const itemIds = [
    ...new Set(input.lines.map((l) => l.menuItemId).filter((id): id is string => Boolean(id))),
  ];
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: itemIds } },
    include: { variants: true, addOns: true, tax: true, category: true },
  });
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  const pricingLines: PricingLineInput[] = [];
  const lineMeta: {
    key: string;
    menuItemId: string | null;
    variantId: string | null;
    isVeg: boolean;
    prepArea: string | null;
    variantName: string | null;
  }[] = [];
  /** Quick-added lines, kept for the audit entry written after the order. */
  const quickAdded: { name: string; unitPrice: number; qty: number; taxPct: number }[] = [];

  for (const line of input.lines) {
    // ---- quick-added line: typed at the counter, not on the menu ----------
    if (line.custom) {
      assertQuickAddAllowed(session);
      if (line.isComplimentary && session.role !== 'ADMIN') {
        throw new HttpError(403, 'Only an admin can mark an item complimentary.');
      }
      assertDiscountAllowed(session, line.discountKind ?? null, line.discountValue ?? 0);

      const taxPct = line.custom.taxPct ?? settings.defaultTaxPct;
      pricingLines.push({
        key: line.key,
        menuItemId: null,
        variantId: null,
        name: line.custom.name,
        variantName: null,
        unitPrice: line.custom.unitPrice,
        qty: line.qty,
        taxPct,
        isVeg: line.custom.isVeg,
        prepArea: null,
        addOns: [],
        discountKind: line.discountKind ?? null,
        discountValue: line.discountValue ?? 0,
        isComplimentary: line.isComplimentary ?? false,
        instructions: line.instructions ?? '',
      });
      lineMeta.push({
        key: line.key,
        menuItemId: null,
        variantId: null,
        isVeg: line.custom.isVeg,
        prepArea: null,
        variantName: null,
      });
      quickAdded.push({
        name: line.custom.name,
        unitPrice: line.custom.unitPrice,
        qty: line.qty,
        taxPct,
      });
      continue;
    }

    const item = line.menuItemId ? byId.get(line.menuItemId) : undefined;
    if (!item) throw new HttpError(400, `An item in the cart no longer exists. Remove it and try again.`);
    if (!item.enabled) throw new HttpError(400, `"${item.name}" has been removed from the menu.`);
    if (!item.available) throw new HttpError(400, `"${item.name}" is marked out of stock.`);

    let unitPrice = item.price;
    let variantName: string | null = null;
    if (line.variantId) {
      const variant = item.variants.find((v) => v.id === line.variantId);
      if (!variant || !variant.active) {
        throw new HttpError(400, `The selected size for "${item.name}" is not available.`);
      }
      unitPrice = variant.price;
      variantName = variant.name;
    }

    // Add-on prices also come from the database, matched by id where given.
    const addOns = (line.addOns ?? []).map((a) => {
      const known = item.addOns.find((x) => (a.id ? x.id === a.id : x.name === a.name));
      if (!known || !known.active) {
        throw new HttpError(400, `"${a.name}" is not an add-on for "${item.name}".`);
      }
      return { id: known.id, name: known.name, price: known.price };
    });

    const taxPct = item.taxPct ?? item.tax?.percent ?? settings.defaultTaxPct;

    if (line.isComplimentary && session.role !== 'ADMIN') {
      throw new HttpError(403, 'Only an admin can mark an item complimentary.');
    }
    assertDiscountAllowed(session, line.discountKind ?? null, line.discountValue ?? 0);

    pricingLines.push({
      key: line.key,
      menuItemId: item.id,
      variantId: line.variantId ?? null,
      name: item.name,
      variantName,
      unitPrice,
      qty: line.qty,
      taxPct,
      isVeg: item.isVeg,
      prepArea: item.prepArea ?? item.category.prepArea ?? null,
      addOns,
      discountKind: line.discountKind ?? null,
      discountValue: line.discountValue ?? 0,
      isComplimentary: line.isComplimentary ?? false,
      instructions: line.instructions ?? '',
    });
    lineMeta.push({
      key: line.key,
      menuItemId: item.id,
      variantId: line.variantId ?? null,
      isVeg: item.isVeg,
      prepArea: item.prepArea ?? item.category.prepArea ?? null,
      variantName,
    });
  }

  // ---- 2. order-level discount, with the cashier's ceiling enforced -------
  let orderDiscountInput = input.orderDiscount ?? null;
  let couponMaxDiscount = 0;

  if (orderDiscountInput) {
    if (orderDiscountInput.kind === 'COMPLIMENTARY' && session.role !== 'ADMIN') {
      throw new HttpError(403, 'Only an admin can make a whole order complimentary.');
    }
    if (orderDiscountInput.kind === 'COUPON') {
      const code = (orderDiscountInput.code ?? '').trim().toUpperCase();
      const coupon = code ? await prisma.discount.findUnique({ where: { code } }) : null;
      const now = new Date();
      if (!coupon || !coupon.active) throw new HttpError(400, 'That coupon code is not valid.');
      if (coupon.validFrom && coupon.validFrom > now) throw new HttpError(400, 'That coupon is not active yet.');
      if (coupon.validTo && coupon.validTo < now) throw new HttpError(400, 'That coupon has expired.');
      if (coupon.requiresAdmin && session.role !== 'ADMIN') {
        throw new HttpError(403, 'That coupon needs admin approval.');
      }
      couponMaxDiscount = coupon.maxDiscount;
      // The coupon's own definition wins over whatever the client sent.
      orderDiscountInput = {
        kind: coupon.kind as typeof orderDiscountInput.kind,
        value: coupon.value,
        code,
        reason: orderDiscountInput.reason || coupon.name,
      };
      const gross = pricingLines.reduce(
        (a, l) => a + (l.unitPrice + (l.addOns ?? []).reduce((s, x) => s + x.price, 0)) * l.qty,
        0,
      );
      if (coupon.minOrder > 0 && gross < coupon.minOrder) {
        throw new HttpError(400, 'The order value is below this coupon\u2019s minimum.');
      }
    } else {
      assertDiscountAllowed(session, orderDiscountInput.kind, orderDiscountInput.value);
    }
  }

  // ---- 3. compute --------------------------------------------------------
  const totals = computeOrder({
    lines: pricingLines,
    packagingCharge: input.orderType === 'DINEIN' ? 0 : input.packagingCharge,
    deliveryCharge: input.orderType === 'DELIVERY' ? input.deliveryCharge : 0,
    orderDiscount: orderDiscountInput
      ? {
          kind: orderDiscountInput.kind,
          value: orderDiscountInput.value,
          maxDiscount: couponMaxDiscount,
          code: orderDiscountInput.code ?? null,
          reason: orderDiscountInput.reason,
        }
      : null,
    roundOffTotals: settings.roundOffTotals,
  });

  // ---- 4. payments -------------------------------------------------------
  const paidTotal = input.payments.reduce((a, p) => a + p.amount, 0);
  if (paidTotal > totals.grandTotal) {
    throw new HttpError(
      400,
      'The payment total is more than the bill. Record only the amount applied to the bill — hand back the change.',
    );
  }
  const isOpen = input.status === 'DRAFT' || input.status === 'HELD';
  const paymentStatus = isOpen ? 'UNPAID' : derivePaymentStatus(totals.grandTotal, paidTotal);

  // ---- 4b. the time this bill is for -------------------------------------
  const now = new Date();
  const billedAt = resolveBilledAt(input.billedAt, session, now);

  // ---- 5. numbers --------------------------------------------------------
  // The numbers follow the billed time, not the wall clock: a bill dated
  // yesterday carries yesterday's date tokens and continues that day's
  // sequence. The counter is a single atomic increment per key, so reaching back
  // into a past day's sequence still cannot produce a duplicate.
  const orderNo = await generateNumber(
    'order',
    settings.orderNumberFormat,
    settings.timeZone,
    billedAt,
  );
  const billNo = isOpen
    ? null
    : await generateNumber('bill', settings.billNumberFormat, settings.timeZone, billedAt);

  // ---- 6. customer -------------------------------------------------------
  let customerId: string | null = null;
  if (input.customerPhone && input.saveCustomer) {
    const phone = input.customerPhone.trim();
    const customer = await prisma.customer.upsert({
      where: { phone },
      update: {
        name: input.customerName?.trim() || undefined,
        addressLine: input.address?.trim() || undefined,
      },
      create: {
        phone,
        name: input.customerName?.trim() || 'Guest',
        addressLine: input.address?.trim() ?? '',
      },
    });
    customerId = customer.id;
  }

  // ---- 6b. validate the order being replaced (resumed hold) --------------
  if (input.replacesOrderId) {
    const target = await prisma.order.findUnique({
      where: { id: input.replacesOrderId },
      select: { id: true, status: true, billNo: true, cashierId: true },
    });
    if (!target) throw new HttpError(404, 'The held order no longer exists.');
    if (target.billNo || (target.status !== 'DRAFT' && target.status !== 'HELD')) {
      throw new HttpError(409, 'That order has already been billed and cannot be replaced.');
    }
    if (session.role !== 'ADMIN' && target.cashierId !== session.sub) {
      throw new HttpError(403, 'That held order belongs to another counter.');
    }
  }

  // ---- 7. write ----------------------------------------------------------
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNo,
        billNo,
        orderType: input.orderType,
        status: input.status,
        paymentStatus,
        tableNo: input.tableNo || null,
        customerName: input.customerName || null,
        customerPhone: input.customerPhone || null,
        address: input.address || null,
        customerId,
        instructions: input.instructions ?? '',
        itemsSubtotal: totals.itemsSubtotal,
        itemDiscount: totals.itemDiscount,
        orderDiscount: totals.orderDiscount,
        discountTotal: totals.discountTotal,
        taxableAmount: totals.taxableAmount,
        taxTotal: totals.taxTotal,
        packagingCharge: totals.packagingCharge,
        deliveryCharge: totals.deliveryCharge,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        paidTotal,
        cashierId: session.sub,
        idempotencyKey: input.idempotencyKey,
        offlineCreatedAt: input.offlineCreatedAt ? new Date(input.offlineCreatedAt) : null,
        // On an ordinary bill these are the same instant and actualCreatedAt is
        // null. On a back-dated one, createdAt is what the customer is billed for
        // — it drives the slip, the reports and the day the sale belongs to —
        // while actualCreatedAt preserves when the row was really written.
        createdAt: billedAt,
        completedAt: input.status === 'COMPLETED' ? billedAt : null,
        actualCreatedAt: billedAt.getTime() === now.getTime() ? null : now,
        items: {
          create: totals.lines.map((l, i) => ({
            menuItemId: lineMeta[i]?.menuItemId ?? l.menuItemId,
            variantId: l.variantId ?? null,
            nameSnapshot: l.name,
            variantSnapshot: l.variantName ?? null,
            isVeg: l.isVeg ?? true,
            prepArea: l.prepArea ?? null,
            unitPrice: l.unitPrice,
            qty: l.qty,
            addOnsJson: JSON.stringify(
              (l.addOns ?? []).map((a) => ({ name: a.name, price: a.price })),
            ),
            addOnTotal: l.addOnTotal,
            discount: l.discount + l.allocatedOrderDiscount,
            taxPct: l.taxPct,
            taxAmount: l.taxAmount,
            lineSubtotal: l.lineSubtotal,
            lineTotal: l.lineTotal,
            instructions: l.instructions ?? '',
            isComplimentary: l.isComplimentary ?? false,
          })),
        },
        payments: {
          create: input.payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            reference: p.reference || null,
          })),
        },
      },
      select: { id: true, orderNo: true, billNo: true, grandTotal: true },
    });

    // Record the discount(s) that were actually applied, with who applied them.
    if (totals.orderDiscount > 0 && orderDiscountInput) {
      await tx.orderDiscount.create({
        data: {
          orderId: order.id,
          kind: orderDiscountInput.kind,
          value: orderDiscountInput.value,
          amount: totals.orderDiscount,
          code: orderDiscountInput.code ?? null,
          reason: orderDiscountInput.reason ?? '',
          appliedById: session.sub,
        },
      });
    }
    for (const l of totals.lines) {
      if (l.discount > 0) {
        await tx.orderDiscount.create({
          data: {
            orderId: order.id,
            kind: l.isComplimentary ? 'COMPLIMENTARY' : (l.discountKind ?? 'FIXED'),
            value: l.isComplimentary ? 100 : (l.discountValue ?? 0),
            amount: l.discount,
            reason: l.isComplimentary ? 'Complimentary item' : 'Item discount',
            appliedById: session.sub,
          },
        });
      }
    }

    // The resumed hold is removed only now, so a failure anywhere above leaves
    // the original order untouched.
    if (input.replacesOrderId) {
      await tx.order.delete({ where: { id: input.replacesOrderId } });
    }

    if (customerId && !isOpen) {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          totalOrders: { increment: 1 },
          totalSpend: { increment: totals.grandTotal },
          lastOrderAt: new Date(),
        },
      });
    }

    return order;
  });

  await audit({
    actorId: session.sub,
    actorName: session.name,
    action: 'order.create',
    entity: 'Order',
    entityId: created.id,
    ip,
    meta: {
      orderNo: created.orderNo,
      billNo: created.billNo,
      status: input.status,
      orderType: input.orderType,
      grandTotal: created.grandTotal,
      discountTotal: totals.discountTotal,
      offline: Boolean(input.offlineCreatedAt),
      replaced: input.replacesOrderId ?? null,
      // Both times, whenever they differ. An owner reviewing the trail can see
      // that a bill was dated by hand, to when, and by whom.
      ...(input.billedAt
        ? { billedAt: billedAt.toISOString(), actuallyCreatedAt: now.toISOString() }
        : {}),
    },
  });

  // Priced by hand, so it is recorded by hand: name, price and quantity of every
  // line that came from nowhere but the counter.
  if (quickAdded.length > 0) {
    await audit({
      actorId: session.sub,
      actorName: session.name,
      action: 'order.quickAdd',
      entity: 'Order',
      entityId: created.id,
      ip,
      meta: { orderNo: created.orderNo, billNo: created.billNo, lines: quickAdded },
    });
  }

  return { ...created, duplicate: false };
}

/** How far back a bill may be dated. */
const MAX_BACKDATE_DAYS = 30;

/**
 * Resolves the moment a bill is *for*.
 *
 * Normally that is now. An admin may bill an earlier time — the customer ate at
 * lunch and comes back at night wanting a lunch-time bill — which is a real
 * counter need and also the single most abusable field in this app: it decides
 * which day's sales, which day's cash drawer and which day's tax the money lands
 * in. Hence three limits, none of them negotiable at the call site:
 *
 *   1. Admins only. A cashier who could re-date a sale could move cash out of the
 *      shift it will be counted against.
 *   2. Never the future. A minute of tolerance for a phone with a fast clock;
 *      beyond that a future-dated bill is a typo, and it would hide from every
 *      "today" report until its date arrived.
 *   3. Thirty days back at most. Further than that is not a late customer, it is
 *      somebody rewriting a month that has already been reported.
 */
function resolveBilledAt(
  raw: string | undefined,
  session: SessionPayload,
  now: Date,
): Date {
  if (!raw) return now;

  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new HttpError(400, 'That bill date is not a valid time.');

  if (session.role !== 'ADMIN') {
    throw new HttpError(403, 'Only an admin can change the date and time on a bill.');
  }
  if (at.getTime() > now.getTime() + 60_000) {
    throw new HttpError(400, 'A bill cannot be dated in the future.');
  }
  if (at.getTime() < now.getTime() - MAX_BACKDATE_DAYS * 86_400_000) {
    throw new HttpError(400, `A bill cannot be dated more than ${MAX_BACKDATE_DAYS} days back.`);
  }
  return at;
}

/**
 * Who may put an item on a bill that is not on the menu.
 *
 * Open to every signed-in cashier: at a counter, "one plate of whatever the
 * kitchen improvised, ₹180" cannot wait for a menu edit. The line is audited
 * instead of blocked. A shop that would rather restrict it should return an
 * HttpError(403) here for non-admins — nothing else needs to change.
 */
function assertQuickAddAllowed(session: SessionPayload) {
  if (!session.sub) throw new HttpError(403, 'Sign in again to add an item to the bill.');
}

/** A cashier may not exceed the ceiling the admin set on their account. */
function assertDiscountAllowed(
  session: SessionPayload,
  kind: string | null,
  value: number,
) {
  if (!kind || value <= 0) return;
  if (session.role === 'ADMIN') return;
  if (kind === 'PERCENT' && value > (session.maxDiscountPct ?? 0)) {
    throw new HttpError(
      403,
      `You can give up to ${session.maxDiscountPct ?? 0}%. Ask an admin for anything higher.`,
    );
  }
  if (kind === 'FIXED' && value > (session.maxDiscountAmt ?? 0)) {
    throw new HttpError(403, 'That discount is above your limit. Ask an admin to approve it.');
  }
}

// ---------------------------------------------------------------------------
// KOT batching
// ---------------------------------------------------------------------------

/**
 * Claim the next KOT batch for an order and stamp it on every line that has
 * not been sent to the kitchen yet. Returns the batch number and KOT number.
 * Calling it again after adding items prints only the new lines, which is what
 * "additional KOT" means on the floor.
 */
export async function claimKotBatch(orderId: string, session: SessionPayload) {
  const settings = await getSettings();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { where: { kotBatch: 0, voided: false } } },
  });
  if (!order) throw new HttpError(404, 'Order not found.');
  if (order.items.length === 0) {
    // Nothing new — reprint the most recent batch instead of an empty ticket.
    return { batch: order.kotBatches, kotNo: null, newItems: 0 };
  }

  const kotNo = await generateNumber('kot', settings.kotNumberFormat, settings.timeZone);
  const batch = order.kotBatches + 1;

  await prisma.$transaction([
    prisma.orderItem.updateMany({
      where: { orderId, kotBatch: 0, voided: false },
      data: { kotBatch: batch },
    }),
    prisma.order.update({ where: { id: orderId }, data: { kotBatches: batch } }),
  ]);

  await audit({
    actorId: session.sub,
    actorName: session.name,
    action: 'order.kot',
    entity: 'Order',
    entityId: orderId,
    meta: { batch, kotNo, lines: order.items.length },
  });

  return { batch, kotNo, newItems: order.items.length };
}

// ---------------------------------------------------------------------------
// Cancel / refund
// ---------------------------------------------------------------------------

export async function cancelOrder(orderId: string, reason: string, session: SessionPayload) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new HttpError(404, 'Order not found.');
  if (order.status === 'CANCELLED') throw new HttpError(409, 'This order is already cancelled.');
  if (order.status === 'REFUNDED') throw new HttpError(409, 'Refunded orders cannot be cancelled.');
  if (order.paidTotal > 0 && session.role !== 'ADMIN') {
    throw new HttpError(403, 'This bill has payments against it. An admin must cancel it.');
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'CANCELLED', cancelReason: reason },
  });

  // Cancelling a paid order must not leave the customer's lifetime spend
  // inflated.
  if (order.customerId && order.paidTotal > 0) {
    await prisma.customer.update({
      where: { id: order.customerId },
      data: {
        totalOrders: { decrement: 1 },
        totalSpend: { decrement: order.grandTotal },
      },
    }).catch(() => undefined);
  }

  await audit({
    actorId: session.sub,
    actorName: session.name,
    action: 'order.cancel',
    entity: 'Order',
    entityId: orderId,
    meta: { orderNo: order.orderNo, billNo: order.billNo, reason, grandTotal: order.grandTotal },
  });

  return updated;
}

export async function refundOrder(
  orderId: string,
  input: { amount: number; method: string; reason: string },
  session: SessionPayload,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new HttpError(404, 'Order not found.');
  if (order.status === 'CANCELLED') throw new HttpError(409, 'Cancelled orders cannot be refunded.');

  const remaining = order.paidTotal - order.refundedTotal;
  if (input.amount <= 0) throw new HttpError(400, 'Enter a refund amount.');
  if (input.amount > remaining) {
    throw new HttpError(400, 'The refund is more than what was collected on this bill.');
  }

  const kind = input.amount >= remaining ? 'FULL' : 'PARTIAL';

  const [refund] = await prisma.$transaction([
    prisma.refund.create({
      data: {
        orderId,
        amount: input.amount,
        kind,
        method: input.method,
        reason: input.reason,
        createdById: session.sub,
      },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        refundedTotal: { increment: input.amount },
        status: kind === 'FULL' ? 'REFUNDED' : order.status,
      },
    }),
  ]);

  await audit({
    actorId: session.sub,
    actorName: session.name,
    action: 'order.refund',
    entity: 'Order',
    entityId: orderId,
    meta: { orderNo: order.orderNo, amount: input.amount, kind, method: input.method, reason: input.reason },
  });

  return refund;
}
