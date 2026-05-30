const CACHE_NAME = 'eirin-report-v2';   // 版本号递增，强制刷新
const urlsToCache = [
  '/',
  '/index.html',
  '/data/news.json'
];

self.addEventListener('install', event => {
  // 跳过等待，立即激活新 SW
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // 清除所有旧版本缓存
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // 对于 news.json，优先网络，网络失败才用缓存
  if (event.request.url.includes('/data/news.json')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // 更新缓存
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // 其他资源仍然 cache-first
    event.respondWith(
      caches.match(event.request).then(response => response || fetch(event.request))
    );
  }
});
