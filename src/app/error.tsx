'use client';

import { useEffect } from 'react';

/**
 * What a cashier sees when a screen throws.
 *
 * Without this file Next renders its own error page — a blank white screen in
 * production — which at a counter is indistinguishable from the app being dead,
 * and there is no way back except knowing to retype the URL. This keeps them one
 * tap from billing.
 *
 * `reset()` re-renders the segment that failed, which is enough for a transient
 * failure (a dropped database connection, a request that timed out) without
 * losing the rest of the app.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log holds the stack; this is for whoever has the tablet.
    console.error('[screen error]', error);
  }, [error]);

  return (
    <main className="min-h-viewport flex items-center justify-center bg-counter p-4">
      <div className="panel w-full max-w-md p-5 text-center">
        <h1 className="text-lg font-semibold">This screen could not be loaded</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Nothing was lost. Any bill you had already saved is safe, and a cart you were building is
          still on this device.
        </p>
        {error.digest && (
          <p className="num mt-3 text-xs text-ink-mute">
            Reference {error.digest} — quote this if you report it.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button className="btn-primary btn-lg" onClick={reset}>
            Try again
          </button>
          <a className="btn btn-lg" href="/billing">
            Back to billing
          </a>
        </div>
      </div>
    </main>
  );
}
