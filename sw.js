/* =====================================================================================
   ShiftManager Pro — Service Worker
   Mette in cache sia l'app shell locale sia le librerie esterne da CDN (Tailwind,
   FontAwesome, Google Fonts, jsPDF, jsPDF-AutoTable), cosi' l'app resta davvero
   utilizzabile anche offline: senza questo secondo pezzo, a connessione assente l'app
   si apriva senza stile e senza possibilita' di generare PDF.
   ===================================================================================== */

const CACHE_NAME = 'shiftmanager-pro-v4';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png'
];

// Host esterni le cui risorse ci servono per far funzionare l'app offline.
// NON aggiungere qui host di dati "vivi" (es. in futuro l'API di Supabase):
// quelli devono sempre passare in rete, mai essere serviti dalla cache.
const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// INSTALL: precarica l'app shell locale in cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE: elimina le cache di versioni precedenti
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Risponde subito dalla cache (se presente) e in parallelo aggiorna la cache dalla rete:
// l'app funziona offline e resta comunque aggiornata alla visita successiva.
function staleWhileRevalidate(request) {
  return caches.match(request).then((cachedResponse) => {
    const networkFetch = fetch(request)
      .then((networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => cachedResponse); // offline e nessuna cache disponibile per questa richiesta

    return cachedResponse || networkFetch;
  });
}

// Serve dalla cache se presente, altrimenti va in rete e mette in cache per la prossima
// volta. Adatto a risorse versionate nell'URL (es. font-awesome/6.4.0, jspdf/2.5.1) che
// non cambiano mai contenuto una volta scaricate: non serve ricontrollare la rete ad ogni
// avvio, a differenza di stale-while-revalidate.
function cacheFirst(request) {
  return caches.match(request).then((cachedResponse) => {
    if (cachedResponse) return cachedResponse;
    return fetch(request).then((networkResponse) => {
      if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
      }
      return networkResponse;
    });
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    // cdn.tailwindcss.com non è versionato nell'URL: meglio ricontrollare la rete
    // ogni volta (stale-while-revalidate) per non restare bloccati su una vecchia
    // build. Le altre risorse CDN qui sotto sono versionate nell'URL stesso.
    if (url.hostname === 'cdn.tailwindcss.com') {
      event.respondWith(staleWhileRevalidate(request));
    } else {
      event.respondWith(cacheFirst(request));
    }
    return;
  }

  // Qualsiasi altra origine (es. in futuro le chiamate API a Supabase) passa dritta
  // in rete, senza mai essere intercettata o messa in cache da questo service worker.
});
