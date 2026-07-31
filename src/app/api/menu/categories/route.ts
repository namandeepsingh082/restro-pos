import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { ok, handler } from '@/lib/api';
import { categorySchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/constants';

export const POST = handler(async (req: Request) => {
  const session = await requirePermission(PERMISSIONS.MENU_WRITE);
  const data = categorySchema.parse(await req.json());
  const category = await prisma.menuCategory.create({ data });
  await audit({
    actorId: session.sub, actorName: session.name,
    action: 'menu.category.create', entity: 'MenuCategory', entityId: category.id, meta: data,
  });
  return ok(category, { status: 201 });
});
