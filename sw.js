// 離線快取：App 本身的檔案有網路時一律抓最新版，沒網路時用快取，所以離線也能開。
// VERSION 加一會清掉舊快取。
const VERSION = 'v51';
const CACHE = 'english-app-' + VERSION;
// 詞典資料（dict/）很大又很少變，查過就存著；重新產生詞典或修改主題、例句時把 DICT_VERSION 加一
const DICT_VERSION = 'd28';
const DICT_CACHE = 'english-dict-' + DICT_VERSION;
const ASSETS = [
  './',
  './index.html',
  './dict.js',
  './app.js',
  './pronounce.js',
  './topics.js',
  './quiz.js',
  './dictionary.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './news.json',
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
  // A new dictionary cache version can miss locally while the browser's HTTP cache
  // still has an older response for the same static URL. Revalidate on cache fill.
  const request = cacheName === DICT_CACHE ? new Request(req, { cache: 'no-cache' }) : req;
  const res = await fetch(request);
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

  // 自己的檔案（畫面與程式）：有網路就抓最新版並更新快取，沒網路才用快取
  e.respondWith(
    caches.open(CACHE).then(async c => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        return (await c.match(req, { ignoreSearch: true })) || Response.error();
      }
    })
  );
});
