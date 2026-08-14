// Minimal service worker for PWA installability.
// This app is read-only and always wants fresh data, so we intentionally
// do NOT cache API/data responses — just pass everything through to the
// network. Having an active service worker with a fetch handler is what
// lets Chrome/Android treat this as an installable app.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
