// The service worker for the installed game (04 §11.5). Its one job is that the game on a home screen
// is always the newest playtest, and still opens with no signal.
//
// Network first, every time: each request for one of the site's own files goes to the network,
// revalidating past the host's ten-minute cache (GitHub Pages), so a playtest is live on the next
// launch. When it arrives, a copy is kept. The copy is used only when the network can't answer:
// offline, a server error, or nothing after PATIENCE_MS on a hopeless connection (the download
// carries on, and the game says a new version is ready once it has it). Never cache-first: that
// would keep an installed game on an old version.
//
// Other hosts (Firebase, the visit counter) and anything but GET are left to the browser. A path
// with no file name and no trailing slash (/TitlePush) is too: the host redirects it, and a
// redirected response can't answer a page load.
//
// The file has no version in it on purpose: it only changes when this logic does, so a new
// playtest doesn't reinstall it.

const CACHE = 'title-push';
const PATIENCE_MS = 6000;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!/(\/|\.[a-z0-9]+)$/i.test(url.pathname)) return;
  // one copy per file: ?friend=… and ?join=… open the same page
  const key = url.origin + url.pathname;
  const network = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
  // keep a copy of what arrives, even if the cached one is served first (the next launch has it)
  const kept = network.then((response) => {
    if (!response.ok || response.redirected) return undefined;
    const copy = response.clone();
    return caches.open(CACHE).then((cache) => cache.put(key, copy));
  });
  event.waitUntil(kept.catch(() => undefined));
  event.respondWith(answer(key, network));
});

/** The network's answer; the kept copy if it fails, errs or takes too long. */
async function answer(key, network) {
  const cached = await caches.match(key);
  if (!cached) return network;
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(cached), PATIENCE_MS);
  });
  try {
    const response = await Promise.race([network, late]);
    return response.status >= 500 ? cached : response;
  } catch {
    return cached;
  } finally {
    clearTimeout(timer);
  }
}
