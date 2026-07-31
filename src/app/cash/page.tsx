import { AppShell } from '@/components/AppShell';
import { getSettings } from '@/lib/settings';
import { CashDrawer } from './CashDrawer';

export const metadata = { title: 'Cash drawer — Restro POS' };
export const dynamic = 'force-dynamic';

export default async function CashPage() {
  const settings = await getSettings();
  return (
    <AppShell active="cash">
      <CashDrawer currency={settings.currency} locale={settings.locale} />
    </AppShell>
  );
}
