import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSessionToken, setSessionCookie } from '@/lib/session';
import { loginSchema } from '@/lib/validation';
import { ok, fail, handler, clientIp } from '@/lib/api';
import { audit } from '@/lib/audit';
import { CASHIER_PERMISSIONS, PERMISSIONS, type RoleKey } from '@/lib/constants';

export const POST = handler(async (req: Request) => {
  const body = loginSchema.parse(await req.json());
  const email = body.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  // One message for every failure mode, so the form cannot be used to discover
  // which email addresses exist.
  const generic = 'Email or password is incorrect.';
  if (!user || !user.active) {
    await audit({ action: 'auth.login.failed', entity: 'User', meta: { email }, ip: clientIp(req) });
    return fail(401, generic);
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    await audit({
      actorId: user.id, actorName: user.name,
      action: 'auth.login.failed', entity: 'User', entityId: user.id,
      meta: { email }, ip: clientIp(req),
    });
    return fail(401, generic);
  }

  let perms: string[] = [];
  try {
    perms = JSON.parse(user.role.permissions);
  } catch {
    perms = user.role.key === 'ADMIN' ? Object.values(PERMISSIONS) : CASHIER_PERMISSIONS;
  }

  const token = await createSessionToken({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role.key as RoleKey,
    perms,
    maxDiscountPct: user.maxDiscountPct,
    maxDiscountAmt: user.maxDiscountAmt,
  });
  await setSessionCookie(token);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({
    actorId: user.id, actorName: user.name,
    action: 'auth.login', entity: 'User', entityId: user.id, ip: clientIp(req),
  });

  return ok({
    id: user.id,
    name: user.name,
    role: user.role.key,
    redirect: user.role.key === 'ADMIN' ? '/dashboard' : '/billing',
  });
});
