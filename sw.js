/*
 * PWA cache strategy for static hosting.
 * The app shell is cached on installation; same-origin assets are cached as visited.
 * Individual lesson resources can be pinned explicitly with the CACHE_URLS message.
 */
const VERSION = 'interactive-learning-v4';
const SHELL_CACHE = `${VERSION}-shell`;
const LESSON_CACHE = `${VERSION}-lessons`;
const PRECACHE_ASSETS = /*__PRECACHE_ASSETS__*/[];
const scopeUrl = self.registration.scope;
const inScope = (path) => new URL(path, scopeUrl).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const essential = [...new Set([inScope('index.html'), inScope('manifest.webmanifest'), inScope('lessons/index.json'), ...PRECACHE_ASSETS.map(inScope)])];
    await Promise.all(essential.map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch (_) {
        // The core shell remains installable on the next successful online visit.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('interactive-learning-') && ![SHELL_CACHE, LESSON_CACHE].includes(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type !== 'CACHE_URLS' || !Array.isArray(message.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(LESSON_CACHE);
    const results = await Promise.all(message.urls.map(async (value) => {
      try {
        const url = new URL(value, scopeUrl);
        if (url.origin !== self.location.origin) return { url: value, ok: false, reason: 'cross-origin' };
        const response = await fetch(url.href, { cache: 'reload' });
        if (!response.ok) return { url: value, ok: false, reason: `HTTP ${response.status}` };
        await cache.put(url.href, response.clone());
        return { url: value, ok: true };
      } catch (error) {
        return { url: value, ok: false, reason: String(error) };
      }
    }));
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ results });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Public external media can be cached by the lesson download button for offline use.
    if (url.hostname === 'www.googleapis.com' && /\/drive\/v3\/files\//.test(url.pathname)) {
      event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          try { await (await caches.open(LESSON_CACHE)).put(request, response.clone()); } catch (_) {}
        }
        return response;
      })());
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(inScope('index.html'), response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) || (await caches.match(inScope('index.html')));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      // Refresh in the background while retaining offline availability.
      event.waitUntil(fetch(request).then(async (response) => {
        if (response.ok) {
          const target = url.pathname.includes('/lessons/') ? LESSON_CACHE : SHELL_CACHE;
          await (await caches.open(target)).put(request, response.clone());
        }
      }).catch(() => {}));
      return cached;
    }
    try {
      const response = await fetch(request);
      if (response.ok) {
        const target = url.pathname.includes('/lessons/') ? LESSON_CACHE : SHELL_CACHE;
        await (await caches.open(target)).put(request, response.clone());
      }
      return response;
    } catch (_) {
      return new Response('هذا الملف غير محفوظ على الجهاز بعد. اتصل بالإنترنت ثم نزّل الدرس.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
