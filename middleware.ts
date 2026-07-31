import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Edge gate. It does two things and nothing more:
 *   1. bounces anonymous requests to /login
 *   2. bounces cashiers away from admin-only screens
 *
 * Fine-grained permission checks live in the route handlers, which can read the
 * database; middleware only sees the signed token.
 */

const SESSION_COOKIE = 'restropos_session';
const ADMIN_PREFIXES = ['/menu', '/settings', '/users', '/reports'];
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/manifest.webmanifest', '/sw.js', '/offline'];

async function readRole(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return (payload as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const role = await readRole(req.cookies.get(SESSION_COOKIE)?.value);

  if (!role) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (role !== 'ADMIN' && ADMIN_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = '/billing';
    url.searchParams.set('denied', '1');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
