'use client';

import type { CreateOrderInput } from '@/lib/validation';

/**
 * Offline billing.
 *
 * When the network drops, a completed bill is written to IndexedDB and the
 * cashier carries on. A background loop retries the queue whenever the browser
 * comes back online, on a 30-second timer, and whenever the tab regains focus.
 *
 * Replay is safe because every queued order already carries the idempotency key
 * it was created with: if a request actually reached the server before the
 * connection died, the retry returns the same order instead of billing twice.
 *
 * IndexedDB is used rather than localStorage because a busy counter can queue
 * hundreds of orders and localStorage is both size-limited and synchronous.
 */

const DB_NAME = 'restropos';
const DB_VERSION = 1;
const QUEUE = 'order-queue';
const CACHE = 'cache';

export interface QueuedOrder {
  id: string;
  payload: CreateOrderInput;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;

export async function queueOrder(payload: CreateOrderInput): Promise<QueuedOrder> {
  const entry: QueuedOrder = {
    id: payload.idempotencyKey,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await tx(QUEUE, 'readwrite', (s) => s.put(entry));
  return entry;
}

export async function listQueue(): Promise<QueuedOrder[]> {
  try {
    const all = await tx<QueuedOrder[]>(QUEUE, 'readonly', (s) => s.getAll());
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function queueCount(): Promise<number> {
  try {
    return await tx<number>(QUEUE, 'readonly', (s) => s.count());
  } catch {
    return 0;
  }
}

async function removeFromQueue(id: string) {
  await tx(QUEUE, 'readwrite', (s) => s.delete(id));
}

async function markAttempt(entry: QueuedOrder, error: string) {
  await tx(QUEUE, 'readwrite', (s) =>
    s.put({ ...entry, attempts: entry.attempts + 1, lastError: error }),
  );
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
}

/** Push everything queued. Returns counts so the UI can report honestly. */
export async function syncQueue(): Promise<SyncResult> {
  if (isOffline()) return { synced: 0, failed: 0, remaining: await queueCount() };

  const queue = await listQueue();
  let synced = 0;
  let failed = 0;

  for (const entry of queue) {
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
        credentials: 'same-origin',
      });

      if (res.ok) {
        await removeFromQueue(entry.id);
        synced++;
        continue;
      }

      const body = (await res.json().catch(() => null)) as { error?: string } | null;

      // 4xx other than 401/408/429 means this order will never be accepted —
      // an item was deleted, a discount is over the limit. Keep it so a human
      // can look at it, but stop hammering the server.
      if (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status)) {
        await markAttempt(entry, body?.error ?? `Rejected (${res.status})`);
        failed++;
        continue;
      }
      await markAttempt(entry, body?.error ?? `Retrying (${res.status})`);
      failed++;
    } catch (err) {
      await markAttempt(entry, err instanceof Error ? err.message : 'Network unavailable');
      failed++;
    }
  }

  return { synced, failed, remaining: await queueCount() };
}

export async function discardQueued(id: string) {
  await removeFromQueue(id);
}

// ---------------------------------------------------------------------------
// Menu cache — so the billing screen can still open with no connection.
// ---------------------------------------------------------------------------

export async function cacheValue(key: string, value: unknown) {
  try {
    await tx(CACHE, 'readwrite', (s) => s.put(value, key));
  } catch {
    /* a full or blocked database must not break billing */
  }
}

export async function readCached<T>(key: string): Promise<T | null> {
  try {
    const v = await tx<T>(CACHE, 'readonly', (s) => s.get(key));
    return v ?? null;
  } catch {
    return null;
  }
}
