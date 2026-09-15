const CACHE_NAME = 'nastel-v1-customer-push-ready';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase, CDN, remote menu images/music, and every cross-origin request
  // stay network-only so realtime/order/auth data is never served from SW cache.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});


self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {
      title: 'Warkop Nastel',
      body: event.data ? event.data.text() : 'Ada update baru.'
    };
  }

  const data = payload.data || {};
  const notice = {
    audience: data.audience || payload.audience || 'staff',
    eventType: data.eventType || payload.eventType || 'event',
    orderId: data.orderId || payload.orderId || '',
    orderCode: data.orderCode || payload.orderCode || '',
    title: payload.title || 'Warkop Nastel',
    body: payload.body || 'Ada update baru.',
    url: data.url || (data.audience === 'customer' ? './' : './?open=kasir')
  };

  event.waitUntil((async () => {
    // Inform an open PWA too. The page has its own dedupe protection.
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    windows.forEach(client => {
      client.postMessage({
        type: 'NASTEL_PUSH_FOREGROUND',
        payload: notice
      });
    });

    if ('setAppBadge' in self.navigator) {
      try { await self.navigator.setAppBadge(1); } catch (_) {}
    }

    const urgent = notice.eventType === 'cancellation_requested' ||
                   notice.eventType === 'refund_pending' ||
                   String(notice.eventType || '').includes('cancellation') ||
                   String(notice.eventType || '').includes('refund');

    // IMPORTANT: a real push ALWAYS creates a persistent system notification.
    // This remains valid even when the PWA page is not running.
    await self.registration.showNotification(notice.title, {
      body: notice.body,
      icon: './icons/icon-192.png',
      badge: './icons/favicon-64.png',
      tag: `${notice.eventType}:${notice.orderId || notice.orderCode || Date.now()}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: urgent
        ? [450, 120, 450, 120, 650]
        : [320, 110, 320, 110, 480],
      timestamp: Date.now(),
      data: notice
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = new URL(data.url || './?open=kasir', self.location.href).href;

  event.waitUntil((async () => {
    if ('clearAppBadge' in self.navigator) {
      try { await self.navigator.clearAppBadge(); } catch (_) {}
    }

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of windows) {
      try {
        const clientUrl = new URL(client.url);
        const target = new URL(targetUrl);
        if (clientUrl.origin === target.origin && clientUrl.pathname === target.pathname) {
          if ('navigate' in client) {
            try { await client.navigate(targetUrl); } catch (_) {}
          }
          await client.focus();
          client.postMessage({
            type: 'NASTEL_PUSH_FOREGROUND',
            payload: data
          });
          return;
        }
      } catch (_) {}
    }

    await self.clients.openWindow(targetUrl);
  })());
});
