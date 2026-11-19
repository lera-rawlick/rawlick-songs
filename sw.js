// Работа без интернета: сначала сеть (чтобы обновления приходили сами), при ошибке — копия из кэша.
// При выпуске новой версии поменяй VERSION, чтобы старый кэш удалился.
const VERSION = 'rs-v6';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'songs.js', 'warmups.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'vendor/soundtouch.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Зашифрованные данные (data/) и переводчик не кэшируем: расшифрованное приложение само хранит в IndexedDB,
  // а копия 200 МБ шифра в кэше только заняла бы место в телефоне.
  const url = new URL(e.request.url);
  if (url.pathname.includes('/data/') || (url.origin !== location.origin && !url.host.includes('fonts.g'))) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
