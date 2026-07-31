import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { HttpError } from './session';

/** Uniform JSON success envelope. */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, details }, { status });
}

/**
 * Wrap a route handler so every thrown error becomes a predictable JSON
 * response instead of an HTML error page — the client always gets
 * { ok: false, error }.
 */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      if (err instanceof ZodError) {
        const first = err.errors[0];
        return fail(400, first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request.', err.errors);
      }
      // Prisma unique-constraint violation
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') return fail(409, 'That record already exists.');
      if (code === 'P2025') return fail(404, 'Record not found.');
      console.error('[api] unhandled error', err);
      return fail(500, 'Something went wrong. Check the server log for details.');
    }
  };
}

export function clientIp(req: Request): string | null {
  const h = req.headers;
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
}
