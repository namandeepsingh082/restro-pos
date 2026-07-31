'use client';

import { useEffect, useRef } from 'react';

/**
 * Fires the browser print dialog as soon as the slip has painted.
 *
 * The billing screen opens print views in a background window with `?auto=1`,
 * so the cashier's flow is: tap Save & print -> printer runs -> window closes.
 * `closeAfter` only works for windows opened by script, which is exactly the
 * case we use it in.
 */
export function PrintTrigger({ auto, closeAfter }: { auto: boolean; closeAfter?: boolean }) {
  const fired = useRef(false);

  useEffect(() => {
    if (!auto || fired.current) return;
    fired.current = true;

    // Two frames is enough for fonts and the logo image to settle; printing
    // earlier can produce a half-rendered slip on slower tablets.
    const id = window.setTimeout(() => {
      window.print();
      if (closeAfter) {
        window.setTimeout(() => window.close(), 400);
      }
    }, 350);

    return () => window.clearTimeout(id);
  }, [auto, closeAfter]);

  return null;
}
