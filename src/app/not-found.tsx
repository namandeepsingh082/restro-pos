/**
 * A URL that does not exist — most often a bill that was cancelled and deleted,
 * reached from a stale tab or a bookmarked print link.
 */
export default function NotFound() {
  return (
    <main className="min-h-viewport flex items-center justify-center bg-counter p-4">
      <div className="panel w-full max-w-md p-5 text-center">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-ink-soft">
          This page or bill does not exist. It may have been cancelled, or the link may be from an
          older session.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a className="btn-primary btn-lg" href="/billing">
            New bill
          </a>
          <a className="btn btn-lg" href="/orders">
            Order history
          </a>
        </div>
      </div>
    </main>
  );
}
