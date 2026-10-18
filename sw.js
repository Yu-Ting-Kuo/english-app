// 離線快取：App 本身的檔案先從快取拿（開很快、沒網路也能用），同時在背景抓新版。
// 改版時把 VERSION 加一，手機下次打開就會換成新版。
const VERSION = 'v2';
const CACHE = 'english-app-' + VERSION;
// 詞典資料（dict/）很大又很少變，查過就存著；重新產生詞典或修改主題（dict/topics.json）時把 DICT_VERSION 加一
const DICT_VERSION = 'd1';
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

  // 字型：抓過一次就存起來
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(CACHE, req));
    return;
  }

  // 其他網站（線上字典、翻譯、發音）直接走網路
  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/dict/')) {
    e.respondWith(cacheFirst(DICT_CACHE, req));
    return;
  }

  // 自己的檔案：先給快取，背景更新
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then(res => { if (res.ok) c.put(req, res.clone()); return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
