const CACHE_PREFIX = 'gtmann-dispatch-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const APP_SHELL = ['/', '/manifest.webmanifest', '/icons/dispatch.svg'];

function isSensitiveNavigation(url) {
  return ['token', 'access_token', 'invite_token', 'recovery_token', 'confirmation_token', 'code', 'state']
    .some(function (key) { return url.searchParams.has(key); });
}

function isAppAsset(url) {
  return /\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname);
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) {
          return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME;
        }).map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/.netlify/') === 0) return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    if (isSensitiveNavigation(url)) return;
    event.respondWith(
      fetch(request).then(function (response) {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put('/', copy); });
        }
        return response;
      }).catch(function () {
        return caches.match('/').then(function (cached) {
          return cached || Response.error();
        });
      })
    );
    return;
  }

  if (!isAppAsset(url)) return;
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      });
    })
  );
});
