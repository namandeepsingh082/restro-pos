/**
 * Money helpers.
 *
 * The whole application stores money as an integer number of MINOR UNITS
 * (paise for INR, cents for USD). Nothing in the codebase should ever hold a
 * monetary value in a float. Conversion happens only at the edges: parsing a
 * form field, and formatting for display.
 */

/** "125.50" | 125.5  ->  12550 */
export function toMinor(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** 12550 -> 125.5 (only for populating a numeric form input) */
export function toMajor(minor: number): number {
  return Math.round(minor) / 100;
}

/** 12550 -> "125.50" — no symbol, no grouping. Used on receipts. */
export function plain(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 125000 -> "₹1,250.00" */
export function formatMoney(minor: number, currency = 'INR', locale = 'en-IN'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(toMajor(minor));
  } catch {
    return `${currency} ${plain(minor)}`;
  }
}

/** Currency symbol only, for tight table headers. */
export function currencySymbol(currency = 'INR', locale = 'en-IN'): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * Percentage of an amount, rounded half-up to the nearest minor unit.
 * pct is a whole number (5 = 5%). Kept as integer maths throughout.
 */
export function percentOf(minor: number, pct: number): number {
  return Math.round((minor * pct) / 100);
}

/** Round to the nearest whole currency unit; returns the delta to apply. */
export function roundOffDelta(minor: number): number {
  const rounded = Math.round(minor / 100) * 100;
  return rounded - minor;
}
