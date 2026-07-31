import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { menuItemSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

export const POST = handler(async (req: Request) => {
  const session = await requirePermission(PERMISSIONS.MENU_WRITE);
  const body = menuItemSchema.parse(await req.json());
  const { variants, addOns, ...item } = body;

  const created = await prisma.menuItem.create({
    data: {
      ...item,
      code: item.code.toUpperCase(),
      variants: { create: variants.map((v, i) => ({ name: v.name, price: v.price, active: v.active, sortOrder: i })) },
      addOns: { create: addOns.map((a) => ({ name: a.name, price: a.price, active: a.active })) },
    },
    include: { variants: true, addOns: true },
  });

  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'menu.item.create', entity: 'MenuItem', entityId: created.id,
    meta: { code: created.code, name: created.name, price: created.price },
  });
  return ok(created, { status: 201 });
});
