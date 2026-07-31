'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeOrder, type PricingLineInput } from '@/lib/pricing';
import { plain } from '@/lib/money';
import { tzOffsetMinutes } from '@/lib/datetime';
import { makeFormatter, parseAmount, uuid } from '@/lib/client/format';
import { post, ApiError } from '@/lib/client/api';
import { queueOrder, isOffline } from '@/lib/client/offline';
import type { CreateOrderInput } from '@/lib/validation';
import { LocalSlipPrinter } from '@/components/LocalSlipPrinter';
import { Receipt } from '@/components/Receipt';
import { canShareFiles, downloadSlipPdf, shareSlipPdf } from '@/lib/client/slipExport';
import { receiptToText } from '@/lib/receiptText';
import type { ReceiptData } from '@/lib/receipt';
import type { PublicSettings, PrintProfile } from '@/lib/settings';
import {
  ORDER_TYPE_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
  type OrderType, type PaymentMethod,
} from '@/lib/constants';

/* ==========================================================================
   Types
   ========================================================================== */

export interface MenuItemView {
  id: string;
  code: string;
  name: string;
  price: number;
  taxPct: number;
  isVeg: boolean;
  available: boolean;
  categoryId: string;
  categoryName: string;
  variants: { id: string; name: string; price: number }[];
  addOns: { id: string; name: string; price: number }[];
}

export interface ResumedOrder {
  /**
   * `resume` reopens a held bill and replaces it on save. `repeat` copies a
   * finished bill's items into a new cart and leaves the original alone.
   */
  mode: 'resume' | 'repeat';
  id: string;
  orderNo: string;
  billNo: string | null;
  orderType: OrderType;
  tableNo: string;
  customerName: string;
  customerPhone: string;
  address: string;
  instructions: string;
  packagingCharge: number;
  deliveryCharge: number;
  lines: {
    menuItemId: string | null;
    /** Present only on a quick-added line — see CartRow.isCustom. */
    custom: { name: string; unitPrice: number; taxPct: number; isVeg: boolean } | null;
    variantId: string | null;
    qty: number;
    instructions: string;
    addOns: { name: string; price: number }[];
  }[];
}

interface CartRow {
  key: string;
  /** Empty on a quick-added row: it is not on the menu. */
  itemId: string;
  /**
   * A line typed in at the counter for this bill only. Its name, price and tax
   * live nowhere but on this row and, once saved, on the order's own snapshot.
   */
  isCustom?: boolean;
  name: string;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  taxPct: number;
  isVeg: boolean;
  qty: number;
  addOns: { id: string; name: string; price: number }[];
  instructions: string;
  discountKind: 'PERCENT' | 'FIXED' | null;
  discountValue: number;
  isComplimentary: boolean;
}

type DiscountMode = 'NONE' | 'PERCENT' | 'FIXED' | 'COUPON';

const DRAFT_KEY = 'restropos.draft.v1';

/**
 * Stands in when a dine-in bill is saved with no table entered.
 *
 * A real value rather than a blank, so the slip, the kitchen ticket and the table
 * column in Orders all read the same thing and nobody has to wonder whether the
 * field was missed or the row is broken.
 */
const DEFAULT_TABLE = 'T-01';

/* ==========================================================================
   Small building blocks
   ========================================================================== */

