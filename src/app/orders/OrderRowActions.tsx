'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, ApiError } from '@/lib/client/api';
import { makeFormatter, parseAmount } from '@/lib/client/format';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '@/lib/constants';

interface OrderLite {
  id: string;
  orderNo: string;
  billNo: string | null;
  status: string;
  paymentStatus: string;
  grandTotal: number;
  paidTotal: number;
  refundedTotal: number;
  kotBatches: number;
}

/**
 * Row actions.
 *
 * Anything irreversible — cancel, refund — asks for a reason in a dialog first,
 * and the reason is stored on the audit trail. There is deliberately no
 * one-tap destructive action anywhere on this screen.
 */
export function OrderRowActions({
  order, isAdmin, currency, locale,
}: {
  order: OrderLite;
  isAdmin: boolean;
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const money = makeFormatter(currency, locale);
  const [dialog, setDialog] = useState<'none' | 'settle' | 'cancel' | 'refund'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');

  const isHold = order.status === 'HELD' || order.status === 'DRAFT';
  const isClosed = order.status === 'CANCELLED' || order.status === 'REFUNDED';
  const balance = Math.max(0, order.grandTotal - order.paidTotal);
  const refundable = Math.max(0, order.paidTotal - order.refundedTotal);

  const openWin = (url: string) => window.open(url, '_blank', 'width=420,height=700');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDialog('none');
      setReason('');
      setAmount('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function printKot() {
    setBusy(true);
    try {
      const res = await post<{ batch: number; newItems: number }>(`/api/orders/${order.id}/kot`, {});
      if (res.batch > 0) openWin(`/print/kot/${order.id}?batch=${res.batch}&auto=1&close=1`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The kitchen ticket did not print.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-1 md:justify-end">
        {isHold ? (
          <a className="btn min-h-[40px] flex-1 px-2 text-xs sm:min-h-0 sm:flex-none sm:py-1" href={`/billing?resume=${order.id}`}>
            Resume
          </a>
        ) : (
          <button
            className="btn min-h-[40px] flex-1 px-2 text-xs sm:min-h-0 sm:flex-none sm:py-1"
            onClick={() => openWin(`/print/bill/${order.id}?reprint=1&auto=1&close=1`)}
          >
            Reprint
          </button>
        )}

        {!isHold && (
          /* Opens the slip without firing the printer, so it can be saved as a
             file or sent to the customer. No REPRINT stamp: this copy is not
             going on paper. */
          <button
            className="btn min-h-[40px] flex-1 px-2 text-xs sm:min-h-0 sm:flex-none sm:py-1"
            onClick={() => openWin(`/print/bill/${order.id}`)}
            title="Open the bill to save a PDF or send it on WhatsApp"
          >
            Share
          </button>
        )}

        {!isClosed && (
          <button className="btn min-h-[40px] flex-1 px-2 text-xs sm:min-h-0 sm:flex-none sm:py-1" onClick={printKot} disabled={busy}>
            {order.kotBatches > 0 ? 'KOT again' : 'KOT'}
          </button>
        )}

        {!isClosed && balance > 0 && !isHold && (
          <button className="btn min-h-[40px] flex-1 px-2 text-xs sm:min-h-0 sm:flex-none sm:py-1" onClick={() => setDialog('settle')}>
            Settle
          </button>
        )}

        {!isClosed && (
          <button className="btn-danger min-h-[40px] flex-1 px-2 text-xs sm:min-h-0 sm:flex-none sm:py-1" onClick={() => setDialog('cancel')}>
            Cancel
          </button>
        )}

        {isAdmin && refundable > 0 && order.status !== 'CANCELLED' && (
          <button className="btn-danger min-h-[40px] flex-1 px-2 text-xs sm:min-h-0 sm:flex-none sm:py-1" onClick={() => setDialog('refund')}>
            Refund
          </button>
        )}
      </div>

      {dialog !== 'none' && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => !busy && setDialog('none')}
        >
          <div
            className="max-h-sheet w-full max-w-sm overflow-y-auto rounded-lg bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-base font-semibold">
              {dialog === 'settle' && 'Record payment'}
              {dialog === 'cancel' && 'Cancel this bill'}
              {dialog === 'refund' && 'Refund this bill'}
            </h2>
            <p className="mb-3 text-xs text-ink-mute">
              {order.billNo ?? `Order ${order.orderNo}`} · total {money(order.grandTotal)}
              {dialog === 'settle' && ` · due ${money(balance)}`}
              {dialog === 'refund' && ` · refundable ${money(refundable)}`}
            </p>

            {dialog !== 'cancel' && (
              <>
                <label className="label">Method</label>
                <div className="mb-3 grid grid-cols-3 gap-1">
                  {PAYMENT_METHODS.filter((m) => m !== 'OTHER').map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`min-h-[40px] rounded border text-sm ${
                        method === m ? 'border-primary bg-primary text-white' : 'border-counter-line bg-white'
                      }`}
                    >
                      {PAYMENT_METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
                <label className="label" htmlFor="amt">
                  Amount
                </label>
                <input
                  id="amt"
                  className="field num mb-3"
                  inputMode="decimal"
                  placeholder={String((dialog === 'settle' ? balance : refundable) / 100)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </>
            )}

            {dialog !== 'settle' && (
              <>
                <label className="label" htmlFor="reason">
                  Reason
                </label>
                <input
                  id="reason"
                  className="field mb-3"
                  placeholder={dialog === 'cancel' ? 'Customer left, wrong order…' : 'Wrong item served…'}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
              </>
            )}

            {error && <p className="mb-3 text-xs text-nonveg">{error}</p>}

            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setDialog('none')} disabled={busy}>
                Back
              </button>
              {dialog === 'settle' && (
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      post(`/api/orders/${order.id}/payments`, {
                        payments: [{ method, amount: amount ? parseAmount(amount) : balance }],
                      }),
                    )
                  }
                >
                  {busy ? 'Saving…' : 'Record payment'}
                </button>
              )}
              {dialog === 'cancel' && (
                <button
                  className="btn-danger"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => run(() => post(`/api/orders/${order.id}/cancel`, { reason: reason.trim() }))}
                >
                  {busy ? 'Cancelling…' : 'Cancel bill'}
                </button>
              )}
              {dialog === 'refund' && (
                <button
                  className="btn-danger"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    run(() =>
                      post(`/api/orders/${order.id}/refund`, {
                        amount: amount ? parseAmount(amount) : refundable,
                        method,
                        reason: reason.trim(),
                      }),
                    )
                  }
                >
                  {busy ? 'Refunding…' : 'Refund'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
