import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { userSchema } from '@/lib/validation';
import { hashPassword, passwordProblem } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { HttpError } from '@/lib/session';
import { PERMISSIONS } from '@/lib/constants';

export const GET = handler(async () => {
  await requirePermission(PERMISSIONS.USERS_WRITE);
  const users = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, email: true, phone: true, active: true,
      maxDiscountPct: true, maxDiscountAmt: true, lastLoginAt: true,
      role: { select: { key: true, name: true } },
      _count: { select: { orders: true } },
    },
  });
  return ok(users);
});

export const POST = handler(async (req: Request) => {
  const session = await requirePermission(PERMISSIONS.USERS_WRITE);
  const body = userSchema.parse(await req.json());
  if (!body.password) throw new HttpError(400, 'Set a password for the new user.');
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, problem);

  const role = await prisma.role.findUnique({ where: { key: body.role } });
  if (!role) throw new HttpError(400, 'That role does not exist.');

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email.toLowerCase(),
      phone: body.phone || null,
      passwordHash: await hashPassword(body.password),
      roleId: role.id,
      maxDiscountPct: body.maxDiscountPct,
      maxDiscountAmt: body.maxDiscountAmt,
      active: body.active,
    },
    select: { id: true, name: true, email: true },
  });

  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'user.create', entity: 'User', entityId: user.id,
    meta: { email: user.email, role: body.role },
  });
  return ok(user, { status: 201 });
});
