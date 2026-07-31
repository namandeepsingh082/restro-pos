import { prisma } from '@/lib/db';
import { requirePermission, HttpError } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { userSchema } from '@/lib/validation';
import { hashPassword, passwordProblem } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.USERS_WRITE);
  const { id } = await ctx.params;
  const body = userSchema.partial().parse(await req.json());

  const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!target) throw new HttpError(404, 'User not found.');

  // Guard against locking yourself out of the only admin account.
  if (target.role.key === 'ADMIN' && (body.active === false || (body.role && body.role !== 'ADMIN'))) {
    const admins = await prisma.user.count({ where: { active: true, role: { key: 'ADMIN' } } });
    if (admins <= 1) throw new HttpError(409, 'This is the last active admin. Add another admin first.');
  }

  const data: Record<string, unknown> = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.email !== undefined ? { email: body.email.toLowerCase() } : {}),
    ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
    ...(body.maxDiscountPct !== undefined ? { maxDiscountPct: body.maxDiscountPct } : {}),
    ...(body.maxDiscountAmt !== undefined ? { maxDiscountAmt: body.maxDiscountAmt } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  };

  if (body.password) {
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    data.passwordHash = await hashPassword(body.password);
  }
  if (body.role) {
    const role = await prisma.role.findUnique({ where: { key: body.role } });
    if (!role) throw new HttpError(400, 'That role does not exist.');
    data.roleId = role.id;
  }

  const user = await prisma.user.update({
    where: { id }, data,
    select: { id: true, name: true, email: true, active: true },
  });

  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'user.update', entity: 'User', entityId: id,
    // Never log the password or its hash.
    meta: { fields: Object.keys(data).filter((k) => k !== 'passwordHash'), passwordReset: Boolean(body.password) },
  });
  return ok(user);
});
