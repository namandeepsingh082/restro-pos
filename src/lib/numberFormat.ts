/**
 * Number-format helpers with no database dependency, so the settings screen can
 * preview a bill number in the browser without dragging Prisma into the client
 * bundle. The sequence-consuming half lives in src/lib/numbering.ts.
 *
 * Tokens: {YYYY} {YY} {MM} {DD} {SEQ} {SEQ:n}
 */

export const NUMBER_TOKEN = /\{(YYYY|YY|MM|DD|SEQ)(?::(\d+))?\}/g;

export interface DateParts {
  YYYY: string;
  YY: string;
  MM: string;
  DD: string;
}

export function dateParts(now: Date, timeZone: string): DateParts {
  // Formatted in the restaurant's timezone so the day rolls over at local
  // midnight rather than UTC midnight.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(now).split('-');
  return { YYYY: y, YY: y.slice(2), MM: m, DD: d };
}

/**
 * The reset scope implied by the tokens in a format: a format containing {DD}
 * restarts every day, {MM} every month, {YY}/{YYYY} every year, and one with no
 * date token never resets. Baking the scope into the counter key means the reset
 * needs no scheduled job.
 */
export function scopeFor(format: string, p: DateParts): string {
  if (format.includes('{DD}')) return `${p.YYYY}${p.MM}${p.DD}`;
  if (format.includes('{MM}')) return `${p.YYYY}${p.MM}`;
  if (format.includes('{YY}') || format.includes('{YYYY}')) return p.YYYY;
  return 'all';
}

export function applyFormat(format: string, seq: number, p: DateParts): string {
  return format.replace(NUMBER_TOKEN, (_m, token: string, pad?: string) =>
    token === 'SEQ' ? String(seq).padStart(Number(pad ?? 1), '0') : p[token as keyof DateParts],
  );
}

/** Preview a number without consuming a sequence value. */
export function previewNumber(format: string, seq = 1, timeZone = 'Asia/Kolkata'): string {
  return applyFormat(format, seq, dateParts(new Date(), timeZone));
}
