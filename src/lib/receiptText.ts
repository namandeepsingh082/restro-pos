import type { ReceiptData } from './receipt';

/**
 * The bill as plain text, for a WhatsApp message.
 *
 * It lives in its own module — and imports only a *type* from receipt.ts, which
 * the compiler erases — so the billing screen can use it in the browser. Its
 * neighbour builds ReceiptData from the database and pulls in Prisma with it,
 * which must never reach the client bundle.
 *
 * This is what a customer receives when the device cannot attach the PDF: an
 * itemised bill they can read, rather than a total with no explanation.
 */
export function receiptToText(r: ReceiptData): string {
  const money = (v: number) => (v / 100).toFixed(2);
  const out: string[] = [];
  out.push(`*${r.restaurant.name}*`);
  if (r.restaurant.phone) out.push(r.restaurant.phone);
  out.push('');
  out.push(`Bill: ${r.billNo ?? r.orderNo}`);
  out.push(`${r.date} ${r.time} | ${r.orderType}${r.tableNo ? ` | Table ${r.tableNo}` : ''}`);
  out.push('');
  for (const l of r.lines) {
    const name = l.variant ? `${l.name} (${l.variant})` : l.name;
    out.push(`${l.qty} x ${name} — ${money(l.amount)}`);
    for (const a of l.addOns) out.push(`   + ${a.name}`);
  }
  out.push('');
  out.push(`Subtotal: ${money(r.itemsSubtotal)}`);
  if (r.discountTotal) out.push(`Discount: -${money(r.discountTotal)}`);
  if (r.packagingCharge) out.push(`Packaging: ${money(r.packagingCharge)}`);
  if (r.deliveryCharge) out.push(`Delivery: ${money(r.deliveryCharge)}`);
  if (r.taxTotal) out.push(`Tax: ${money(r.taxTotal)}`);
  if (r.roundOff) out.push(`Round off: ${money(r.roundOff)}`);
  out.push(`*Total: ${money(r.grandTotal)}*`);
  out.push(`Payment: ${r.payments.map((p) => `${p.label} ${money(p.amount)}`).join(' + ') || 'Unpaid'}`);
  if (r.restaurant.footer) {
    out.push('');
    out.push(r.restaurant.footer);
  }
  return out.join('\n');
}
