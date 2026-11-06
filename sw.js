/* ==========================================================================
   永遠亭 医療報告 — 離線緩存
   站點部署於子路徑（/eirin-report/），所有地址一律使用相對路徑。
   ========================================================================== */

const VERSION = "eirin-v2";
const CORE = [
  "./",
  "./index.html",
  "./discuss.html",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/icon.svg",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/* 导航请求带查询参数（?q=…&page=…）时缓存匹配不到，离线回退到首页 */
async function navigateFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    return await fetch(request);
  } catch {
    const cached = (await cache.match(request)) || (await cache.match("./index.html"));
    if (cached) return cached;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigateFirst(request));
    return;
  }

  if (url.pathname.endsWith("/data/news.json") || url.pathname.endsWith("/feed.xml")) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
