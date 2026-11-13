const CACHE_NAME = 'peo-pdf-helper-v1.6.2';
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './img/logo.png',
    './lib/pdf.min.js',
    './lib/pdf.worker.min.js',
    './lib/pdf-lib.min.js',
    './lib/fontkit.umd.js',
    './lib/Sortable.min.js',
    './fonts/THSARABUNNEW.TTF',
    './fonts/THSARABUNNEWBOLD.TTF',
    './fonts/THSARABUNNEWITALIC.TTF',
    './fonts/THSARABUNNEWBOLDITALIC.TTF'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    const isNavigation = event.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');

    if (isNavigation) {
        // Network-first for HTML so online updates appear immediately, fallback to cache offline
        event.respondWith(
            fetch(event.request)
                .then((res) => {
                    if (res && res.ok) {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return res;
                })
                .catch(() => caches.match(event.request).then((c) => c || caches.match('./index.html')))
        );
        return;
    }

    // Cache-first for pinned libraries, fonts, and images
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((res) => {
                if (res && res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return res;
            });
        })
    );
});
