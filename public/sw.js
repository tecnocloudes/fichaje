/**
 * Service Worker — empleaIA
 *
 * Ámbito limitado: SOLO recibimos push notifications. NO interceptamos
 * `fetch` ni cacheamos páginas. La interceptación de navegaciones causaba
 * bucles tras login (cache stale + cross-subdomain CORS al rebotar entre
 * app.<root> y <slug>.<root>, p.ej. el SW intentaba cache.match(/admin)
 * y cancelaba la navegación).
 *
 * Cambiamos `CACHE_NAME` de v1 a v3 para que el SW antiguo se invalide y
 * el `activate` borre todos los caches previos al primer load.
 */

const CACHE_NAME = 'empleaia-v3';

self.addEventListener('install', () => {
  // Activar inmediatamente sin esperar a que se cierren las pestañas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Borrar TODOS los caches previos (incluido el v1 que cacheaba /, /login, /offline).
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // Tomar control de las pestañas abiertas inmediatamente.
      await self.clients.claim();
    })(),
  );
});

// Sin listener `fetch` — dejamos que el navegador maneje todas las
// navegaciones y assets de forma normal (el HTTP cache del navegador
// es suficiente y no genera bucles cross-origin).

// ── Push notifications ──────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = { title: 'Nueva notificación', body: '', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
      tag: data.tag || 'empleaia-notification',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.endsWith(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
