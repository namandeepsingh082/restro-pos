import { AppShell } from '@/components/AppShell';
import { getSettings } from '@/lib/settings';
import { SettingsForm } from './SettingsForm';

export const metadata = { title: 'Settings — Restro POS' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <AppShell active="settings">
      <SettingsForm initial={JSON.parse(JSON.stringify(settings))} />
    </AppShell>
  );
}
