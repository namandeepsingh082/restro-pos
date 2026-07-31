'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { queueCount } from '@/lib/client/offline';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    // Signing out with unsynced bills on the device would strand them: the
    // queue can only be replayed by a signed-in session.
    const pending = await queueCount();
    if (pending > 0) {
      const go = window.confirm(
        `${pending} bill(s) on this device have not reached the server yet. ` +
          `Sign out anyway? They will sync when you sign back in.`,
      );
      if (!go) return;
    }
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      className="btn min-h-[40px] shrink-0 px-2 sm:px-3"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
    >
      {/* On a phone the label would take a fifth of the header away from the
          navigation, so only the icon shows until there is room for words. */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-5 w-5 sm:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
        <path d="M10 8l-4 4 4 4" />
        <path d="M6 12h9" />
      </svg>
      <span className="hidden sm:inline">{busy ? '…' : 'Sign out'}</span>
    </button>
  );
}
