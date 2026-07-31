import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from './db';
import { CASHIER_PERMISSIONS, type RoleKey } from './constants';

export const SESSION_COOKIE = 'restropos_session';

export interface SessionPayload {
  sub: string;         // user id
  name: string;
  email: string;
  role: RoleKey;
  perms: string[];
  maxDiscountPct: number;
  maxDiscountAmt: number;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Set a long random value in .env — see .env.example.',
    );
  }
  return new TextEncoder().encode(secret);
}

function sessionHours(): number {
  const h = Number(process.env.SESSION_HOURS ?? 12);
  return Number.isFinite(h) && h > 0 ? h : 12;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${sessionHours()}h`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: sessionHours() * 3600,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Read and verify the current session, or null. */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Session + a fresh database read of the user. Use this for any write, so that
 * a deactivated account stops working immediately instead of at token expiry.
 */
export async function getActiveUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { role: true },
  });
  if (!user || !user.active) return null;
  return user;
}

export function isAdmin(session: SessionPayload | null): boolean {
  return session?.role === 'ADMIN';
}

export function can(session: SessionPayload | null, permission: string): boolean {
  if (!session) return false;
  if (session.role === 'ADMIN') return true;
  return (session.perms ?? CASHIER_PERMISSIONS).includes(permission);
}

/** Thrown by requirePermission and translated to a 401/403 by the API helper. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new HttpError(401, 'Please sign in again.');
  return session;
}

/**
 * The same guard for a page rather than an API route.
 *
 * `requireSession` throws, which an API helper turns into a clean 401 — but on a
 * page that throw becomes a 500 error screen. A cashier whose session expired
 * between saving a bill and reprinting it should land on the sign-in form and be
 * returned to the slip afterwards, which is what this does.
 */
export async function requirePageSession(returnTo?: string): Promise<SessionPayload> {
  const session = await getSession();
  if (session) return session;
  // `redirect` never returns — it throws the framework's redirect signal. It is
  // returned rather than called so the function still satisfies its own type.
  return redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
}

export async function requirePermission(permission: string): Promise<SessionPayload> {
  const session = await requireSession();
  if (!can(session, permission)) {
    throw new HttpError(403, 'Your role does not allow this action.');
  }
  return session;
}
