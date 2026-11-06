// Service worker: keeps a copy of the app on the device so it opens with no connection (offline
// practice, ui/offline.js). Served at <app>/sw.js (server.js), so its scope is the whole app, e.g. /quiz/.
//
// Network first, always: with a connection you get the current code (a deploy shows up on the next
// load, never a stale copy). The cache is only the fallback, used when the network fails or is too
// slow (bad signal). API calls are never cached here: the offline page keeps its own data.
const CACHE = 'quiz-shell-v1';
const SLOW_MS = 4000;   // after this long, answer from the cache (the network copy still refreshes it)

// The app shell: the page, the shared CSS, and the modules index.html loads.
const SHELL = ['./', 'ui/base.css', 'ui/icons.js', 'ui/prefs.js', 'ui/app/manifest.json', 'ui/app/icon-192.png', 'ui/app/apple-touch-icon.png',
  ...['think', 'mcq', 'practice', 'map', 'lab', 'board', 'live', 'handsfree', 'materials', 'teach', 'tolearn', 'home', 'offline', 'settings'].map((n) => `ui/${n}.js`)];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const scope = new URL(self.registration.scope);
// What's worth keeping: the page itself, ui/*.js|css, the app icons, and the answer views. Not the API,
// not the big vendored libraries (Excalidraw, xterm: lessons need the server anyway).
function cacheable(url) {
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false;
  const rel = url.pathname.slice(scope.pathname.length);
  return rel === '' || /^ui\/[\w-]+\.(js|css)$/.test(rel) || /^ui\/app\//.test(rel) || /^views\/[\w-]+\.js$/.test(rel);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const page = req.mode === 'navigate';
  if (!page && !cacheable(url)) return;   // the browser handles it as usual
  // Pages are stored under the app's root URL, whatever query (?tab=…) they were opened with.
  const key = page ? new Request(scope.href) : req;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(req).then((res) => {
      if (res.ok && (page ? url.pathname === scope.pathname : true)) cache.put(key, res.clone()).catch(() => {});
      return res;
    });
    fromNet.catch(() => {});
    const slow = new Promise((ok) => setTimeout(() => ok('slow'), SLOW_MS));
    try {
      const first = await Promise.race([fromNet, slow]);
      if (first !== 'slow') return first;
      const hit = await cache.match(key, { ignoreSearch: page });
      return hit || await fromNet;
    } catch {
      const hit = await cache.match(key, { ignoreSearch: page });
      if (hit) return hit;
      return new Response('Offline, and this page was never saved on this device.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
