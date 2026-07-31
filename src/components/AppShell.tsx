import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { SignOutButton } from './SignOutButton';
import { OfflineBadge } from './OfflineBadge';

/**
 * Frame for every signed-in screen: identity, navigation, connection state.
 * Navigation is a single row of large targets — a counter tablet should never
 * need a menu inside a menu.
 */
export async function AppShell({
  children,
  active,
  wide,
}: {
  children: React.ReactNode;
  active: 'billing' | 'orders' | 'dashboard' | 'reports' | 'menu' | 'settings' | 'users' | 'cash';
  /** Billing uses the full viewport height with no page scroll. */
  wide?: boolean;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const settings = await getSettings();
  const isAdmin = session.role === 'ADMIN';

  const links: { key: typeof active; href: string; label: string; adminOnly?: boolean }[] = [
    { key: 'billing', href: '/billing', label: 'New bill' },
    { key: 'orders', href: '/orders', label: 'Orders' },
    { key: 'cash', href: '/cash', label: 'Cash drawer' },
    { key: 'dashboard', href: '/dashboard', label: 'Sales', adminOnly: true },
    { key: 'reports', href: '/reports', label: 'Reports', adminOnly: true },
    { key: 'menu', href: '/menu', label: 'Menu', adminOnly: true },
    { key: 'users', href: '/users', label: 'Staff', adminOnly: true },
    { key: 'settings', href: '/settings', label: 'Settings', adminOnly: true },
  ];

  return (
    <div className={wide ? 'flex h-viewport flex-col overflow-hidden' : 'min-h-viewport'}>
      <header className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-counter-line bg-white/95 px-2 py-2 backdrop-blur sm:gap-3 sm:px-3">
        <span className="hidden max-w-[14ch] truncate text-sm font-semibold sm:block lg:max-w-none">
          {settings.name}
        </span>

        {/* Eight destinations do not fit across a phone, so the row scrolls
            rather than wrapping into a second line that would eat the screen.
            The fade on the right edge is what tells the eye it scrolls — without
            it, a half-visible word just looks like a broken layout. */}
        <nav className="nav-scroll scroll-x flex min-w-0 flex-1 gap-1">
          {links
            .filter((l) => !l.adminOnly || isAdmin)
            .map((l) => (
              <Link
                key={l.key}
                href={l.href}
                aria-current={active === l.key ? 'page' : undefined}
                className={`flex min-h-[40px] items-center whitespace-nowrap rounded px-3 text-sm font-medium ${
                  active === l.key
                    ? 'bg-primary text-white'
                    : 'text-ink-soft hover:bg-counter-deep hover:text-ink'
                }`}
              >
                {l.label}
              </Link>
            ))}
        </nav>

        <OfflineBadge />
        <span className="hidden text-right text-xs leading-tight text-ink-mute md:block">
          {session.name}
          <br />
          {isAdmin ? 'Admin' : 'Cashier'}
        </span>
        <SignOutButton />
      </header>

      {/* Scrolling screens get bottom safe-area padding so the last row clears
          the home indicator; the billing screen manages its own. */}
      <div className={wide ? 'min-h-0 flex-1' : 'pb-safe p-3 sm:p-5'}>{children}</div>
    </div>
  );
}
