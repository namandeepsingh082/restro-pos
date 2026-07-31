import { prisma } from './db';

/** The settings row is a singleton (id = 1) and is created on first read. */
export async function getSettings() {
  const existing = await prisma.restaurantSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.restaurantSettings.create({ data: { id: 1 } });
}

export type Settings = Awaited<ReturnType<typeof getSettings>>;

/** Only the fields the browser is allowed to see. Never ship the whole row. */
export function publicSettings(s: Settings) {
  return {
    name: s.name,
    currency: s.currency,
    locale: s.locale,
    timeZone: s.timeZone,
    receiptWidth: s.receiptWidth,
    defaultTaxPct: s.defaultTaxPct,
    defaultPackagingChg: s.defaultPackagingChg,
    defaultDeliveryChg: s.defaultDeliveryChg,
    roundOffTotals: s.roundOffTotals,
    printKotOnSave: s.printKotOnSave,
  };
}
export type PublicSettings = ReturnType<typeof publicSettings>;

/**
 * The receipt header, sent to the browser so a bill can still be printed with
 * no connection. All of it is already printed on every slip, so none of it is
 * information a cashier does not have.
 */
export function printProfile(s: Settings) {
  return {
    name: s.name,
    logoDataUrl: s.logoDataUrl,
    addressLines: [s.addressLine1, s.addressLine2, s.city].filter(Boolean),
    phone: s.phone,
    email: s.email,
    gstNumber: s.gstNumber,
    fssaiNumber: s.fssaiNumber,
    footer: s.receiptFooter,
    splitTax: s.splitTaxOnReceipt,
  };
}
export type PrintProfile = ReturnType<typeof printProfile>;
