export const metadata = { title: 'Offline — Restro POS' };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="text-sm text-ink-soft">
        This screen has not been saved for offline use yet. Go back to the billing screen —
        it keeps working without a connection and stores each bill on this device until the
        connection returns.
      </p>
      <a className="btn-primary btn-lg" href="/billing">
        Open billing screen
      </a>
    </main>
  );
}
