const CACHE_NAME = 'rebot-arm-sort-v1-20261014';
const APP_SHELL = [
  '/',
  '/index.html',
  '/apps/rebot-arm/manifest.webmanifest',
  '/apps/rebot-arm/favicon.png',
  '/apps/rebot-arm/css/rebot-sim.css?v=20261014-track23',
  '/apps/rebot-arm/js/pwa.js?v=20261014-track23',
  '/apps/rebot-arm/js/i18n.js?v=20261014-track23',
  '/apps/rebot-arm/js/rebot-sim.js?v=20261014-track23',
  '/apps/rebot-arm/js/rebot-task.js?v=20261014-track23',
  '/apps/rebot-arm/lib/three-r128.min.js',
  '/apps/rebot-arm/lib/STLLoader-umd.js',
  '/apps/rebot-arm/lib/URDFLoader.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/apps/rebot-arm/')) {
    event.respondWith(fetch(request).catch(function () {
      return new Response('{"error":"network error"}', {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }));
    return;
  }

  const isControlAsset = request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');

  if (isControlAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('/index.html');
          return Response.error();
        }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
