import { prisma } from '@/lib/db';
import { requirePermission, HttpError } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { categorySchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.MENU_WRITE);
  const { id } = await ctx.params;
  const data = categorySchema.partial().parse(await req.json());
  const category = await prisma.menuCategory.update({ where: { id }, data });
  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'menu.category.update', entity: 'MenuCategory', entityId: id, meta: data,
  });
  return ok(category);
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.MENU_WRITE);
  const { id } = await ctx.params;
  const count = await prisma.menuItem.count({ where: { categoryId: id } });
  if (count > 0) {
    // Deleting would orphan historical order lines, so we refuse and point at
    // the safe alternative.
    throw new HttpError(
      409,
      `This category still holds ${count} item(s). Move or delete them first, or switch the category off instead.`,
    );
  }
  await prisma.menuCategory.delete({ where: { id } });
  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'menu.category.delete', entity: 'MenuCategory', entityId: id,
  });
  return ok({ deleted: true });
});
