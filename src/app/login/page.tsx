import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in — Restro POS' };

export default async function LoginPage() {
  if (await getSession()) redirect('/billing');
  const settings = await getSettings();

  return (
    <main className="min-h-viewport flex items-center justify-center bg-counter p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded bg-primary" aria-hidden />
          <h1 className="text-xl font-semibold">{settings.name}</h1>
          <p className="text-sm text-ink-mute">Billing counter</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
