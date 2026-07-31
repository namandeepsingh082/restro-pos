'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { put, ApiError } from '@/lib/client/api';
import { parseAmount } from '@/lib/client/format';
import { previewNumber } from '@/lib/numberFormat';

interface SettingsShape {
  name: string;
  logoDataUrl: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  phone: string;
  email: string;
  gstNumber: string;
  fssaiNumber: string;
  receiptFooter: string;
  currency: string;
  locale: string;
  timeZone: string;
  receiptWidth: number;
  defaultTaxPct: number;
  splitTaxOnReceipt: boolean;
  defaultPackagingChg: number;
  defaultDeliveryChg: number;
  roundOffTotals: boolean;
  billNumberFormat: string;
  orderNumberFormat: string;
  kotNumberFormat: string;
  printKotOnSave: boolean;
}

export function SettingsForm({ initial }: { initial: SettingsShape }) {
  const router = useRouter();
  const [form, setForm] = useState<SettingsShape>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const set = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await put('/api/settings', {
        ...form,
        receiptWidth: form.receiptWidth === 58 ? 58 : 80,
        defaultTaxPct: Number(form.defaultTaxPct) || 0,
      });
      setMessage({ tone: 'ok', text: 'Settings saved. New bills use them immediately.' });
      router.refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Settings did not save.' });
    } finally {
      setBusy(false);
    }
  }

  async function pickLogo(file: File) {
    if (file.size > 120_000) {
      setMessage({
        tone: 'error',
        text: 'Use a logo under 120 KB — thermal printers render small monochrome images best.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logoDataUrl', String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div className="max-w-4xl">
      {/* Sticky, because this form is several screens long on a phone: reaching
          the bottom of it and then having to scroll all the way back up to save
          is how half-entered settings get lost. */}
      <div className="sticky top-[52px] z-10 -mx-3 mb-3 flex items-center gap-3 border-b border-counter-line bg-counter/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        <h1 className="mr-auto text-base font-semibold sm:text-lg">Restaurant settings</h1>
        <button className="btn-primary btn-lg shrink-0" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
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

      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
            Printed on every bill
          </h2>
          <div className="space-y-3">
            <Field label="Restaurant name" value={form.name} onChange={(v) => set('name', v)} />
            <Field label="Address line 1" value={form.addressLine1} onChange={(v) => set('addressLine1', v)} />
            <Field label="Address line 2" value={form.addressLine2} onChange={(v) => set('addressLine2', v)} />
            <Field label="City / PIN" value={form.city} onChange={(v) => set('city', v)} />
            <Field label="Phone" value={form.phone} onChange={(v) => set('phone', v)} />
            <Field label="Email" value={form.email} onChange={(v) => set('email', v)} />
            <Field label="GST number" value={form.gstNumber} onChange={(v) => set('gstNumber', v)} />
            <Field label="FSSAI licence" value={form.fssaiNumber} onChange={(v) => set('fssaiNumber', v)} />
            <Field label="Footer line" value={form.receiptFooter} onChange={(v) => set('receiptFooter', v)} />

            <div>
              <span className="label">Logo</span>
              <div className="flex items-center gap-3">
                {form.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoDataUrl} alt="" className="h-10 border border-counter-line bg-white p-1" />
                ) : (
                  <span className="text-xs text-ink-mute">No logo</span>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="text-xs"
                  onChange={(e) => e.target.files?.[0] && pickLogo(e.target.files[0])}
                />
                {form.logoDataUrl && (
                  <button className="btn" onClick={() => set('logoDataUrl', null)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
              Money and tax
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency code" value={form.currency} onChange={(v) => set('currency', v.toUpperCase().slice(0, 3))} />
              <Field label="Locale" value={form.locale} onChange={(v) => set('locale', v)} />
              <Field label="Time zone" value={form.timeZone} onChange={(v) => set('timeZone', v)} />
              <Field
                label="Default tax %"
                value={String(form.defaultTaxPct)}
                numeric
                onChange={(v) => set('defaultTaxPct', Number(v) || 0)}
              />
              <Field
                label="Default packaging"
                value={String(form.defaultPackagingChg / 100)}
                numeric
                onChange={(v) => set('defaultPackagingChg', parseAmount(v))}
              />
              <Field
                label="Default delivery"
                value={String(form.defaultDeliveryChg / 100)}
                numeric
                onChange={(v) => set('defaultDeliveryChg', parseAmount(v))}
              />
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <Check
                label="Round the grand total to the nearest whole unit"
                checked={form.roundOffTotals}
                onChange={(v) => set('roundOffTotals', v)}
              />
              <Check
                label="Print tax as CGST + SGST halves"
                checked={form.splitTaxOnReceipt}
                onChange={(v) => set('splitTaxOnReceipt', v)}
              />
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
              Printing and numbering
            </h2>
            <div className="mb-3">
              <span className="label">Receipt width</span>
              <div className="flex overflow-hidden rounded border border-counter-line">
                {[58, 80].map((w) => (
                  <button
                    key={w}
                    onClick={() => set('receiptWidth', w)}
                    className={`flex-1 py-2 text-sm font-medium ${
                      form.receiptWidth === w ? 'bg-primary text-white' : 'bg-white hover:bg-counter-deep'
                    }`}
                  >
                    {w} mm
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <NumberFormatField
                label="Bill number"
                value={form.billNumberFormat}
                onChange={(v) => set('billNumberFormat', v)}
                timeZone={form.timeZone}
              />
              <NumberFormatField
                label="Order number"
                value={form.orderNumberFormat}
                onChange={(v) => set('orderNumberFormat', v)}
                timeZone={form.timeZone}
              />
              <NumberFormatField
                label="KOT number"
                value={form.kotNumberFormat}
                onChange={(v) => set('kotNumberFormat', v)}
                timeZone={form.timeZone}
              />
            </div>

            <p className="mt-2 text-xs text-ink-mute">
              Tokens: <code>{'{YYYY} {YY} {MM} {DD} {SEQ:4}'}</code>. The counter restarts daily if the
              format contains <code>{'{DD}'}</code>, monthly for <code>{'{MM}'}</code>, yearly for{' '}
              <code>{'{YY}'}</code>.
            </p>

            <div className="mt-3 text-sm">
              <Check
                label="Print the kitchen ticket automatically with every bill"
                checked={form.printKotOnSave}
                onChange={(v) => set('printKotOnSave', v)}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className={`field ${numeric ? 'num' : ''}`}
        inputMode={numeric ? 'decimal' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Check({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumberFormatField({
  label, value, onChange, timeZone,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  timeZone: string;
}) {
  let preview = '';
  try {
    preview = previewNumber(value, 42, timeZone);
  } catch {
    preview = 'invalid';
  }
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="num mt-0.5 block text-xs text-ink-mute">Next looks like: {preview}</span>
    </label>
  );
}