/** The FSSAI veg / non-veg mark. Used everywhere an item name appears. */
function VegDot({ isVeg }: { isVeg: boolean }) {
  return (
    <span
      aria-label={isVeg ? 'Veg' : 'Non-veg'}
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center border ${
        isVeg ? 'border-veg' : 'border-nonveg'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isVeg ? 'bg-veg' : 'bg-nonveg'}`} />
    </span>
  );
}

function Segmented<T extends string>({
  value, options, onChange, size = 'md',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex overflow-hidden rounded border border-counter-line" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap font-medium ${size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'} ${
            value === o.value ? 'bg-primary text-white' : 'bg-white text-ink-soft hover:bg-counter-deep'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ==========================================================================
   Bill date and time
   ========================================================================== */

/** Mirrors MAX_BACKDATE_DAYS in orderService.ts, which is the real gate. */
const MAX_BACKDATE_DAYS = 30;

/**
 * Reads the two native inputs as a wall-clock time *in the restaurant's*
 * timezone, not the device's.
 *
 * `new Date('2026-07-30T13:30')` means 13:30 wherever the phone happens to think
 * it is. A phone with its clock on another zone would then bill lunch at the
 * wrong hour. So the fields are parsed as if UTC and then shifted by the shop's
 * offset at that moment — the same trick `startOfLocalDay` uses, reusing its
 * tested helper.
 */
function fromShopInputs(date: string, time: string, timeZone: string): Date | null {
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naive)) return null;
  const offset = tzOffsetMinutes(new Date(naive), timeZone);
  return new Date(naive - offset * 60_000);
}

/** The inverse, to prefill the inputs. */
function toShopInputs(at: Date, timeZone: string): { date: string; time: string } {
  const shifted = new Date(at.getTime() + tzOffsetMinutes(at, timeZone) * 60_000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * Bills a meal for the time it was eaten.
 *
 * The case this exists for: a customer eats at lunch, comes back at night, and
 * wants the bill to say lunch. Nothing about the order changes — only which
 * moment it is recorded against, which is also which day's sales and which
 * shift's cash it belongs to. The limits here mirror the server's exactly so a
 * mistake is caught while the sheet is open rather than after a failed save.
 */
function BillTimePicker({
  current,
  timeZone,
  onSet,
  onClear,
  onCancel,
}: {
  current: Date | null;
  timeZone: string;
  onSet: (when: Date) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const initial = useMemo(
    () => toShopInputs(current ?? new Date(), timeZone),
    [current, timeZone],
  );
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState<string | null>(null);

  const resolved = fromShopInputs(date, time, timeZone);
  const preview = resolved
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone,
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(resolved)
    : '—';

  const submit = () => {
    if (!resolved) {
      setError('Enter a date and a time.');
      return;
    }
    const now = Date.now();
    if (resolved.getTime() > now + 60_000) {
      setError('A bill cannot be dated in the future.');
      return;
    }
    if (resolved.getTime() < now - MAX_BACKDATE_DAYS * 86_400_000) {
      setError(`A bill cannot be dated more than ${MAX_BACKDATE_DAYS} days back.`);
      return;
    }
    onSet(resolved);
  };

  /** One tap for the common case: today's lunch, today's dinner. */
  const preset = (hour: number, minute: number) => {
    const today = toShopInputs(new Date(), timeZone).date;
    setDate(today);
    setTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    setError(null);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="mb-1 text-base font-semibold">Bill date and time</h2>
      <p className="mb-3 text-xs text-ink-mute">
        For a meal eaten earlier — the bill prints this time, and the sale counts
        towards that day. Leave it alone for anything ordered now.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">Date</span>
          <input
            type="date"
            className="field min-h-[44px]"
            value={date}
            max={toShopInputs(new Date(), timeZone).date}
            onChange={(e) => {
              setDate(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="block">
          <span className="label">Time</span>
          <input
            type="time"
            className="field min-h-[44px]"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setError(null);
            }}
          />
        </label>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className="btn text-xs" onClick={() => preset(13, 0)}>
          Today 1:00 pm
        </button>
        <button type="button" className="btn text-xs" onClick={() => preset(20, 0)}>
          Today 8:00 pm
        </button>
      </div>

      <p className="mb-3 text-xs text-ink-soft">
        Bill will read <span className="num font-semibold">{preview}</span>
      </p>

      {error && <p className="mb-3 text-xs text-nonveg">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-lg" onClick={onCancel}>
          Cancel
        </button>
        {current && (
          <button type="button" className="btn btn-lg" onClick={onClear}>
            Use current time
          </button>
        )}
        <button type="submit" className="btn-primary btn-lg">
          Set time
        </button>
      </div>
    </form>
  );
}

/* ==========================================================================
   Item grid
   ========================================================================== */

/**
 * The tappable menu.
 *
 * Memoised on purpose. Everything on this screen used to live in one component,
 * so a keystroke in the customer's name — or in a kitchen note, or a payment
 * amount — re-rendered every item button on the left. With a real menu that is
 * hundreds of buttons rebuilt per character. Its props are all stable
 * (`visibleItems` is a useMemo, `money` a useMemo, the handlers useCallbacks),
 * so typing on the cart side now touches nothing over here.
 *
 * Two columns on a phone, up to five on a wide counter screen: the tiles stay
 * thumb-sized instead of stretching.
 */
const MenuGrid = memo(function MenuGrid({
  items,
  query,
  money,
  onTap,
  onQuickAdd,
}: {
  items: MenuItemView[];
  query: string;
  money: (v: number) => string;
  onTap: (item: MenuItemView) => void;
  onQuickAdd: (seed: string) => void;
}) {
  const typed = query.trim();

  if (items.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-ink-mute">
          {typed
            ? `Nothing matches “${typed}”. Check the spelling, add it under Menu, or put it on this bill only.`
            : 'Nothing to show here.'}
        </p>
        <button type="button" className="btn-primary btn-lg mt-3" onClick={() => onQuickAdd(typed)}>
          {typed ? `Quick add “${typed}”` : 'Quick add an item'}
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {items.map((i) => (
        <button
          key={i.id}
          onClick={() => onTap(i)}
          disabled={!i.available}
          className={`flex min-h-[84px] flex-col justify-between rounded border p-2 text-left sm:min-h-[76px] ${
            i.available
              ? 'border-counter-line bg-white hover:border-primary hover:bg-primary-light active:bg-primary-light'
              : 'border-dashed border-counter-line bg-counter-deep/40 text-ink-mute'
          }`}
        >
          <span className="flex items-start gap-1.5">
            <span className="pt-0.5">
              <VegDot isVeg={i.isVeg} />
            </span>
            <span className="line-clamp-3 text-sm font-medium leading-tight">{i.name}</span>
          </span>
          <span className="mt-1 flex items-baseline justify-between gap-1">
            <span className="num text-sm font-semibold">
              {i.variants.length ? `${money(i.variants[0].price)}+` : money(i.price)}
            </span>
            {!i.available && <span className="text-[10px] uppercase">Out of stock</span>}
          </span>
        </button>
      ))}
    </div>
  );
});

/* ==========================================================================
   Billing screen
   ========================================================================== */

export function BillingScreen({
  items, categories, settings, printProfile, cashierName, isAdmin,
  maxDiscountPct, maxDiscountAmt, resumed,
}: {
  items: MenuItemView[];
  categories: { id: string; name: string }[];
  settings: PublicSettings;
  printProfile: PrintProfile;
  cashierName: string;
  isAdmin: boolean;
  maxDiscountPct: number;
  maxDiscountAmt: number;
  resumed: ResumedOrder | null;
}) {
  const router = useRouter();
  const money = useMemo(() => makeFormatter(settings.currency, settings.locale), [settings]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /* ---------------- cart + order state ---------------- */
  const [cart, setCart] = useState<CartRow[]>([]);
  const [orderType, setOrderType] = useState<OrderType>(resumed?.orderType ?? 'DINEIN');
  const [tableNo, setTableNo] = useState(resumed?.tableNo ?? '');
  const [customerName, setCustomerName] = useState(resumed?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(resumed?.customerPhone ?? '');
  const [address, setAddress] = useState(resumed?.address ?? '');
  const [instructions, setInstructions] = useState(resumed?.instructions ?? '');
  const [packagingCharge, setPackagingCharge] = useState(
    resumed?.packagingCharge ?? settings.defaultPackagingChg,
  );
  const [deliveryCharge, setDeliveryCharge] = useState(
    resumed?.deliveryCharge ?? settings.defaultDeliveryChg,
  );

  const [discountMode, setDiscountMode] = useState<DiscountMode>('NONE');
  const [discountValue, setDiscountValue] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [discountReason, setDiscountReason] = useState('');

  const [splitMode, setSplitMode] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [split, setSplit] = useState<Record<PaymentMethod, string>>({
    CASH: '', UPI: '', CARD: '', ONLINE: '', OTHER: '',
  });
  const [markUnpaid, setMarkUnpaid] = useState(false);
  const [cashTendered, setCashTendered] = useState('');

  /* ---------------- ui state ---------------- */
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<MenuItemView | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{
    tone: 'ok' | 'warn' | 'error';
    text: string;
    /** Optional follow-up, e.g. reopening the slip that was just printed. */
    link?: { href: string; label: string };
  } | null>(null);
  const [mobilePane, setMobilePane] = useState<'menu' | 'cart'>('menu');
  /** null = closed; a string opens the quick-add sheet with the name prefilled. */
  const [quickAddSeed, setQuickAddSeed] = useState<string | null>(null);
  /**
   * The moment this bill is for, when it is not now. Held as a Date so the slip,
   * the payload and the label cannot drift apart on a timezone.
   */
  const [billedAt, setBilledAt] = useState<Date | null>(null);
  const [billTimeOpen, setBillTimeOpen] = useState(false);
  const [localSlip, setLocalSlip] = useState<ReceiptData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ---------------- restore a resumed hold or a local draft ---------------- */
  useEffect(() => {
    if (resumed) {
      setCart(
        resumed.lines.flatMap((l) => {
          if (l.custom) {
            return [{
              key: uuid(),
              itemId: '',
              isCustom: true,
              name: l.custom.name,
              variantId: null,
              variantName: null,
              unitPrice: l.custom.unitPrice,
              taxPct: l.custom.taxPct,
              isVeg: l.custom.isVeg,
              qty: l.qty,
              addOns: [],
              instructions: l.instructions,
              discountKind: null,
              discountValue: 0,
              isComplimentary: false,
            }];
          }
          const item = l.menuItemId ? itemById.get(l.menuItemId) : undefined;
          if (!item) return [];
          const variant = item.variants.find((v) => v.id === l.variantId);
          return [{
            key: uuid(),
            itemId: item.id,
            name: item.name,
            variantId: variant?.id ?? null,
            variantName: variant?.name ?? null,
            unitPrice: variant?.price ?? item.price,
            taxPct: item.taxPct,
            isVeg: item.isVeg,
            qty: l.qty,
            addOns: l.addOns.map((a) => {
              const known = item.addOns.find((x) => x.name === a.name);
              return { id: known?.id ?? a.name, name: a.name, price: known?.price ?? a.price };
            }),
            instructions: l.instructions,
            discountKind: null,
            discountValue: 0,
            isComplimentary: false,
          }];
        }),
      );
      if (resumed.mode === 'repeat') {
        // Said plainly, because the difference is money: this will be a second
        // bill, not an edit of the first.
        setBanner({
          tone: 'warn',
          text: `Items copied from ${resumed.billNo ?? `order ${resumed.orderNo}`}. Saving makes a new bill — the original is unchanged.`,
        });
      }
      return;
    }

    // Autosaved draft: a tablet that ran out of battery mid-order should come
    // back with the cart intact.
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { cart: CartRow[]; orderType: OrderType; tableNo: string; savedAt: string };
      const ageHours = (Date.now() - new Date(draft.savedAt).getTime()) / 3_600_000;
      if (!draft.cart?.length || ageHours > 12) {
        window.localStorage.removeItem(DRAFT_KEY);
        return;
      }
      setCart(draft.cart);
      setOrderType(draft.orderType);
      setTableNo(draft.tableNo ?? '');
      setBanner({ tone: 'warn', text: 'Unsaved cart from this device restored. Clear it if it is not needed.' });
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- autosave the cart ----------------
     Debounced, because localStorage is synchronous: serialising the whole cart
     on every keystroke of a kitchen note put a JSON.stringify plus a disk write
     between the key press and the character appearing. Half a second of lag on
     a crash is a fair trade for a text field that keeps up. */
  useEffect(() => {
    if (resumed) return;
    const id = window.setTimeout(() => {
      try {
        if (cart.length === 0) window.localStorage.removeItem(DRAFT_KEY);
        else
          window.localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({ cart, orderType, tableNo, savedAt: new Date().toISOString() }),
          );
      } catch {
        /* private browsing — the cart simply is not restorable */
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [cart, orderType, tableNo, resumed]);

  /* ---------------- charges follow the order type ---------------- */
  useEffect(() => {
    if (orderType === 'DINEIN') {
      setPackagingCharge(0);
      setDeliveryCharge(0);
    } else if (orderType === 'TAKEAWAY') {
      setPackagingCharge((c) => (c > 0 ? c : settings.defaultPackagingChg));
      setDeliveryCharge(0);
    } else {
      setPackagingCharge((c) => (c > 0 ? c : settings.defaultPackagingChg));
      setDeliveryCharge((c) => (c > 0 ? c : settings.defaultDeliveryChg));
    }
  }, [orderType, settings.defaultPackagingChg, settings.defaultDeliveryChg]);

  /* ---------------- live totals: the same engine the server uses ---------- */
  const pricingLines: PricingLineInput[] = useMemo(
    () =>
      cart.map((r) => ({
        key: r.key,
        menuItemId: r.itemId,
        variantId: r.variantId,
        name: r.name,
        variantName: r.variantName,
        unitPrice: r.unitPrice,
        qty: r.qty,
        taxPct: r.taxPct,
        isVeg: r.isVeg,
        addOns: r.addOns,
        discountKind: r.discountKind,
        discountValue: r.discountValue,
        isComplimentary: r.isComplimentary,
        instructions: r.instructions,
      })),
    [cart],
  );

  const orderDiscount = useMemo(() => {
    if (discountMode === 'NONE') return null;
    if (discountMode === 'COUPON') {
      // A coupon's value is resolved by the server against the stored coupon,
      // so the preview shows no reduction until the bill is saved.
      return null;
    }
    const value = discountMode === 'PERCENT' ? Number(discountValue) || 0 : parseAmount(discountValue);
    if (value <= 0) return null;
    return { kind: discountMode, value };
  }, [discountMode, discountValue]);

  const totals = useMemo(
    () =>
      computeOrder({
        lines: pricingLines,
        packagingCharge: orderType === 'DINEIN' ? 0 : packagingCharge,
        deliveryCharge: orderType === 'DELIVERY' ? deliveryCharge : 0,
        orderDiscount,
        roundOffTotals: settings.roundOffTotals,
      }),
    [pricingLines, orderType, packagingCharge, deliveryCharge, orderDiscount, settings.roundOffTotals],
  );

  /* ---------------- discount ceiling ---------------- */
  const discountBlocked = useMemo(() => {
    if (isAdmin || !orderDiscount) return null;
    if (orderDiscount.kind === 'PERCENT' && orderDiscount.value > maxDiscountPct) {
      return `You can give up to ${maxDiscountPct}%.`;
    }
    if (orderDiscount.kind === 'FIXED' && orderDiscount.value > maxDiscountAmt) {
      return `You can give up to ${money(maxDiscountAmt)}.`;
    }
    return null;
  }, [orderDiscount, isAdmin, maxDiscountPct, maxDiscountAmt, money]);

  /* ---------------- payments ---------------- */
  const payments = useMemo(() => {
    if (markUnpaid) return [] as { method: PaymentMethod; amount: number }[];
    if (!splitMode) return [{ method, amount: totals.grandTotal }];
    return PAYMENT_METHODS.map((m) => ({ method: m, amount: parseAmount(split[m]) })).filter(
      (p) => p.amount > 0,
    );
  }, [markUnpaid, splitMode, method, split, totals.grandTotal]);

  const paidTotal = payments.reduce((a, p) => a + p.amount, 0);
  const splitShort = splitMode && !markUnpaid ? totals.grandTotal - paidTotal : 0;
  const changeDue = !splitMode && method === 'CASH' && cashTendered
    ? parseAmount(cashTendered) - totals.grandTotal
    : 0;

  /** The chosen bill time, read back in the restaurant's timezone. */
  const formatBillTime = (d: Date) =>
    new Intl.DateTimeFormat(settings.locale, {
      timeZone: settings.timeZone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);

  /* ---------------- cart operations ---------------- */
  const addItem = useCallback((item: MenuItemView, variantId: string | null, addOns: MenuItemView['addOns']) => {
    const variant = item.variants.find((v) => v.id === variantId) ?? null;
    setCart((prev) => {
      // Same item, same variant, same add-ons, no note: just bump the quantity.
      const signature = `${item.id}|${variant?.id ?? ''}|${addOns.map((a) => a.id).sort().join(',')}`;
      const existing = prev.find(
        (r) =>
          `${r.itemId}|${r.variantId ?? ''}|${r.addOns.map((a) => a.id).sort().join(',')}` === signature &&
          !r.instructions && !r.discountKind && !r.isComplimentary,
      );
      if (existing) {
        return prev.map((r) => (r.key === existing.key ? { ...r, qty: r.qty + 1 } : r));
      }
      return [
        ...prev,
        {
          key: uuid(),
          itemId: item.id,
          name: item.name,
          variantId: variant?.id ?? null,
          variantName: variant?.name ?? null,
          unitPrice: variant?.price ?? item.price,
          taxPct: item.taxPct,
          isVeg: item.isVeg,
          qty: 1,
          addOns,
          instructions: '',
          discountKind: null,
          discountValue: 0,
          isComplimentary: false,
        },
      ];
    });
  }, []);

  // Stable identity, so the memoised item grid does not re-render every time a
  // character is typed into a field on the cart side of the screen.
  const tapItem = useCallback(
    (item: MenuItemView) => {
      if (!item.available) return;
      if (item.variants.length > 0 || item.addOns.length > 0) setOptionsFor(item);
      else addItem(item, null, []);
    },
    [addItem],
  );

  const openQuickAdd = useCallback((seed: string) => setQuickAddSeed(seed), []);

  /**
   * Puts an item on this bill that is not on the menu.
   *
   * Rows are never merged the way menu taps are: two quick-adds with the same
   * name are two deliberate acts, and silently folding them together would hide
   * one of them from the cashier who typed it.
   */
  const addCustomItem = useCallback(
    (row: { name: string; unitPrice: number; taxPct: number; isVeg: boolean; qty: number }) => {
      setCart((prev) => [
        ...prev,
        {
          key: uuid(),
          itemId: '',
          isCustom: true,
          name: row.name,
          variantId: null,
          variantName: null,
          unitPrice: row.unitPrice,
          taxPct: row.taxPct,
          isVeg: row.isVeg,
          qty: row.qty,
          addOns: [],
          instructions: '',
          discountKind: null,
          discountValue: 0,
          isComplimentary: false,
        },
      ]);
    },
    [],
  );

  const setQty = (key: string, qty: number) =>
    setCart((prev) =>
      qty <= 0 ? prev.filter((r) => r.key !== key) : prev.map((r) => (r.key === key ? { ...r, qty } : r)),
    );

  const patchRow = (key: string, patch: Partial<CartRow>) =>
    setCart((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /**
   * Empties the cart and every field for the next customer.
   *
   * Deliberately silent: this runs the instant a bill is saved, when there is
   * nothing to confirm — the sale is already recorded. It also leaves the banner
   * alone, so the "Saved INV-…" message and its link to the slip survive.
   */
  const resetForNextBill = () => {
    setCart([]);
    setTableNo('');
    setCustomerName('');
    setCustomerPhone('');
    setAddress('');
    setInstructions('');
    setDiscountMode('NONE');
    setDiscountValue('');
    setCouponCode('');
    setDiscountReason('');
    setSplit({ CASH: '', UPI: '', CARD: '', ONLINE: '', OTHER: '' });
    setCashTendered('');
    setMarkUnpaid(false);
    setSplitMode(false);
    setExpandedRow(null);
    setBilledAt(null);
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  /** The Clear button: throwing away work the cashier has not billed yet. */
  const clearAll = () => {
    if (cart.length && !window.confirm('Clear this cart?')) return;
    resetForNextBill();
    setBanner(null);
  };

  /* ---------------- filtering ---------------- */
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (activeCategory !== 'ALL' && i.categoryId !== activeCategory) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.code.toLowerCase().includes(q) ||
        i.categoryName.toLowerCase().includes(q)
      );
    });
  }, [items, activeCategory, query]);

  /* ---------------- keyboard: counters run on keyboards ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F2') {
        e.preventDefault();
        void save('COMPLETED', true);
      }
      if (e.key === 'Escape') {
        setOptionsFor(null);
        setExpandedRow(null);
      }
      // Enter on the search box with exactly one match adds that item.
      if (e.key === 'Enter' && document.activeElement === searchRef.current && visibleItems.length === 1) {
        e.preventDefault();
        tapItem(visibleItems[0]);
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, totals.grandTotal, payments, cart]);

  /* ---------------- printing ---------------- */

  /**
   * Popup blockers only allow window.open during a user gesture, so the window
   * is opened empty on the click and pointed at the print route once the order
   * has an id.
   */
  const openPrintWindow = () => {
    try {
      return window.open('', '_blank', 'width=420,height=700');
    } catch {
      return null;
    }
  };

  const localReceipt = (billNo: string, orderNo = billNo, tableForBill?: string): ReceiptData => {
    // The slip prints the time the bill is *for*, which is what the server stores.
    const now = billedAt ?? new Date();
    const taxMap = new Map<number, { taxable: number; amount: number }>();
    for (const l of totals.lines) {
      const cur = taxMap.get(l.taxPct) ?? { taxable: 0, amount: 0 };
      cur.taxable += l.taxableAmount;
      cur.amount += l.taxAmount;
      taxMap.set(l.taxPct, cur);
    }
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(settings.locale, { timeZone: settings.timeZone, ...opts }).format(now);

    return {
      kind: 'BILL',
      width: (settings.receiptWidth === 58 ? 58 : 80) as 58 | 80,
      restaurant: {
        name: printProfile.name,
        logoDataUrl: printProfile.logoDataUrl,
        addressLines: printProfile.addressLines,
        phone: printProfile.phone,
        email: printProfile.email,
        gstNumber: printProfile.gstNumber,
        fssaiNumber: printProfile.fssaiNumber,
        footer: printProfile.footer,
      },
      currency: settings.currency,
      billNo,
      orderNo,
      date: fmt({ day: '2-digit', month: 'short', year: 'numeric' }),
      time: fmt({ hour: '2-digit', minute: '2-digit', hour12: true }),
      orderType: ORDER_TYPE_LABEL[orderType],
      tableNo: orderType === 'DINEIN' ? tableForBill || tableNo || DEFAULT_TABLE : null,
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      address: orderType === 'DELIVERY' ? address || null : null,
      cashier: cashierName,
      instructions,
      lines: totals.lines.map((l) => ({
        name: l.name,
        variant: l.variantName ?? null,
        qty: l.qty,
        unitPrice: l.unitPrice,
        amount: l.lineSubtotal - l.discount - l.allocatedOrderDiscount,
        addOns: (l.addOns ?? []).map((a) => ({ name: a.name, price: a.price })),
        instructions: l.instructions ?? '',
        isVeg: l.isVeg ?? true,
        isComplimentary: l.isComplimentary ?? false,
        prepArea: null,
      })),
      itemsSubtotal: totals.itemsSubtotal,
      discountTotal: totals.discountTotal,
      discountLabel:
        discountMode === 'PERCENT' ? `Discount (${discountValue}%)` : 'Discount',
      packagingCharge: totals.packagingCharge,
      deliveryCharge: totals.deliveryCharge,
      taxBreakup: [...taxMap.entries()]
        .filter(([pct, v]) => pct > 0 && v.amount > 0)
        .map(([pct, v]) => ({ pct, taxable: v.taxable, amount: v.amount }))
        .sort((a, b) => a.pct - b.pct),
      taxTotal: totals.taxTotal,
      splitTax: printProfile.splitTax,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      payments: payments.map((p) => ({
        label: PAYMENT_METHOD_LABEL[p.method],
        amount: p.amount,
        reference: null,
      })),
      paymentStatus: paidTotal <= 0 ? 'UNPAID' : paidTotal >= totals.grandTotal ? 'PAID' : 'PARTIAL',
      paidTotal,
      balanceDue: Math.max(0, totals.grandTotal - paidTotal),
      refundedTotal: 0,
      status: 'NEW',
      isReprint: false,
    };
  };

  /* ---------------- send the bill to a customer on WhatsApp ----------------
     The slip is rendered off-screen from the cart that was just saved, turned
     into the same one-page PDF the toolbar produces, and handed to the OS share
     sheet — where WhatsApp is one of the targets, so the cashier picks the
     contact and sends. No printer, no second screen.

     On a desktop, where no share sheet exists, the PDF is saved and the chat is
     opened for the cashier to attach it: a wa.me link carries text and nothing
     else, so there is no way to attach a file from a URL. */
  const shareSlipRef = useRef<HTMLDivElement>(null);
  const [shareSlip, setShareSlip] = useState<ReceiptData | null>(null);

  useEffect(() => {
    if (!shareSlip) return;
    let cancelled = false;

    const run = async () => {
      // A timer, not requestAnimationFrame: rAF stops firing the moment the page
      // is hidden, so a cashier who taps this and glances at another app would
      // leave the share stuck forever with nothing on screen to say so. A timer
      // still fires. (The height is read with getBoundingClientRect, which
      // forces layout synchronously, so one tick is enough.)
      await new Promise((r) => window.setTimeout(r, 60));
      if (cancelled) return;

      const node = shareSlipRef.current?.querySelector<HTMLElement>('.receipt');
      if (!node) {
        setBanner({
          tone: 'warn',
          text: 'The bill was saved, but its PDF could not be prepared. Open it from Orders → Share.',
        });
        setShareSlip(null);
        return;
      }

      const fileName = `Bill-${shareSlip.billNo ?? shareSlip.orderNo}`;
      const digits = (shareSlip.customerPhone ?? '').replace(/\D/g, '');
      const to = digits.length === 10 ? `91${digits}` : digits;

      /**
       * A WhatsApp link needs a number or a message — `https://wa.me/` on its own
       * is rejected with "this link could not be opened". With `?text=` and no
       * number, WhatsApp opens on its contact list and sends the message to
       * whoever is picked, which is what a walk-in customer needs.
       *
       * The message is the whole itemised bill, not a summary: on a device that
       * cannot attach the PDF this text *is* the bill the customer keeps.
       */
      const chatUrl = `https://wa.me/${to}?text=${encodeURIComponent(receiptToText(shareSlip))}`;

      try {
        if (canShareFiles('application/pdf')) {
          // Some platforms never settle navigator.share — the sheet is dismissed
          // by the window manager rather than by the page. Without this race the
          // off-screen slip would stay mounted and the cashier would be left
          // watching a screen that says nothing.
          await Promise.race([
            shareSlipPdf(node, shareSlip.width, fileName, fileName),
            new Promise((r) => window.setTimeout(r, 45_000)),
          ]);
          if (!cancelled) setBanner({ tone: 'ok', text: `${fileName} sent to WhatsApp.` });
        } else {
          // This device cannot hand a file to another app, so the itemised bill
          // goes as text and the PDF is saved for attaching by hand.
          await downloadSlipPdf(node, shareSlip.width, fileName);
          window.open(chatUrl, '_blank', 'noopener');
          if (!cancelled) {
            setBanner({
              tone: 'warn',
              // The usual reason a phone lands here is the app being served over
              // plain http, where browsers switch the share API off entirely.
              // Saying so beats letting the cashier think the feature is broken.
              text: window.isSecureContext
                ? `Bill sent as text. ${fileName}.pdf is saved on this device — attach it in the chat with 📎.`
                : `Bill sent as text. This device is on an http:// address, where browsers block apps from attaching files — open the app over https to send the PDF itself. ${fileName}.pdf is saved meanwhile.`,
            });
          }
        }
      } catch (err) {
        // A cancelled share sheet is the cashier changing their mind.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!cancelled) {
          setBanner({
            tone: 'warn',
            text: 'The bill was saved, but the PDF could not be shared. Open it from Orders → Share.',
          });
        }
      } finally {
        if (!cancelled) setShareSlip(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareSlip]);

  /* ---------------- save ---------------- */

  async function save(
    status: 'COMPLETED' | 'NEW' | 'HELD',
    printBill: boolean,
    printKot = false,
    /** Share the saved bill as a PDF on WhatsApp once it has an id. */
    sendWhatsApp = false,
  ) {
    if (saving) return;
    if (cart.length === 0) {
      setBanner({ tone: 'error', text: 'Add at least one item before saving.' });
      return;
    }
    // Table number, customer name and phone are all optional. A queue of people
    // waiting to pay must never be held up by a field, so a dine-in bill with no
    // table entered is saved against DEFAULT_TABLE rather than refused. The one
    // field still required is a delivery address, because a delivery with nowhere
    // to go is not a bill anyone can act on.
    if (orderType === 'DELIVERY' && !address.trim() && status !== 'HELD') {
      setBanner({ tone: 'error', text: 'A delivery order needs an address.' });
      return;
    }
    if (discountBlocked) {
      setBanner({ tone: 'error', text: discountBlocked });
      return;
    }
    if (splitMode && !markUnpaid && splitShort !== 0 && status === 'COMPLETED') {
      setBanner({
        tone: 'error',
        text:
          splitShort > 0
            ? `Split payments are short by ${money(splitShort)}.`
            : `Split payments exceed the bill by ${money(-splitShort)}.`,
      });
      return;
    }

    // Whatever the cashier typed, or the stand-in — resolved once so the payload,
    // the printed slip and the shared PDF cannot disagree.
    const billTable =
      orderType === 'DINEIN' ? tableNo.trim() || DEFAULT_TABLE : '';

    const idempotencyKey = uuid();
    const payload = {
      idempotencyKey,
      orderType,
      status,
      tableNo: billTable || undefined,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      address: orderType === 'DELIVERY' ? address.trim() : undefined,
      instructions: instructions.trim(),
      lines: cart.map((r) => ({
        key: r.key,
        menuItemId: r.isCustom ? null : r.itemId,
        // The only line whose price the server takes from this payload.
        custom: r.isCustom
          ? { name: r.name, unitPrice: r.unitPrice, taxPct: r.taxPct, isVeg: r.isVeg }
          : null,
        variantId: r.isCustom ? null : r.variantId,
        qty: r.qty,
        addOns: r.isCustom ? [] : r.addOns.map((a) => ({ id: a.id, name: a.name, price: a.price })),
        discountKind: r.discountKind,
        discountValue: r.discountValue,
        isComplimentary: r.isComplimentary,
        instructions: r.instructions,
      })),
      packagingCharge: orderType === 'DINEIN' ? 0 : packagingCharge,
      deliveryCharge: orderType === 'DELIVERY' ? deliveryCharge : 0,
      orderDiscount:
        discountMode === 'NONE'
          ? null
          : discountMode === 'COUPON'
            ? { kind: 'COUPON' as const, value: 0, code: couponCode.trim().toUpperCase(), reason: discountReason.trim() }
            : {
                kind: discountMode,
                value: discountMode === 'PERCENT' ? Number(discountValue) || 0 : parseAmount(discountValue),
                reason: discountReason.trim(),
              },
      payments: status === 'HELD' ? [] : payments,
      // Only sent when the admin actually changed it; the server rejects it for
      // anyone else and bounds how far back it may go.
      billedAt: billedAt ? billedAt.toISOString() : undefined,
      saveCustomer: Boolean(customerPhone.trim()) && orderType !== 'DINEIN',
      // A repeat is a brand-new sale: only a resumed hold is replaced.
      replacesOrderId: resumed?.mode === 'resume' ? resumed.id : null,
    };

    // Open the print window on the gesture, before any awaiting.
    const printWin = printBill && !isOffline() ? openPrintWindow() : null;

    setSaving(true);
    setBanner(null);

    // ---- offline path ----
    if (isOffline()) {
      try {
        await queueOrder({
          ...payload,
          offlineCreatedAt: new Date().toISOString(),
        } as CreateOrderInput);
        window.dispatchEvent(new Event('restropos:queued'));
        const ref = `OFF-${Date.now().toString(36).toUpperCase()}`;
        if (printBill) setLocalSlip(localReceipt(ref, ref, billTable));
        // Built from the cart before the reset empties it. The PDF itself needs
        // no network — only sending it does.
        if (sendWhatsApp) setShareSlip(localReceipt(ref, ref, billTable));
        setBanner({
          tone: 'warn',
          text: `Saved on this device as ${ref}. It will be sent to the server automatically.`,
        });
        resetForNextBill();
      } catch {
        setBanner({
          tone: 'error',
          text: 'This device could not store the bill. Write it down before continuing.',
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    // ---- online path ----
    try {
      const res = await post<{ id: string; orderNo: string; billNo: string | null; duplicate: boolean }>(
        '/api/orders',
        payload,
      );

      if (printKot) {
        try {
          const kot = await post<{ batch: number; newItems: number }>(`/api/orders/${res.id}/kot`, {});
          if (kot.batch > 0) {
            window.open(
              `/print/kot/${res.id}?batch=${kot.batch}&auto=1&close=1`,
              '_blank',
              'width=420,height=700',
            );
          }
        } catch {
          setBanner({ tone: 'warn', text: 'Bill saved, but the kitchen ticket did not print. Print it from Orders.' });
        }
      }

      if (printWin) {
        printWin.location.href = `/print/bill/${res.id}?auto=1&close=1`;
      } else if (printBill) {
        window.open(`/print/bill/${res.id}?auto=1&close=1`, '_blank', 'width=420,height=700');
      }

      if (sendWhatsApp) setShareSlip(localReceipt(res.billNo ?? res.orderNo, res.orderNo, billTable));

      setBanner({
        tone: 'ok',
        text:
          status === 'HELD'
            ? `Held as order ${res.orderNo}.`
            : `Saved ${res.billNo ?? res.orderNo} · ${money(totals.grandTotal)}`,
        // The print window closes itself, so this is the way back to the slip
        // when the cashier needs a copy as a file rather than on paper.
        link:
          status === 'HELD'
            ? undefined
            : { href: `/print/bill/${res.id}`, label: 'Open slip to save or send' },
      });
      resetForNextBill();
      if (resumed) router.replace('/billing');
      router.refresh();
    } catch (err) {
      printWin?.close();
      if (err instanceof ApiError) {
        setBanner({ tone: 'error', text: err.message });
      } else {
        // The request failed for a reason we cannot see — treat it as offline
        // rather than losing the bill.
        await queueOrder({
          ...payload,
          offlineCreatedAt: new Date().toISOString(),
        } as CreateOrderInput);
        window.dispatchEvent(new Event('restropos:queued'));
        setBanner({
          tone: 'warn',
          text: 'The server did not respond. The bill is stored on this device and will sync.',
        });
        resetForNextBill();
      }
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- customer lookup ---------------- */
  const [customerHits, setCustomerHits] = useState<
    { id: string; name: string; phone: string; addressLine: string; totalOrders: number }[]
  >([]);

  useEffect(() => {
    const phone = customerPhone.trim();
    if (phone.length < 4 || orderType === 'DINEIN') {
      setCustomerHits([]);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?phone=${encodeURIComponent(phone)}`);
        const body = await res.json();
        setCustomerHits(body?.data ?? []);
      } catch {
        setCustomerHits([]);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [customerPhone, orderType]);

  /* ======================================================================
     Render
     ====================================================================== */

  const bannerTone =
    banner?.tone === 'ok'
      ? 'border-veg/40 bg-green-50 text-veg'
      : banner?.tone === 'warn'
        ? 'border-marigold/40 bg-marigold-light text-marigold'
        : 'border-nonveg/40 bg-red-50 text-nonveg';

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- categories ---------------- */}
      <aside className="hidden w-36 shrink-0 flex-col gap-1 overflow-y-auto border-r border-counter-line bg-white p-2 lg:flex">
        {[{ id: 'ALL', name: 'All items' }, ...categories].map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            className={`rounded px-2 py-3 text-left text-sm font-medium leading-tight ${
              activeCategory === c.id ? 'bg-primary text-white' : 'text-ink-soft hover:bg-counter-deep'
            }`}
          >
            {c.name}
          </button>
        ))}
      </aside>

      {/* ---------------- item grid ---------------- */}
      <section
        className={`flex min-w-0 min-h-0 flex-1 flex-col ${mobilePane === 'cart' ? 'hidden md:flex' : 'flex'}`}
      >
        {/* Search owns its own line on a phone; the category picker and quick add
            share the next one. Squeezing all three onto one row leaves a search
            field too narrow to read a dish name in. */}
        <div className="shrink-0 space-y-2 border-b border-counter-line bg-white p-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
          <input
            ref={searchRef}
            className="field min-h-[44px] w-full sm:flex-1"
            placeholder="Search item or code   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputMode="search"
            enterKeyHint="search"
          />
          <div className="flex gap-2">
            <select
              className="field min-h-[44px] flex-1 sm:w-36 sm:flex-none lg:hidden"
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
              aria-label="Category"
            >
              <option value="ALL">All items</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {/* Whatever the cashier typed becomes the item name, so searching for
                something that is not on the menu is already half of adding it. */}
            <button
              type="button"
              className="btn min-h-[44px] shrink-0"
              onClick={() => setQuickAddSeed(query.trim())}
              title="Add an item to this bill only, without putting it on the menu"
            >
              + Quick add
            </button>
          </div>
        </div>

        {/* The extra bottom padding on phones clears the fixed Menu/Cart bar. */}
        <div className="pb-bottom-bar min-h-0 flex-1 overflow-y-auto p-2">
          <MenuGrid
            items={visibleItems}
            query={query}
            money={money}
            onTap={tapItem}
            onQuickAdd={openQuickAdd}
          />
        </div>
      </section>

      {/* ---------------- cart / checkout ---------------- */}
      <aside
        className={`mb-bottom-bar flex min-h-0 w-full shrink-0 flex-col border-l border-counter-line bg-white md:w-[380px] xl:w-[420px] ${
          mobilePane === 'menu' ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* order type */}
        <div className="shrink-0 border-b border-counter-line p-2">
          <Segmented
            value={orderType}
            onChange={setOrderType}
            options={[
              { value: 'DINEIN', label: 'Dine-in' },
              { value: 'TAKEAWAY', label: 'Takeaway' },
              { value: 'DELIVERY', label: 'Delivery' },
            ]}
          />

          {/* Only the fields this order type actually needs. */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {orderType === 'DINEIN' && (
              <input
                className="field col-span-2"
                placeholder={`Table number (optional — ${DEFAULT_TABLE})`}
                value={tableNo}
                onChange={(e) => setTableNo(e.target.value)}
              />
            )}
            {orderType !== 'DINEIN' && (
              <>
                <input
                  className="field"
                  placeholder="Customer name (optional)"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
                <input
                  className="field"
                  placeholder="Phone (optional)"
                  inputMode="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </>
            )}
            {orderType === 'DELIVERY' && (
              <textarea
                className="field col-span-2 resize-none"
                rows={2}
                placeholder="Delivery address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            )}
          </div>

          {customerHits.length > 0 && (
            <div className="mt-1 rounded border border-counter-line">
              {customerHits.map((c) => (
                <button
                  key={c.id}
                  className="block w-full px-2 py-1.5 text-left text-xs hover:bg-counter-deep"
                  onClick={() => {
                    setCustomerName(c.name);
                    setCustomerPhone(c.phone);
                    if (c.addressLine) setAddress(c.addressLine);
                    setCustomerHits([]);
                  }}
                >
                  <span className="font-medium">{c.name}</span> · {c.phone}
                  <span className="text-ink-mute"> · {c.totalOrders} orders</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* cart lines */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-mute">
              Tap items on the left to start a bill.
            </p>
          ) : (
            <ul className="divide-y divide-counter-line">
              {totals.lines.map((line) => {
                const row = cart.find((r) => r.key === line.key)!;
                const open = expandedRow === row.key;
                return (
                  <li key={row.key} className="px-2 py-1.5">
                    <div className="flex items-start gap-2">
                      <button
                        className="flex flex-1 items-start gap-1.5 text-left"
                        onClick={() => setExpandedRow(open ? null : row.key)}
                        aria-expanded={open}
                      >
                        <span className="pt-1">
                          <VegDot isVeg={row.isVeg} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">
                            {row.name}
                            {row.variantName && (
                              <span className="text-ink-mute"> · {row.variantName}</span>
                            )}
                            {/* Says out loud that this line came from the counter
                                and not from the menu. */}
                            {row.isCustom && (
                              <span className="chip ml-1 bg-counter-deep text-ink-soft">
                                Quick add
                              </span>
                            )}
                          </span>
                          <span className="num block text-xs text-ink-mute">
                            {money(row.unitPrice + row.addOns.reduce((a, x) => a + x.price, 0))} each
                            {row.taxPct > 0 && ` · ${row.taxPct}% tax`}
                          </span>
                          {row.addOns.map((a) => (
                            <span key={a.id} className="block text-xs text-ink-mute">
                              + {a.name}
                            </span>
                          ))}
                          {row.instructions && (
                            <span className="block text-xs text-marigold">* {row.instructions}</span>
                          )}
                          {row.isComplimentary && (
                            <span className="chip mt-0.5 bg-marigold-light text-marigold">Complimentary</span>
                          )}
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          className="btn h-9 w-9 p-0 text-lg leading-none"
                          onClick={() => setQty(row.key, row.qty - 1)}
                          aria-label={`One less ${row.name}`}
                        >
                          −
                        </button>
                        <span className="num w-7 text-center text-sm font-semibold">{row.qty}</span>
                        <button
                          className="btn h-9 w-9 p-0 text-lg leading-none"
                          onClick={() => setQty(row.key, row.qty + 1)}
                          aria-label={`One more ${row.name}`}
                        >
                          +
                        </button>
                        <span className="num w-20 text-right text-sm font-semibold">
                          {money(line.lineSubtotal - line.discount)}
                        </span>
                      </div>
                    </div>

                    {open && (
                      <div className="mt-2 space-y-2 rounded bg-counter p-2">
                        <input
                          className="field"
                          placeholder="Note for the kitchen (less spicy, no onion…)"
                          value={row.instructions}
                          onChange={(e) => patchRow(row.key, { instructions: e.target.value })}
                        />

                        {/* A hand-typed name and price are the two things on a
                            bill most likely to hold a typo, and the cashier who
                            made it is standing right here. Committed on blur
                            rather than per keystroke so the money formatter does
                            not fight what is being typed. */}
                        {row.isCustom && (
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="label">Name</span>
                              <input
                                className="field"
                                defaultValue={row.name}
                                maxLength={60}
                                onBlur={(e) =>
                                  patchRow(row.key, { name: e.target.value.trim() || row.name })
                                }
                              />
                            </label>
                            <label className="block">
                              <span className="label">Price each</span>
                              <input
                                className="field num"
                                inputMode="decimal"
                                defaultValue={plain(row.unitPrice)}
                                onBlur={(e) => {
                                  const value = parseAmount(e.target.value);
                                  if (value > 0) patchRow(row.key, { unitPrice: value });
                                  else e.target.value = plain(row.unitPrice);
                                }}
                              />
                            </label>
                          </div>
                        )}

                        {itemById.get(row.itemId)?.addOns.length ? (
                          <div className="flex flex-wrap gap-1">
                            {itemById.get(row.itemId)!.addOns.map((a) => {
                              const on = row.addOns.some((x) => x.id === a.id);
                              return (
                                <button
                                  key={a.id}
                                  onClick={() =>
                                    patchRow(row.key, {
                                      addOns: on
                                        ? row.addOns.filter((x) => x.id !== a.id)
                                        : [...row.addOns, a],
                                    })
                                  }
                                  className={`chip border px-2 py-1 ${
                                    on ? 'border-primary bg-primary text-white' : 'border-counter-line bg-white'
                                  }`}
                                >
                                  {a.name} {a.price > 0 && `+${plain(a.price)}`}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}

                        <div className="flex items-center gap-2">
                          <select
                            className="field w-28"
                            value={row.discountKind ?? ''}
                            onChange={(e) =>
                              patchRow(row.key, {
                                discountKind: (e.target.value || null) as CartRow['discountKind'],
                                discountValue: 0,
                              })
                            }
                          >
                            <option value="">No discount</option>
                            <option value="PERCENT">Percent</option>
                            <option value="FIXED">Amount</option>
                          </select>
                          {row.discountKind && (
                            <input
                              className="field w-24"
                              inputMode="decimal"
                              placeholder={row.discountKind === 'PERCENT' ? '%' : 'amount'}
                              onChange={(e) =>
                                patchRow(row.key, {
                                  discountValue:
                                    row.discountKind === 'PERCENT'
                                      ? Number(e.target.value) || 0
                                      : parseAmount(e.target.value),
                                })
                              }
                            />
                          )}
                          {isAdmin && (
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={row.isComplimentary}
                                onChange={(e) => patchRow(row.key, { isComplimentary: e.target.checked })}
                              />
                              Free
                            </label>
                          )}
                          <button
                            className="btn-danger ml-auto"
                            onClick={() => {
                              setQty(row.key, 0);
                              setExpandedRow(null);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* totals + payment */}
        <div className="shrink-0 border-t border-counter-line bg-counter">
          <div className="max-h-[46vh] overflow-y-auto p-2">
            {/* charges */}
            {orderType !== 'DINEIN' && (
              <div className="mb-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">Packaging</span>
                  <input
                    className="field num"
                    inputMode="decimal"
                    value={packagingCharge ? String(packagingCharge / 100) : ''}
                    onChange={(e) => setPackagingCharge(parseAmount(e.target.value))}
                  />
                </label>
                {orderType === 'DELIVERY' && (
                  <label className="block">
                    <span className="label">Delivery</span>
                    <input
                      className="field num"
                      inputMode="decimal"
                      value={deliveryCharge ? String(deliveryCharge / 100) : ''}
                      onChange={(e) => setDeliveryCharge(parseAmount(e.target.value))}
                    />
                  </label>
                )}
              </div>
            )}

            {/* discount */}
            <div className="mb-2">
              <Segmented
                size="sm"
                value={discountMode}
                onChange={(v) => {
                  setDiscountMode(v);
                  setDiscountValue('');
                }}
                options={[
                  { value: 'NONE', label: 'No disc.' },
                  { value: 'PERCENT', label: '%' },
                  { value: 'FIXED', label: 'Amount' },
                  { value: 'COUPON', label: 'Coupon' },
                ]}
              />
              {discountMode !== 'NONE' && (
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {discountMode === 'COUPON' ? (
                    <input
                      className="field uppercase"
                      placeholder="Coupon code"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                    />
                  ) : (
                    <input
                      className="field num"
                      inputMode="decimal"
                      placeholder={discountMode === 'PERCENT' ? 'Percent' : 'Amount'}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  )}
                  <input
                    className="field"
                    placeholder="Reason"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                  />
                </div>
              )}
              {discountBlocked && (
                <p className="mt-1 text-xs text-nonveg">{discountBlocked}</p>
              )}
              {discountMode === 'COUPON' && couponCode && (
                <p className="mt-1 text-xs text-ink-mute">
                  The coupon is checked and applied when the bill is saved.
                </p>
              )}
            </div>

            {/* figures */}
            <dl className="num space-y-0.5 text-sm">
              <Line label="Subtotal" value={money(totals.itemsSubtotal)} />
              {totals.discountTotal > 0 && (
                <Line label="Discount" value={`− ${money(totals.discountTotal)}`} />
              )}
              {totals.packagingCharge > 0 && (
                <Line label="Packaging" value={money(totals.packagingCharge)} />
              )}
              {totals.deliveryCharge > 0 && (
                <Line label="Delivery" value={money(totals.deliveryCharge)} />
              )}
              {totals.taxTotal > 0 && <Line label="Tax" value={money(totals.taxTotal)} />}
              {totals.roundOff !== 0 && (
                <Line label="Round off" value={money(totals.roundOff)} />
              )}
            </dl>

            <div className="mt-1 flex items-baseline justify-between border-t border-counter-line pt-1">
              <span className="text-sm font-semibold uppercase tracking-wide">Total</span>
              <span className="num text-2xl font-bold">{money(totals.grandTotal)}</span>
            </div>

            {/* payment */}
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="label mb-0">Payment</span>
                <div className="flex gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={splitMode}
                      onChange={(e) => setSplitMode(e.target.checked)}
                    />
                    Split
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={markUnpaid}
                      onChange={(e) => setMarkUnpaid(e.target.checked)}
                    />
                    Unpaid
                  </label>
                </div>
              </div>

              {!markUnpaid && !splitMode && (
                <>
                  <div className="grid grid-cols-4 gap-1">
                    {(['CASH', 'UPI', 'CARD', 'ONLINE'] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMethod(m)}
                        className={`min-h-[44px] rounded border text-sm font-medium ${
                          method === m
                            ? 'border-primary bg-primary text-white'
                            : 'border-counter-line bg-white hover:bg-counter-deep'
                        }`}
                      >
                        {PAYMENT_METHOD_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  {method === 'CASH' && (
                    <div className="flex items-center gap-2">
                      <input
                        className="field num w-28"
                        inputMode="decimal"
                        placeholder="Cash taken"
                        value={cashTendered}
                        onChange={(e) => setCashTendered(e.target.value)}
                      />
                      <span className="num text-sm">
                        {changeDue > 0 ? `Change ${money(changeDue)}` : changeDue < 0 && cashTendered ? `Short ${money(-changeDue)}` : ''}
                      </span>
                    </div>
                  )}
                </>
              )}

              {!markUnpaid && splitMode && (
                <div className="space-y-1">
                  {(['CASH', 'UPI', 'CARD', 'ONLINE'] as PaymentMethod[]).map((m) => (
                    <div key={m} className="flex items-center gap-2">
                      <span className="w-16 text-xs">{PAYMENT_METHOD_LABEL[m]}</span>
                      <input
                        className="field num flex-1"
                        inputMode="decimal"
                        value={split[m]}
                        onChange={(e) => setSplit((s) => ({ ...s, [m]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <p className={`num text-xs ${splitShort === 0 ? 'text-veg' : 'text-nonveg'}`}>
                    {splitShort === 0
                      ? 'Split matches the bill.'
                      : splitShort > 0
                        ? `Short by ${money(splitShort)}`
                        : `Over by ${money(-splitShort)}`}
                  </p>
                </div>
              )}

              <input
                className="field"
                placeholder="Note on the bill (optional)"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />

              {/* Bill time. Hidden from cashiers: re-dating a sale moves it into
                  another day's takings and another shift's cash count. */}
              {isAdmin && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`btn text-xs ${billedAt ? 'border-marigold text-marigold' : ''}`}
                    onClick={() => setBillTimeOpen(true)}
                    title="Bill this order for an earlier date and time"
                  >
                    {billedAt ? 'Bill time changed' : 'Change bill time'}
                  </button>
                  {billedAt && (
                    <>
                      <span className="num text-xs text-marigold">{formatBillTime(billedAt)}</span>
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => setBilledAt(null)}
                      >
                        use now
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {banner && (
              <p role="status" className={`mt-2 rounded border px-2 py-1.5 text-xs ${bannerTone}`}>
                {banner.text}
                {banner.link && (
                  <>
                    {' '}
                    <a
                      className="font-semibold underline"
                      href={banner.link.href}
                      target="_blank"
                      rel="noopener"
                    >
                      {banner.link.label}
                    </a>
                  </>
                )}
              </p>
            )}
          </div>

          {/* actions */}
          <div className="grid grid-cols-4 gap-1 border-t border-counter-line p-2">
            <button className="btn" onClick={clearAll} disabled={saving}>
              Clear
            </button>
            <button className="btn" onClick={() => save('HELD', false)} disabled={saving || !cart.length}>
              Hold
            </button>
            {/* Completes the sale and hands the customer their bill as a PDF —
                the phone equivalent of tearing off the slip.

                Never a kitchen ticket, whatever "print KOT on save" is set to:
                this button exists to give the customer their bill, and an outlet
                that does not run tickets should not have a KOT window opening
                over the share sheet. Orders → KOT still prints one on demand for
                anyone who wants it. */}
            <button
              className="btn"
              onClick={() => save('COMPLETED', false, false, true)}
              disabled={saving || !cart.length}
              title="Saves the bill and sends its PDF on WhatsApp — no kitchen ticket, no printer"
            >
              {saving ? 'Saving…' : 'WhatsApp bill'}
            </button>
            <button
              className="btn-primary"
              onClick={() => save('COMPLETED', true, settings.printKotOnSave)}
              disabled={saving || !cart.length}
            >
              {saving ? 'Saving…' : 'Save & print'}
            </button>
          </div>
        </div>
      </aside>

      {/* ---------------- mobile pane switch ----------------
          Pinned to the bottom edge, so both columns reserve room for it (see
          the pb-[64px] on each) and it pads itself clear of the iPhone home
          indicator. Without that padding the two buttons sit under the gesture
          bar and take two taps each. */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-20 flex border-t border-counter-line bg-white md:hidden">
        <button
          className={`min-h-[52px] flex-1 px-2 text-sm font-medium ${mobilePane === 'menu' ? 'bg-primary text-white' : ''}`}
          onClick={() => setMobilePane('menu')}
          aria-pressed={mobilePane === 'menu'}
        >
          Menu
        </button>
        <button
          className={`num min-h-[52px] flex-1 px-2 text-sm font-medium ${mobilePane === 'cart' ? 'bg-primary text-white' : ''}`}
          onClick={() => setMobilePane('cart')}
          aria-pressed={mobilePane === 'cart'}
        >
          Cart ({totals.unitCount}) · {money(totals.grandTotal)}
        </button>
      </div>

      {/* ---------------- variant / add-on sheet ---------------- */}
      {optionsFor && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
          onClick={() => setOptionsFor(null)}
        >
          <div
            className="max-h-sheet pb-safe w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-4 sm:rounded-lg sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <ItemOptions
              item={optionsFor}
              money={money}
              onCancel={() => setOptionsFor(null)}
              onAdd={(variantId, addOns) => {
                addItem(optionsFor, variantId, addOns);
                setOptionsFor(null);
              }}
            />
          </div>
        </div>
      )}

      {/* ---------------- bill date and time ---------------- */}
      {billTimeOpen && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
          onClick={() => setBillTimeOpen(false)}
        >
          <div
            className="max-h-sheet pb-safe w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-4 sm:rounded-lg sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <BillTimePicker
              current={billedAt}
              timeZone={settings.timeZone}
              onCancel={() => setBillTimeOpen(false)}
              onClear={() => {
                setBilledAt(null);
                setBillTimeOpen(false);
              }}
              onSet={(when) => {
                setBilledAt(when);
                setBillTimeOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {/* ---------------- quick add ---------------- */}
      {quickAddSeed !== null && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
          onClick={() => setQuickAddSeed(null)}
        >
          <div
            className="max-h-sheet pb-safe w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-4 sm:rounded-lg sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <QuickAdd
              seedName={quickAddSeed}
              defaultTaxPct={settings.defaultTaxPct}
              currency={settings.currency}
              money={money}
              onCancel={() => setQuickAddSeed(null)}
              onAdd={(row) => {
                addCustomItem(row);
                setQuickAddSeed(null);
                setQuery('');
                setBanner(null);
              }}
            />
          </div>
        </div>
      )}

      <LocalSlipPrinter data={localSlip} onDone={() => setLocalSlip(null)} />

      {/* Off-screen (fixed at left:-10000px) purely so the PDF exporter has a
          real, laid-out slip to photograph. Its own class, not `.local-slip`, so
          the print stylesheet can never put it on paper. */}
      {shareSlip && (
        <div className="export-slip" ref={shareSlipRef} aria-hidden>
          <Receipt data={shareSlip} />
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   Quick add
   ========================================================================== */

/**
 * An item for this bill and no other.
 *
 * Deliberately not a menu editor: there is no code, no category, no image and
 * nothing is written to the menu tables. It exists for the plate the kitchen
 * improvised and the bottle a supplier dropped off — the two things a fixed menu
 * never covers and a cashier cannot wait for an admin to add.
 */
function QuickAdd({
  seedName,
  defaultTaxPct,
  currency,
  money,
  onAdd,
  onCancel,
}: {
  seedName: string;
  defaultTaxPct: number;
  currency: string;
  money: (v: number) => string;
  onAdd: (row: {
    name: string;
    unitPrice: number;
    taxPct: number;
    isVeg: boolean;
    qty: number;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(seedName);
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [taxPct, setTaxPct] = useState(String(defaultTaxPct));
  const [isVeg, setIsVeg] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const unitPrice = parseAmount(price);
  const qtyNum = Math.max(1, Math.min(999, Math.round(Number(qty) || 1)));
  const taxNum = Math.max(0, Math.min(100, Math.round(Number(taxPct) || 0)));
  // Shown before the item is on the bill, because a hand-typed price is exactly
  // the moment a cashier wants to see what it comes to with tax.
  const lineTotal = unitPrice * qtyNum;
  const withTax = lineTotal + Math.round((lineTotal * taxNum) / 100);

  const submit = () => {
    if (!name.trim()) {
      setError('Give the item a name — it prints on the bill.');
      return;
    }
    if (unitPrice <= 0) {
      setError('Enter a price above zero.');
      return;
    }
    onAdd({ name: name.trim(), unitPrice, taxPct: taxNum, isVeg, qty: qtyNum });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="mb-1 text-base font-semibold">Quick add</h2>
      <p className="mb-3 text-xs text-ink-mute">
        Goes on this bill only. Nothing is added to the menu.
      </p>

      <label className="label" htmlFor="qa-name">
        Item name
      </label>
      <input
        id="qa-name"
        className="field mb-3"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Chef's special thali"
        maxLength={60}
        autoFocus
        autoComplete="off"
      />

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor="qa-price">
            Price ({currency})
          </label>
          <input
            id="qa-price"
            className="field num"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label" htmlFor="qa-qty">
            Qty
          </label>
          <input
            id="qa-qty"
            className="field num"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="numeric"
          />
        </div>
        <div>
          <label className="label" htmlFor="qa-tax">
            Tax %
          </label>
          <input
            id="qa-tax"
            className="field num"
            value={taxPct}
            onChange={(e) => setTaxPct(e.target.value)}
            inputMode="numeric"
          />
        </div>
      </div>

      <span className="label">Type</span>
      <div className="mb-3">
        <Segmented
          value={isVeg ? 'VEG' : 'NONVEG'}
          onChange={(v) => setIsVeg(v === 'VEG')}
          options={[
            { value: 'VEG', label: 'Veg' },
            { value: 'NONVEG', label: 'Non-veg' },
          ]}
          size="sm"
        />
      </div>

      {unitPrice > 0 && (
        <p className="num mb-3 text-xs text-ink-soft">
          {qtyNum} × {money(unitPrice)} = {money(lineTotal)}
          {taxNum > 0 && ` · ${money(withTax)} with ${taxNum}% tax`}
        </p>
      )}

      {error && <p className="mb-3 text-xs text-nonveg">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-lg" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-lg">
          Add to bill
        </button>
      </div>
    </form>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/* ==========================================================================
   Variant + add-on picker
   ========================================================================== */

function ItemOptions({
  item, money, onAdd, onCancel,
}: {
  item: MenuItemView;
  money: (v: number) => string;
  onAdd: (variantId: string | null, addOns: MenuItemView['addOns']) => void;
  onCancel: () => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(item.variants[0]?.id ?? null);
  const [picked, setPicked] = useState<MenuItemView['addOns']>([]);

  const base = item.variants.find((v) => v.id === variantId)?.price ?? item.price;
  const total = base + picked.reduce((a, x) => a + x.price, 0);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <VegDot isVeg={item.isVeg} />
        <h2 className="text-base font-semibold">{item.name}</h2>
      </div>

      {item.variants.length > 0 && (
        <div className="mb-3">
          <span className="label">Size</span>
          <div className="grid grid-cols-2 gap-2">
            {item.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariantId(v.id)}
                className={`min-h-[48px] rounded border px-3 text-sm font-medium ${
                  variantId === v.id
                    ? 'border-primary bg-primary text-white'
                    : 'border-counter-line bg-white hover:bg-counter-deep'
                }`}
              >
                {v.name}
                <span className="num block text-xs font-normal opacity-80">{money(v.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {item.addOns.length > 0 && (
        <div className="mb-3">
          <span className="label">Add-ons</span>
          <div className="flex flex-wrap gap-2">
            {item.addOns.map((a) => {
              const on = picked.some((x) => x.id === a.id);
              return (
                <button
                  key={a.id}
                  onClick={() =>
                    setPicked((p) => (on ? p.filter((x) => x.id !== a.id) : [...p, a]))
                  }
                  className={`min-h-[40px] rounded border px-3 text-sm ${
                    on ? 'border-primary bg-primary text-white' : 'border-counter-line bg-white'
                  }`}
                >
                  {a.name} {a.price > 0 && <span className="num">+{money(a.price)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="num mr-auto text-lg font-semibold">{money(total)}</span>
        <button className="btn btn-lg" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary btn-lg" onClick={() => onAdd(variantId, picked)}>
          Add to bill
        </button>
      </div>
    </>
  );
}
