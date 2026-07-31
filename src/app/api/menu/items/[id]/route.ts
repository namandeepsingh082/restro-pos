import { prisma } from '@/lib/db';
import { requirePermission, HttpError } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { menuItemSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.MENU_WRITE);
  const { id } = await ctx.params;
  const body = menuItemSchema.partial().parse(await req.json());
  const { variants, addOns, ...item } = body;

  const before = await prisma.menuItem.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, 'Menu item not found.');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.menuItem.update({
      where: { id },
      data: { ...item, ...(item.code ? { code: item.code.toUpperCase() } : {}) },
    });

    // Variants and add-ons are replaced wholesale, but only when the caller
    // actually sent them — a price-only PATCH must not wipe the sizes.
    if (variants) {
      await tx.menuItemVariant.deleteMany({ where: { menuItemId: id, id: { notIn: variants.filter((v) => v.id).map((v) => v.id!) } } });
      for (const [i, v] of variants.entries()) {
        if (v.id) {
          await tx.menuItemVariant.update({ where: { id: v.id }, data: { name: v.name, price: v.price, active: v.active, sortOrder: i } });
        } else {
          await tx.menuItemVariant.create({ data: { menuItemId: id, name: v.name, price: v.price, active: v.active, sortOrder: i } });
        }
      }
    }
    if (addOns) {
      await tx.menuItemAddOn.deleteMany({ where: { menuItemId: id, id: { notIn: addOns.filter((a) => a.id).map((a) => a.id!) } } });
      for (const a of addOns) {
        if (a.id) {
          await tx.menuItemAddOn.update({ where: { id: a.id }, data: { name: a.name, price: a.price, active: a.active } });
        } else {
          await tx.menuItemAddOn.create({ data: { menuItemId: id, name: a.name, price: a.price, active: a.active } });
        }
      }
    }
    return row;
  });

  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'menu.item.update', entity: 'MenuItem', entityId: id,
    meta: {
      before: { price: before.price, available: before.available, enabled: before.enabled, name: before.name },
      after: { price: updated.price, available: updated.available, enabled: updated.enabled, name: updated.name },
    },
  });
  return ok(updated);
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const session = await requirePermission(PERMISSIONS.MENU_WRITE);
  const { id } = await ctx.params;

  // An item that appears on any past bill is never hard-deleted — that would
  // break the sales history. It is disabled instead.
  const used = await prisma.orderItem.count({ where: { menuItemId: id } });
  if (used > 0) {
    const row = await prisma.menuItem.update({ where: { id }, data: { enabled: false, available: false } });
    await audit({
      actorId: session.sub, actorName: session.name,
      action: 'menu.item.disable', entity: 'MenuItem', entityId: id,
      meta: { reason: 'appears on past bills', orderLines: used },
    });
    return ok({ deleted: false, disabled: true, item: row });
  }

  await prisma.menuItem.delete({ where: { id } });
  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'menu.item.delete', entity: 'MenuItem', entityId: id,
  });
  return ok({ deleted: true, disabled: false });
});
