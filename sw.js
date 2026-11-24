/* Service worker: caches the whole app (including the model, guide photos and name audio) on first
 * visit so it works offline. Bump CACHE whenever any file changes, or phones keep the old version. */
const CACHE = "ugawv-v2-2";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "vendor/ort.wasm.min.js", "vendor/ort-wasm-simd-threaded.mjs", "vendor/ort-wasm-simd-threaded.wasm",
  "model/model.onnx", "model/labels.json", "model/species.json", "model/config.json", "model/catalog.json",
  "install.html", "icons/qr.png",
];

self.addEventListener("install", (e) => {
  // Also cache every guide photo (catalog.json) and name audio clip (species.json).
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(FILES);
    try {
      const extra = new Set();
      const sp = await (await fetch("model/species.json")).json();
      for (const s of Object.values(sp)) for (const l of Object.values(s.local || {})) if (l.audio) extra.add(l.audio);
      const cat = await (await fetch("model/catalog.json")).json();
      for (const x of Object.values(cat)) if (x.photo && x.photo.src) extra.add(x.photo.src);
      await c.addAll([...extra]);
    } catch (err) { /* app still works; photos/audio then need a network */ }
  }).then(() => self.skipWaiting()));
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
