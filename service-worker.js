const CACHE_NAME = 'llm-cache-v1';

// Prepare cache on install so model files can be stored later.
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME));
});

// Take control of clients as soon as possible.
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Cache model artifacts as they are fetched so they are available offline.
self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    if (url.includes('Llama-3.1-8B-Instruct-q4f32_1-MLC')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((resp) => {
                    return resp || fetch(event.request).then((networkResp) => {
                        cache.put(event.request, networkResp.clone());
                        return networkResp;
                    });
                });
            })
        );
    }
});
