// Minimal service worker: makes the app installable (share-target eligible
// on Android) and keeps the shell reachable offline. Navigations go
// network-first with a cached-shell fallback; every other request passes
// through untouched — media, API, and OG cards are never intercepted.
const SHELL_CACHE = 'annotated-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add('/')).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  event.respondWith(
    fetch(request).then((response) => {
      if (new URL(request.url).pathname === '/') {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match('/')),
  );
});
