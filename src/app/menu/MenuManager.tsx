'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, patch, apiFetch, ApiError } from '@/lib/client/api';
import { makeFormatter, parseAmount } from '@/lib/client/format';

export interface AdminVariant { id?: string; name: string; price: number; active: boolean }
export interface AdminAddOn { id?: string; name: string; price: number; active: boolean }

export interface AdminItem {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName: string;
  price: number;
  taxPct: number | null;
  isVeg: boolean;
  available: boolean;
  enabled: boolean;
  prepArea: string | null;
  variants: AdminVariant[];
  addOns: AdminAddOn[];
}

export interface AdminCategory {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  prepArea: string | null;
  itemCount: number;
}

type Draft = Omit<AdminItem, 'id' | 'categoryName'> & { id?: string };

const blankDraft = (categoryId: string, defaultTaxPct: number): Draft => ({
  code: '',
  name: '',
  description: '',
  categoryId,
  price: 0,
  taxPct: defaultTaxPct,
  isVeg: true,
  available: true,
  enabled: true,
  prepArea: null,
  variants: [],
  addOns: [],
});

export function MenuManager({
  categories, items, currency, locale, defaultTaxPct,
}: {
  categories: AdminCategory[];
  items: AdminItem[];
  currency: string;
  locale: string;
  defaultTaxPct: number;
}) {
  const router = useRouter();
  const money = useMemo(() => makeFormatter(currency, locale), [currency, locale]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<'items' | 'categories'>('items');
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [newCategory, setNewCategory] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (filter !== 'ALL' && i.categoryId !== filter) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q);
    });
  }, [items, filter, query]);

  async function run(fn: () => Promise<unknown>, okText?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (okText) setMessage({ tone: 'ok', text: okText });
      router.refresh();
      return true;
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'That change did not save.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const toggle = (item: AdminItem, field: 'available' | 'enabled') =>
    run(() => patch(`/api/menu/items/${item.id}`, { [field]: !item[field] }));

  async function saveDraft() {
    if (!draft) return;
    const body = {
      ...draft,
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      variants: draft.variants.filter((v) => v.name.trim()),
      addOns: draft.addOns.filter((a) => a.name.trim()),
    };
    const okay = await run(
      () => (draft.id ? patch(`/api/menu/items/${draft.id}`, body) : post('/api/menu/items', body)),
      draft.id ? 'Item updated.' : 'Item added.',
    );
    if (okay) setDraft(null);
  }

  async function importCsv(file: File) {
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ created: number; updated: number; skipped: string[] }>(
        '/api/menu/import',
        { method: 'POST', body: form },
      );
      setMessage({
        tone: res.skipped.length ? 'error' : 'ok',
        text:
          `${res.created} added, ${res.updated} updated` +
          (res.skipped.length ? ` · ${res.skipped.length} skipped: ${res.skipped.slice(0, 3).join(' ')}` : '.'),
      });
      router.refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'The file could not be read.' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Menu</h1>

        <div className="flex gap-1">
          {(['items', 'categories'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 text-sm font-medium capitalize ${
                tab === t ? 'bg-primary text-white' : 'bg-white text-ink-soft hover:bg-counter-deep'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <a className="btn" href="/api/menu/export">
          Export CSV
        </a>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
        />
        <button
          className="btn-primary"
          onClick={() => setDraft(blankDraft(categories[0]?.id ?? '', defaultTaxPct))}
          disabled={categories.length === 0}
        >
          Add item
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

      {tab === 'items' ? (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            <input
              className="field w-56"
              placeholder="Search name or code"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="field w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ALL">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.itemCount})
                </option>
              ))}
            </select>
            <span className="self-center text-xs text-ink-mute">{visible.length} items</span>
          </div>

          {/* Same pattern as the Orders list: cards on a phone, aligned columns
              from `md` up. Marking a dish out of stock is the one thing an owner
              does from a phone mid-service, and in the old table that toggle sat
              off the right edge behind a sideways scroll. */}
          <div className="hidden md:grid md:grid-cols-menu md:items-center md:gap-3 md:px-3 md:py-2 md:[&>*]:min-w-0">
            <span className="th px-0">Code</span>
            <span className="th px-0">Item</span>
            <span className="th px-0">Category</span>
            <span className="th px-0 text-right">Price</span>
            <span className="th px-0 text-right">Tax</span>
            <span className="th px-0">Sizes</span>
            <span className="th px-0">In stock</span>
            <span className="th px-0">On menu</span>
            <span className="th px-0 text-right">Edit</span>
          </div>

          {visible.length === 0 && (
            <p className="panel p-10 text-center text-sm text-ink-mute">
              No items here yet. Add one, or import your existing menu as CSV.
            </p>
          )}

          <ul className="space-y-2 md:space-y-1">
            {visible.map((i) => (
              <li
                key={i.id}
                className={`card-row grid gap-2 md:grid-cols-menu md:items-center md:gap-3 md:rounded md:py-2 md:shadow-none md:[&>*]:min-w-0 ${
                  i.enabled ? '' : 'opacity-60'
                }`}
              >
                <span className="num hidden text-xs md:block">{i.code}</span>

                <div>
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center border ${
                        i.isVeg ? 'border-veg' : 'border-nonveg'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${i.isVeg ? 'bg-veg' : 'bg-nonveg'}`} />
                    </span>
                    <span className="text-sm font-medium">{i.name}</span>
                    <span className="num text-xs text-ink-mute md:hidden">{i.code}</span>
                  </span>
                  {i.description && (
                    <span className="block text-xs text-ink-mute">{i.description}</span>
                  )}
                </div>

                <span className="hidden text-xs md:block">{i.categoryName}</span>

                {/* On a phone one line carries category, price, tax and sizes —
                    the four things you read but never tap. */}
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-mute md:contents">
                  <span className="md:hidden">{i.categoryName}</span>
                  <span className="num text-sm font-semibold text-ink md:text-right">
                    {money(i.price)}
                  </span>
                  <span className="num md:text-right">
                    {i.taxPct === null ? `${defaultTaxPct}%*` : `${i.taxPct}%`}
                    {/* The word only earns its place where there is no column
                        header above it to say the same thing. */}
                    <span className="md:hidden"> tax</span>
                  </span>
                  <span className="md:hidden">
                    {i.variants.length ? i.variants.map((v) => v.name).join(', ') : ''}
                  </span>
                </div>

                <span className="hidden text-xs md:block">
                  {i.variants.length ? i.variants.map((v) => v.name).join(', ') : '—'}
                </span>

                {/* The two toggles and Edit share a row on a phone, at full
                    thumb height. */}
                <div className="flex gap-2 border-t border-counter-line pt-2 md:contents md:border-0 md:pt-0">
                  <button
                    className={`chip min-h-[40px] flex-1 justify-center border px-2 md:min-h-0 md:flex-none md:py-1 ${
                      i.available
                        ? 'border-veg/40 bg-green-50 text-veg'
                        : 'border-nonveg/40 bg-red-50 text-nonveg'
                    }`}
                    onClick={() => toggle(i, 'available')}
                    disabled={busy}
                  >
                    {i.available ? 'In stock' : 'Out of stock'}
                  </button>
                  <button
                    className={`chip min-h-[40px] flex-1 justify-center border px-2 md:min-h-0 md:flex-none md:py-1 ${
                      i.enabled ? 'border-counter-line bg-white' : 'border-nonveg/40 bg-red-50 text-nonveg'
                    }`}
                    onClick={() => toggle(i, 'enabled')}
                    disabled={busy}
                  >
                    {i.enabled ? 'Live' : 'Hidden'}
                  </button>
                  <button
                    className="btn min-h-[40px] flex-1 px-2 text-xs md:min-h-0 md:flex-none md:justify-self-end md:py-1"
                    onClick={() =>
                      setDraft({
                        id: i.id, code: i.code, name: i.name, description: i.description,
                        categoryId: i.categoryId, price: i.price, taxPct: i.taxPct,
                        isVeg: i.isVeg, available: i.available, enabled: i.enabled,
                        prepArea: i.prepArea,
                        variants: i.variants.map((v) => ({ ...v })),
                        addOns: i.addOns.map((a) => ({ ...a })),
                      })
                    }
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-mute">
            * uses the default tax rate from Settings. “Out” hides an item from billing for the rest of
            the day; “Hidden” takes it off the menu entirely. Neither affects past bills.
          </p>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">Categories</h2>
            <ul className="divide-y divide-counter-line">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2">
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="num text-xs text-ink-mute">{c.itemCount} items</span>
                  {c.prepArea && <span className="chip bg-counter-deep text-ink-soft">{c.prepArea}</span>}
                  <button
                    className={`chip border px-2 py-1 ${
                      c.active ? 'border-counter-line bg-white' : 'border-nonveg/40 bg-red-50 text-nonveg'
                    }`}
                    disabled={busy}
                    onClick={() => run(() => patch(`/api/menu/categories/${c.id}`, { active: !c.active }))}
                  >
                    {c.active ? 'Shown' : 'Hidden'}
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex gap-2">
              <input
                className="field"
                placeholder="New category name"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <button
                className="btn-primary"
                disabled={busy || !newCategory.trim()}
                onClick={async () => {
                  const okay = await run(
                    () =>
                      post('/api/menu/categories', {
                        name: newCategory.trim(),
                        sortOrder: categories.length + 1,
                      }),
                    'Category added.',
                  );
                  if (okay) setNewCategory('');
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div className="panel p-4 text-sm text-ink-soft">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-mute">
              CSV format
            </h2>
            <p className="mb-2">
              Import matches rows to existing items by <code>code</code>, so exporting, editing prices in
              Excel and importing again is a safe round trip.
            </p>
            <pre className="overflow-x-auto rounded bg-counter p-3 text-xs">
{`code,name,category,price,tax_pct,veg,available,enabled,prep_area,description,variants,addons
ST01,Paneer Tikka,Starters,260.00,5,veg,yes,yes,Tandoor,,Half:150|Full:260,Extra Chutney:20`}
            </pre>
            <p className="mt-2 text-xs">
              Only <code>code</code>, <code>name</code>, <code>category</code> and <code>price</code> are
              required. Unknown categories are created automatically.
            </p>
          </div>
        </div>
      )}

      {/* ---------------- item editor ---------------- */}
      {draft && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-4">
            <h2 className="mb-3 text-base font-semibold">{draft.id ? 'Edit item' : 'New item'}</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="label">Item name</span>
                <input
                  className="field"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoFocus
                />
              </label>
              <label>
                <span className="label">Item code</span>
                <input
                  className="field uppercase"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  placeholder="ST01"
                />
              </label>
              <label>
                <span className="label">Category</span>
                <select
                  className="field"
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Price</span>
                <input
                  className="field num"
                  inputMode="decimal"
                  value={draft.price ? String(draft.price / 100) : ''}
                  onChange={(e) => setDraft({ ...draft, price: parseAmount(e.target.value) })}
                />
              </label>
              <label>
                <span className="label">Tax percent (blank = default {defaultTaxPct}%)</span>
                <input
                  className="field num"
                  inputMode="numeric"
                  value={draft.taxPct === null ? '' : String(draft.taxPct)}
                  onChange={(e) =>
                    setDraft({ ...draft, taxPct: e.target.value === '' ? null : Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label>
                <span className="label">Kitchen / prep area</span>
                <input
                  className="field"
                  value={draft.prepArea ?? ''}
                  placeholder="Tandoor, Bar, Counter…"
                  onChange={(e) => setDraft({ ...draft, prepArea: e.target.value || null })}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="label">Description (printed nowhere, shown to staff)</span>
                <input
                  className="field"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.isVeg}
                  onChange={() => setDraft({ ...draft, isVeg: true })}
                />
                Vegetarian
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!draft.isVeg}
                  onChange={() => setDraft({ ...draft, isVeg: false })}
                />
                Non-vegetarian
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.available}
                  onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
                />
                In stock
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                Show on menu
              </label>
            </div>

            {/* variants */}
            <EditableRows
              title="Sizes / variants"
              hint="Add Half and Full, or Small / Medium / Large. When an item has sizes, the base price is ignored."
              rows={draft.variants}
              onChange={(variants) => setDraft({ ...draft, variants })}
              placeholder="Half"
            />

            {/* add-ons */}
            <EditableRows
              title="Add-ons"
              hint="Optional extras the cashier can tick while billing."
              rows={draft.addOns}
              onChange={(addOns) => setDraft({ ...draft, addOns })}
              placeholder="Extra butter"
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              {draft.id && (
                <button
                  className="btn-danger mr-auto"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm('Remove this item from the menu?')) return;
                    const okay = await run(
                      () => apiFetch(`/api/menu/items/${draft.id}`, { method: 'DELETE' }),
                      'Item removed. Items that appear on past bills are hidden instead of deleted.',
                    );
                    if (okay) setDraft(null);
                  }}
                >
                  Delete
                </button>
              )}
              <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={saveDraft}
                disabled={busy || !draft.name.trim() || !draft.code.trim()}
              >
                {busy ? 'Saving…' : 'Save item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EditableRows({
  title, hint, rows, onChange, placeholder,
}: {
  title: string;
  hint: string;
  rows: { id?: string; name: string; price: number; active: boolean }[];
  onChange: (rows: { id?: string; name: string; price: number; active: boolean }[]) => void;
  placeholder: string;
}) {
  return (
    <div className="mt-4">
      <span className="label mb-0">{title}</span>
      <p className="mb-2 text-xs text-ink-mute">{hint}</p>
      <div className="space-y-1">
        {rows.map((r, idx) => (
          <div key={r.id ?? idx} className="flex gap-2">
            <input
              className="field flex-1"
              value={r.name}
              placeholder={placeholder}
              onChange={(e) => onChange(rows.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className="field num w-28"
              inputMode="decimal"
              value={r.price ? String(r.price / 100) : ''}
              placeholder="0.00"
              onChange={(e) =>
                onChange(rows.map((x, i) => (i === idx ? { ...x, price: parseAmount(e.target.value) } : x)))
              }
            />
            <button className="btn" onClick={() => onChange(rows.filter((_, i) => i !== idx))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        className="btn mt-1"
        onClick={() => onChange([...rows, { name: '', price: 0, active: true }])}
      >
        Add row
      </button>
    </div>
  );
}
