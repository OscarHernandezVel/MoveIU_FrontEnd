// Service worker de MoveIU: hace la app instalable y guarda la última versión de la interfaz para abrirla sin
// conexión. Los datos en vivo (/api, /ws) nunca se guardan: siempre van a la red.
const CACHE = "moveiu-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const live = url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/");
  if (request.method !== "GET" || url.origin !== self.location.origin || live) return;
  // Primero la red (siempre la versión publicada); la copia guardada solo si no hay conexión.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./"))),
  );
});
