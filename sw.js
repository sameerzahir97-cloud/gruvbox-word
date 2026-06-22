// sw.js — offline-first service worker for Gruvbox Word.
// Bump CACHE whenever the ASSETS list changes. Content updates propagate on their own via
// the stale-while-revalidate fetch handler below (no per-deploy bump needed for edits).
const CACHE = "gruvbox-word-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./assets/css/app.css",
  "./assets/js/app.js",
  "./assets/js/editor.js",
  "./assets/js/markdown.js",
  "./assets/js/storage.js",
  "./assets/js/export.js",
  "./assets/js/history.js",
  "./assets/fonts/JetBrainsMonoNerd-Regular.woff2",
  "./assets/fonts/JetBrainsMonoNerd-Bold.woff2",
  "./assets/fonts/JetBrainsMonoNerd-Italic.woff2",
  "./assets/fonts/JetBrainsMonoNerd-BoldItalic.woff2",
  "./assets/icons/favicon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GETs: serve the cached copy instantly, refresh it
// from the network in the background so the next load gets the latest. Falls back to the
// app shell for navigations when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await network) || (e.request.mode === "navigate" ? cache.match("./index.html") : Response.error());
    })
  );
});
