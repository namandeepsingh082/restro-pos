import { prisma } from './db';
import { applyFormat, dateParts, scopeFor } from './numberFormat';

/**
 * Bill / order / KOT number generation.
 *
 * Formats are configured by the admin as templates, e.g.
 *   "INV-{YY}{MM}{DD}-{SEQ:4}"  ->  INV-260730-0001
 *   "{SEQ:5}"                   ->  00042
 *
 * The sequence resets itself based on the date tokens in the template — see
 * scopeFor() in numberFormat.ts. Format parsing lives there so the settings UI
 * can share it.
 */

/** Atomically claim the next value for a counter key. */
async function nextSeq(key: string): Promise<number> {
  const row = await prisma.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

export async function generateNumber(
  kind: 'bill' | 'order' | 'kot',
  format: string,
  timeZone = 'Asia/Kolkata',
  now = new Date(),
): Promise<string> {
  const p = dateParts(now, timeZone);
  const seq = await nextSeq(`${kind}:${scopeFor(format, p)}`);
  return applyFormat(format, seq, p);
}

export { previewNumber } from './numberFormat';
