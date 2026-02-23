const CACHE_NAME = 'llm-cache-v2';

// Prepare cache on install so model files can be stored later.
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME));
});

// Take control of clients as soon as possible.
self.addEventListener('activate', (event) => {
    // Purge caches from older versions
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Cache model weights and WebLLM library files as they are fetched,
// so subsequent page loads (and offline use) are instant.
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Match model shards and the WebLLM CDN library
    const shouldCache =
        url.includes('Llama-3.1-8B-Instruct-q4f16_1-MLC') ||
        url.includes('web-llm') ||
        url.includes('mlc-ai');

    if (shouldCache) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) =>
                cache.match(event.request).then((cached) => {
                    if (cached) return cached;
                    return fetch(event.request).then((networkResp) => {
                        cache.put(event.request, networkResp.clone());
                        return networkResp;
                    });
                })
            )
        );
    }
});
