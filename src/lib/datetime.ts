/**
 * Date helpers. Reports are day-bucketed in the restaurant's timezone, so we
 * never compare raw UTC timestamps against a local calendar day.
 */

export function startOfLocalDay(date: Date, timeZone: string): Date {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  // Build the UTC instant matching local midnight by measuring the offset.
  const guess = new Date(`${s}T00:00:00Z`);
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60_000);
}

export function endOfLocalDay(date: Date, timeZone: string): Date {
  const start = startOfLocalDay(date, timeZone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Minutes that `timeZone` is ahead of UTC at the given instant. */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) if (part.type !== 'literal') p[part.type] = part.value;
  const asUTC = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

export function formatDateTime(d: Date | string, timeZone = 'Asia/Kolkata', locale = 'en-IN') {
  return new Intl.DateTimeFormat(locale, {
    timeZone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(d));
}

export function formatTime(d: Date | string, timeZone = 'Asia/Kolkata', locale = 'en-IN') {
  return new Intl.DateTimeFormat(locale, {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(d));
}

export function formatDate(d: Date | string, timeZone = 'Asia/Kolkata', locale = 'en-IN') {
  return new Intl.DateTimeFormat(locale, {
    timeZone, day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(d));
}

/** Resolve a named range to [from, to] in absolute instants. */
export function resolveRange(
  range: string,
  timeZone: string,
  fromISO?: string | null,
  toISO?: string | null,
): { from: Date; to: Date; label: string } {
  const now = new Date();
  switch (range) {
    case 'yesterday': {
      const y = addDays(now, -1);
      return { from: startOfLocalDay(y, timeZone), to: endOfLocalDay(y, timeZone), label: 'Yesterday' };
    }
    case 'week':
      return { from: startOfLocalDay(addDays(now, -6), timeZone), to: endOfLocalDay(now, timeZone), label: 'Last 7 days' };
    case 'month':
      return { from: startOfLocalDay(addDays(now, -29), timeZone), to: endOfLocalDay(now, timeZone), label: 'Last 30 days' };
    case 'custom': {
      const from = fromISO ? startOfLocalDay(new Date(fromISO), timeZone) : startOfLocalDay(now, timeZone);
      const to = toISO ? endOfLocalDay(new Date(toISO), timeZone) : endOfLocalDay(now, timeZone);
      return { from, to, label: 'Custom range' };
    }
    case 'today':
    default:
      return { from: startOfLocalDay(now, timeZone), to: endOfLocalDay(now, timeZone), label: 'Today' };
  }
}
