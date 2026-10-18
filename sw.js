// ?Ｙ?敹怠?嚗pp ?祈澈??獢?敺翰?嚗?敺翰??蝬脰楝銋?剁?嚗??????// ?寧??? VERSION ??嚗?璈?甈⊥??停?????const VERSION = 'v5';
const CACHE = 'english-app-' + VERSION;
// 閰鞈?嚗ict/嚗?憭批?敺?霈??仿?撠勗?????Ｙ?閰?耨?嫣蜓憿?dict/topics.json嚗???DICT_VERSION ??
const DICT_VERSION = 'd2';
const DICT_CACHE = 'english-dict-' + DICT_VERSION;
const ASSETS = [
  './',
  './index.html',
  './dict.js',
  './app.js',
  './topics.js',
  './dictionary.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => (k.startsWith('english-app-') && k !== CACHE) || (k.startsWith('english-dict-') && k !== DICT_CACHE))
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(cacheName, req) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 摮?嚗???甈∪停摮絲靘?  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(CACHE, req));
    return;
  }

  // ?嗡?蝬脩?嚗?銝??詻蕃霅胯?喉??湔韏啁雯頝?  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/dict/')) {
    e.respondWith(cacheFirst(DICT_CACHE, req));
    return;
  }

  // ?芸楛??獢??策敹怠?嚗??舀??  e.respondWith(
    caches.open(CACHE).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then(res => { if (res.ok) c.put(req, res.clone()); return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
