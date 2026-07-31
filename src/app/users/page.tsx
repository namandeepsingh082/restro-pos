import { AppShell } from '@/components/AppShell';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { StaffManager, type StaffRow } from './StaffManager';

export const metadata = { title: 'Staff — Restro POS' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const settings = await getSettings();
  const users = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { role: { select: { key: true } }, _count: { select: { orders: true } } },
  });

  const rows: StaffRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? '',
    role: u.role.key as StaffRow['role'],
    maxDiscountPct: u.maxDiscountPct,
    maxDiscountAmt: u.maxDiscountAmt,
    active: u.active,
    orders: u._count.orders,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  }));

  return (
    <AppShell active="users">
      <StaffManager rows={rows} currency={settings.currency} locale={settings.locale} />
    </AppShell>
  );
}
