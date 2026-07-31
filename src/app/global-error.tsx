'use client';

/**
 * The last resort: a failure in the root layout itself, where `error.tsx` cannot
 * help because the layout that would have wrapped it is the thing that broke.
 * This component replaces the whole document, so it ships its own <html> and
 * cannot rely on the stylesheet having loaded — hence the inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#EEF1F2',
          color: '#0F1417',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: '1rem',
        }}
      >
        <div style={{ maxWidth: '26rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', margin: '0 0 0.5rem' }}>The app could not start</h1>
          <p style={{ fontSize: '0.875rem', color: '#3C464C', margin: '0 0 1rem' }}>
            Reload this page. If it keeps happening, restart the app on the counter machine — bills
            already saved are not affected.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#6B7780' }}>Reference {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{
              minHeight: 48,
              padding: '0 1.25rem',
              border: '1px solid #0A464B',
              borderRadius: 4,
              background: '#0E5C63',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 500,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
