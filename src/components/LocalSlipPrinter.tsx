'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Receipt } from './Receipt';
import type { ReceiptData } from '@/lib/receipt';

/**
 * Prints a receipt that the server has never seen.
 *
 * With the network down, the bill still has to come out of the printer. The slip
 * is rendered from the cart in the browser using the very same Receipt
 * component the server uses, portalled straight onto <body> so that the print
 * stylesheet sees it as the only thing on the page — no app chrome, no wrapper
 * padding, no blank second page.
 */
export function LocalSlipPrinter({
  data,
  onDone,
}: {
  data: ReceiptData | null;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!data) return;

    document.body.classList.add('printing-slip');

    const style = document.createElement('style');
    style.setAttribute('data-slip', 'true');
    style.textContent = `@page { size: ${data.width}mm auto; margin: 0; }`;
    document.head.appendChild(style);

    const cleanup = () => {
      document.body.classList.remove('printing-slip');
      style.remove();
      window.removeEventListener('afterprint', cleanup);
      onDone();
    };

    window.addEventListener('afterprint', cleanup);

    // Give the portal a frame to paint before opening the dialog.
    const id = window.setTimeout(() => window.print(), 250);

    // Safari never fires afterprint on some versions; this is the backstop so
    // the app chrome always comes back.
    const backstop = window.setTimeout(cleanup, 20_000);

    return () => {
      window.clearTimeout(id);
      window.clearTimeout(backstop);
      window.removeEventListener('afterprint', cleanup);
      document.body.classList.remove('printing-slip');
      style.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return null;

  return createPortal(
    <div className="local-slip">
      <Receipt data={data} />
    </div>,
    document.body,
  );
}
