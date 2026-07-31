'use client';

/** Currency formatting on the client, driven by the restaurant's settings. */
export function makeFormatter(currency: string, locale: string) {
  let nf: Intl.NumberFormat;
  try {
    nf = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    nf = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
  }
  return (minor: number) => nf.format(minor / 100);
}

/** Parse a typed amount ("120", "120.50", "₹120") into minor units. */
export function parseAmount(text: string): number {
  const n = Number(String(text).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
