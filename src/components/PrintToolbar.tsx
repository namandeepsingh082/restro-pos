'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  canShareFiles,
  downloadSlipImage,
  downloadSlipPdf,
  shareSlipPdf,
} from '@/lib/client/slipExport';

/** On-screen controls above a slip. Hidden from the printout by `.no-print`. */
export function PrintToolbar({
  width,
  whatsappText,
  phone,
  title,
  fileName,
  repeatHref,
}: {
  width: 58 | 80;
  whatsappText?: string;
  phone?: string | null;
  title: string;
  /** Base name for a saved file, without the extension. */
  fileName: string;
  /** Bills only: start a new cart holding the same items as this one. */
  repeatHref?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'none' | 'pdf' | 'png' | 'whatsapp'>('none');
  const [error, setError] = useState<string | null>(null);
  /** Shown when the PDF has been saved and has to be attached by hand. */
  const [attachHint, setAttachHint] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // Probed on the client only: the share sheet exists on counter tablets and
  // phones but not on most desktops.
  useEffect(() => setCanShare(canShareFiles('application/pdf')), []);

  const setWidth = (w: 58 | 80) => {
    const url = new URL(window.location.href);
    url.searchParams.set('w', String(w));
    router.replace(url.pathname + url.search);
  };

  /** The slip itself, marked on the page so the exporter can find it. */
  const slipNode = () => document.querySelector<HTMLElement>('[data-slip-root] .receipt');

  async function run(kind: 'pdf' | 'png' | 'whatsapp', fn: (node: HTMLElement) => Promise<void>) {
    const node = slipNode();
    if (!node) {
      setError('The slip is not ready yet.');
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      await fn(node);
    } catch (err) {
      // A cancelled share sheet is not a failure worth shouting about.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'That file could not be created.');
    } finally {
      setBusy('none');
    }
  }

  /**
   * A WhatsApp click-to-chat link.
   *
   * 10-digit Indian numbers are dialled with the country code. There is always a
   * `?text=`, because `https://wa.me/` on its own — no number, no message — is
   * rejected by WhatsApp with "this link could not be opened". With a message and
   * no number, WhatsApp opens on its contact list and sends to whoever is picked,
   * which is exactly what a walk-in customer with no saved number needs.
   */
  const chatUrl = (text?: string) => {
    const digits = (phone ?? '').replace(/\D/g, '');
    const to = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${to}?text=${encodeURIComponent(text ?? title)}`;
  };

  /**
   * Sends the bill as a PDF.
   *
   * A wa.me link carries text and nothing else — no URL can attach a file to a
   * chat. On a tablet or phone the PDF goes into the OS share sheet, where
   * WhatsApp is one of the targets, and that is the whole flow. On a desktop the
   * PDF is saved and the cashier attaches it in the chat: the clipboard cannot
   * hold a document, so there is no paste shortcut for this one.
   */
  const sendOnWhatsApp = () =>
    run('whatsapp', async (node) => {
      setAttachHint(false);

      if (canShareFiles('application/pdf')) {
        await shareSlipPdf(node, width, fileName, title);
        return;
      }

      await downloadSlipPdf(node, width, fileName);
      // The chat is opened by the cashier's own click on the link below: a
      // window.open this far past the original gesture gets blocked.
      setAttachHint(true);
    });

  return (
    <div className="no-print sticky top-0 z-10 mb-4 border-b border-counter-line bg-counter/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm font-semibold">{title}</span>

        <div className="flex overflow-hidden rounded border border-counter-line">
          {([58, 80] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWidth(w)}
              aria-pressed={width === w}
              className={`px-3 py-2 text-sm ${
                width === w ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-counter-deep'
              }`}
            >
              {w}mm
            </button>
          ))}
        </div>

        <button type="button" className="btn" onClick={() => window.print()}>
          Print
        </button>

        {/* Both of these come out slip-shaped whatever the print dialog is set
            to, which is the whole reason they exist. */}
        <button
          type="button"
          className="btn"
          disabled={busy !== 'none'}
          onClick={() => run('pdf', (node) => downloadSlipPdf(node, width, fileName))}
          title="A one-page PDF exactly as wide as the paper roll"
        >
          {busy === 'pdf' ? 'Saving…' : 'Save PDF'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== 'none'}
          onClick={() => run('png', (node) => downloadSlipImage(node, width, fileName))}
        >
          {busy === 'png' ? 'Saving…' : 'Save image'}
        </button>

        {whatsappText && (
          <button
            type="button"
            className="btn"
            disabled={busy !== 'none'}
            onClick={sendOnWhatsApp}
            title={
              canShare
                ? 'Sends the bill PDF through the share sheet'
                : 'Saves the bill PDF, then opens the chat to attach it'
            }
          >
            {busy === 'whatsapp' ? 'Preparing…' : 'Send on WhatsApp'}
          </button>
        )}

        {/* Where to go next.
            `window.close()` only works on a window a script opened — which is
            the case when the billing screen launched this slip, and not the case
            when it was opened from a link or typed in. So Close tries to close
            and falls back to the billing screen: pressing it must never leave a
            dead tab with no way back into the app. */}
        <span className="hidden h-8 w-px bg-counter-line sm:block" aria-hidden />

        <a className="btn" href="/billing">
          New bill
        </a>
        {repeatHref && (
          <a
            className="btn"
            href={repeatHref}
            title="Open a new bill with the same items — another round, same table"
          >
            Repeat bill
          </a>
        )}
        <a className="btn" href="/orders">
          Orders
        </a>
        <button
          type="button"
          className="btn"
          onClick={() => {
            window.close();
            window.setTimeout(() => {
              if (!window.closed) window.location.href = '/billing';
            }, 300);
          }}
        >
          Close
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-nonveg">{error}</p>}

      {attachHint && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded border border-veg/40 bg-veg/10 px-2 py-1.5 text-xs">
          <span>
            Bill PDF saved to your downloads. Open the chat and attach it with the{' '}
            <span className="font-semibold">＋</span> button.
          </span>
          <a
            className="btn px-2 py-1 text-xs"
            href={chatUrl()}
            target="_blank"
            rel="noopener"
            onClick={() => setAttachHint(false)}
          >
            Open WhatsApp chat
          </a>
          {whatsappText && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                setAttachHint(false);
                window.open(chatUrl(whatsappText), '_blank', 'noopener');
              }}
            >
              send as text instead
            </button>
          )}
        </p>
      )}
    </div>
  );
}
