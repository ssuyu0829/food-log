// ⚠️ 改版時務必把 VERSION 加一，否則舊快取會鎖住新版
//    （multiply-dojo 就是在這裡卡過，這裡一律 network-first）
const VERSION = "v4";   // 2026-10-14 蛋白質目標、CSV 下載
const CACHE = `foodlog-${VERSION}`;
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.json",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // API 一律走網路，不進快取（資料要新鮮；離線時 app.js 會用 localStorage 的快照）
  if (url.pathname.includes("/functions/v1/")) return;

  // 靜態檔：network-first，網路好就一定拿到新版
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))),
  );
});
