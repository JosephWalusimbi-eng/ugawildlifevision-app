/* Service worker: caches the whole app (including the model) on first visit so it works offline.
 * Bump CACHE whenever any file below changes, or phones keep the old version. */
const CACHE = "ugawv-v1-5";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "vendor/ort.wasm.min.js", "vendor/ort-wasm-simd-threaded.mjs", "vendor/ort-wasm-simd-threaded.wasm",
  "model/model.onnx", "model/labels.json", "model/species.json", "model/config.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
