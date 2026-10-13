// מאפשר התראות מערכת ופתיחת האפליקציה בלחיצה עליהן
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const open = list.find((c) => c.url.includes('/m') || c.url.endsWith('/'));
    return open ? open.focus() : self.clients.openWindow('/m');
  }));
});
