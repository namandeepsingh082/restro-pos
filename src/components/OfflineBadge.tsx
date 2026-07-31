'use client';

import { useEffect, useState } from 'react';
import { queueCount, syncQueue } from '@/lib/client/offline';

/**
 * Connection and sync state. Also owns the retry loop: online event, focus, and
 * a 30 second timer. Mounted in the header so it runs on every screen.
 */
export function OfflineBadge() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    let cancelled = false;

    const refresh = async () => {
      const n = await queueCount();
      if (!cancelled) setPending(n);
    };

    const attemptSync = async () => {
      if (!navigator.onLine || cancelled) return;
      const n = await queueCount();
      if (n === 0) {
        if (!cancelled) setPending(0);
        return;
      }
      setSyncing(true);
      const res = await syncQueue();
      if (!cancelled) {
        setPending(res.remaining);
        setSyncing(false);
        if (res.synced > 0) window.dispatchEvent(new CustomEvent('restropos:synced', { detail: res }));
      }
    };

    const goOnline = () => {
      setOnline(true);
      void attemptSync();
    };
    const goOffline = () => setOnline(false);

    void refresh();
    void attemptSync();

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('focus', attemptSync);
    window.addEventListener('restropos:queued', refresh);
    const timer = window.setInterval(attemptSync, 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('focus', attemptSync);
      window.removeEventListener('restropos:queued', refresh);
      window.clearInterval(timer);
    };
  }, []);

  if (online && pending === 0) return null;

  return (
    <span
      className={`chip ${online ? 'bg-marigold-light text-marigold' : 'bg-nonveg/10 text-nonveg'}`}
      title={
        online
          ? 'Bills saved on this device are being sent to the server.'
          : 'Working offline. Bills are saved on this device and will sync automatically.'
      }
    >
      {!online && 'Offline'}
      {!online && pending > 0 && ' · '}
      {pending > 0 && `${pending} to sync`}
      {syncing && ' …'}
    </span>
  );
}
