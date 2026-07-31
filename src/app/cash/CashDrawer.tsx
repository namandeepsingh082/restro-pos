'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, post, ApiError } from '@/lib/client/api';
import { makeFormatter, parseAmount } from '@/lib/client/format';

interface Txn {
  id: string;
  kind: 'ADD' | 'EXPENSE';
  amount: number;
  note: string;
  createdAt: string;
  createdBy: { name: string };
}

interface OpenSession {
  id: string;
  openingCash: number;
  openedAt: string;
  note: string;
  openedBy: { name: string };
  transactions: Txn[];
  cashSales: number;
  cashAdded: number;
  cashExpenses: number;
  cashRefunds: number;
  expected: number;
}

/**
 * Shift reconciliation.
 *
 *   expected = opening + cash sales + cash added − expenses − cash refunds
 *
 * The difference against what is physically counted is the number the owner
 * actually cares about, so it is the largest thing on the screen.
 */
export function CashDrawer({ currency, locale }: { currency: string; locale: string }) {
  const money = makeFormatter(currency, locale);
  const [session, setSession] = useState<OpenSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [opening, setOpening] = useState('');
  const [txnKind, setTxnKind] = useState<'ADD' | 'EXPENSE'>('EXPENSE');
  const [txnAmount, setTxnAmount] = useState('');
  const [txnNote, setTxnNote] = useState('');
  const [counted, setCounted] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ open: OpenSession | null }>('/api/cash');
      setSession(res.open);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the drawer.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await post('/api/cash', body);
      setTxnAmount('');
      setTxnNote('');
      setOpening('');
      setCounted('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="p-6 text-sm text-ink-mute">Reading the drawer…</p>;

  const difference = session && counted ? parseAmount(counted) - session.expected : 0;

  return (
    <div className="max-w-3xl">
      <h1 className="mb-3 text-lg font-semibold">Cash drawer</h1>

      {error && (
        <p role="alert" className="mb-3 rounded border border-nonveg/40 bg-red-50 px-3 py-2 text-sm text-nonveg">
          {error}
        </p>
      )}

      {!session ? (
        <div className="panel max-w-sm p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-mute">Open the drawer</h2>
          <p className="mb-3 text-sm text-ink-soft">
            Count the float you are starting the shift with and enter it here.
          </p>
          <label className="block">
            <span className="label">Opening cash</span>
            <input
              className="field num"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              autoFocus
            />
          </label>
          <button
            className="btn-primary btn-lg mt-3 w-full"
            disabled={busy || opening === ''}
            onClick={() => act({ action: 'open', openingCash: parseAmount(opening), note: '' })}
          >
            {busy ? 'Opening…' : 'Open drawer'}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
              Since {new Date(session.openedAt).toLocaleTimeString(locale)} · {session.openedBy.name}
            </h2>
            <dl className="num space-y-1 text-sm">
              <Row label="Opening float" value={money(session.openingCash)} />
              <Row label="Cash sales" value={money(session.cashSales)} />
              <Row label="Cash added" value={money(session.cashAdded)} />
              <Row label="Expenses paid out" value={`− ${money(session.cashExpenses)}`} />
              <Row label="Cash refunds" value={`− ${money(session.cashRefunds)}`} />
            </dl>
            <div className="mt-2 flex items-baseline justify-between border-t border-counter-line pt-2">
              <span className="text-sm font-semibold uppercase tracking-wide">Should be in drawer</span>
              <span className="num text-2xl font-bold">{money(session.expected)}</span>
            </div>

            <div className="mt-4">
              <label className="block">
                <span className="label">Counted now</span>
                <input
                  className="field num"
                  inputMode="decimal"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                />
              </label>
              {counted !== '' && (
                <p
                  className={`num mt-2 text-lg font-semibold ${
                    difference === 0 ? 'text-veg' : 'text-nonveg'
                  }`}
                >
                  {difference === 0
                    ? 'Drawer matches.'
                    : difference > 0
                      ? `${money(difference)} over`
                      : `${money(-difference)} short`}
                </p>
              )}
              <button
                className="btn-primary btn-lg mt-2 w-full"
                disabled={busy || counted === ''}
                onClick={() => {
                  if (!window.confirm('Close the drawer for this shift?')) return;
                  void act({ action: 'close', closingCash: parseAmount(counted), note: '' });
                }}
              >
                {busy ? 'Closing…' : 'Close drawer'}
              </button>
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
              Record cash movement
            </h2>
            <div className="mb-2 flex overflow-hidden rounded border border-counter-line">
              {(['EXPENSE', 'ADD'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setTxnKind(k)}
                  className={`flex-1 py-2 text-sm font-medium ${
                    txnKind === k ? 'bg-primary text-white' : 'bg-white hover:bg-counter-deep'
                  }`}
                >
                  {k === 'EXPENSE' ? 'Paid out' : 'Cash added'}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="label">Amount</span>
              <input
                className="field num"
                inputMode="decimal"
                value={txnAmount}
                onChange={(e) => setTxnAmount(e.target.value)}
              />
            </label>
            <label className="mt-2 block">
              <span className="label">What for</span>
              <input
                className="field"
                placeholder={txnKind === 'EXPENSE' ? 'Vegetables, gas cylinder…' : 'Owner top-up'}
                value={txnNote}
                onChange={(e) => setTxnNote(e.target.value)}
              />
            </label>
            <button
              className="btn mt-3 w-full"
              disabled={busy || txnAmount === ''}
              onClick={() =>
                act({ action: 'txn', kind: txnKind, amount: parseAmount(txnAmount), note: txnNote })
              }
            >
              Record
            </button>

            <ul className="mt-4 divide-y divide-counter-line text-sm">
              {session.transactions.length === 0 && (
                <li className="py-2 text-ink-mute">No cash movements yet this shift.</li>
              )}
              {session.transactions.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2 py-1.5">
                  <span className={`chip ${t.kind === 'ADD' ? 'bg-green-50 text-veg' : 'bg-marigold-light text-marigold'}`}>
                    {t.kind === 'ADD' ? 'In' : 'Out'}
                  </span>
                  <span className="flex-1 truncate">{t.note || '—'}</span>
                  <span className="num font-medium">{money(t.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
