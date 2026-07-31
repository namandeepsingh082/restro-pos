'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, patch, ApiError } from '@/lib/client/api';
import { makeFormatter, parseAmount } from '@/lib/client/format';

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'ADMIN' | 'CASHIER';
  maxDiscountPct: number;
  maxDiscountAmt: number;
  active: boolean;
  orders: number;
  lastLoginAt: string | null;
}

type Draft = Omit<StaffRow, 'orders' | 'lastLoginAt' | 'id'> & { id?: string; password: string };

const blank = (): Draft => ({
  name: '', email: '', phone: '', role: 'CASHIER',
  maxDiscountPct: 10, maxDiscountAmt: 10000, active: true, password: '',
});

/**
 * Staff accounts and, importantly, each cashier's discount ceiling — the one
 * control that decides how much of the till a counter can give away without
 * asking the owner.
 */
export function StaffManager({
  rows, currency, locale,
}: {
  rows: StaffRow[];
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const money = makeFormatter(currency, locale);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim() || undefined,
        role: draft.role,
        maxDiscountPct: draft.maxDiscountPct,
        maxDiscountAmt: draft.maxDiscountAmt,
        active: draft.active,
        ...(draft.password ? { password: draft.password } : {}),
      };
      if (draft.id) await patch(`/api/users/${draft.id}`, body);
      else await post('/api/users', body);
      setMessage({ tone: 'ok', text: draft.id ? 'Account updated.' : 'Account created.' });
      setDraft(null);
      router.refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'That did not save.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="mr-auto text-lg font-semibold">Staff</h1>
        <button className="btn-primary" onClick={() => setDraft(blank())}>
          Add staff
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={`mb-3 rounded border px-3 py-2 text-sm ${
            message.tone === 'ok' ? 'border-veg/40 bg-green-50 text-veg' : 'border-nonveg/40 bg-red-50 text-nonveg'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="panel scroll-x">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-counter-line bg-counter">
            <tr>
              <th className="th">Name</th>
              <th className="th">Email</th>
              <th className="th">Role</th>
              <th className="th text-right">Discount limit</th>
              <th className="th text-right">Bills</th>
              <th className="th">Status</th>
              <th className="th text-right">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-counter-line">
            {rows.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                <td className="td font-medium">{u.name}</td>
                <td className="td text-xs">{u.email}</td>
                <td className="td">
                  <span className={`chip ${u.role === 'ADMIN' ? 'bg-primary-light text-primary' : 'bg-counter-deep text-ink-soft'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="td num text-right text-xs">
                  {u.role === 'ADMIN' ? 'No limit' : `${u.maxDiscountPct}% / ${money(u.maxDiscountAmt)}`}
                </td>
                <td className="td num text-right">{u.orders}</td>
                <td className="td">
                  <span className={`chip ${u.active ? 'bg-green-50 text-veg' : 'bg-red-50 text-nonveg'}`}>
                    {u.active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="td text-right">
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={() =>
                      setDraft({
                        id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
                        maxDiscountPct: u.maxDiscountPct, maxDiscountAmt: u.maxDiscountAmt,
                        active: u.active, password: '',
                      })
                    }
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h2 className="mb-3 text-base font-semibold">{draft.id ? 'Edit account' : 'New account'}</h2>

            <div className="space-y-3">
              <label className="block">
                <span className="label">Name</span>
                <input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
              </label>
              <label className="block">
                <span className="label">Email (used to sign in)</span>
                <input className="field" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Phone</span>
                <input className="field" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">{draft.id ? 'New password (leave blank to keep)' : 'Password'}</span>
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                />
                <span className="mt-0.5 block text-xs text-ink-mute">
                  At least 8 characters, with a letter and a number.
                </span>
              </label>
              <label className="block">
                <span className="label">Role</span>
                <select
                  className="field"
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value as Draft['role'] })}
                >
                  <option value="CASHIER">Cashier</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>

              {draft.role === 'CASHIER' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="label">Max discount %</span>
                    <input
                      className="field num"
                      inputMode="numeric"
                      value={String(draft.maxDiscountPct)}
                      onChange={(e) => setDraft({ ...draft, maxDiscountPct: Number(e.target.value) || 0 })}
                    />
                  </label>
                  <label className="block">
                    <span className="label">Max discount amount</span>
                    <input
                      className="field num"
                      inputMode="decimal"
                      value={String(draft.maxDiscountAmt / 100)}
                      onChange={(e) => setDraft({ ...draft, maxDiscountAmt: parseAmount(e.target.value) })}
                    />
                  </label>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                Account can sign in
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={save}
                disabled={busy || !draft.name.trim() || !draft.email.trim() || (!draft.id && !draft.password)}
              >
                {busy ? 'Saving…' : 'Save account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
