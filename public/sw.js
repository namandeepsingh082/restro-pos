/* eslint-disable no-restricted-globals */
/**
 * Service worker.
 *
 * Caching policy, deliberately conservative — a POS must never show a stale
 * price or a stale total:
 *   - static build assets  : cache first (they are content-hashed)
 *   - navigations          : network first, fall back to cache, then /offline
 *   - GET /api/*           : network first, fall back to the last good response
 *   - POST/PATCH/DELETE    : never touched. The page queues writes in IndexedDB
 *                            and replays them itself, because only the page
 *                            knows the idempotency key.
 */

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const DATA = `data-${VERSION}`;

const SHELL_URLS = ['/offline', '/billing', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_URLS).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallbackUrl) {
      const shell = await caches.open(SHELL);
      const off = await shell.match(fallbackUrl);
      if (off) return off;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache a print view — the bill must always be the live record.
  if (url.pathname.startsWith('/print/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, '/offline'));
  }
});
