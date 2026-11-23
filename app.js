/* UgaWildlifeVision PWA - on-device species classifier.
 * Preprocessing must match scripts/export_cls.py PREPROCESS exactly:
 *   EXIF-rotate -> RGB -> shorter side to 224 -> centre-crop 224x224 -> /255 -> NCHW float32.
 * Model output = softmax probabilities [1, nClasses]; class order = model/labels.json.
 */
"use strict";
const SIZE = 224;
const $ = (id) => document.getElementById(id);
const state = { session: null, labels: [], species: {}, config: { threshold: 0.5 }, last: null };

// absolute URL: ORT loads its .mjs with import(), which rejects bare relative specifiers
ort.env.wasm.wasmPaths = new URL("vendor/", location.href).href;
ort.env.wasm.numThreads = 1; // threaded WASM needs cross-origin isolation; 1 thread is fast enough at 224 px

async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function init() {
  try {
    [state.labels, state.species, state.config] = await Promise.all([
      loadJSON("model/labels.json"), loadJSON("model/species.json"), loadJSON("model/config.json"),
    ]);
    state.session = await ort.InferenceSession.create("model/model.onnx", { executionProviders: ["wasm"] });
    $("ncls").textContent = state.labels.filter((c) => c !== "other").length;
    $("version").textContent = `Model ${state.config.model_version || "?"} · threshold ${state.config.threshold}`;
    setStatus("Ready. Take or choose a photo.");
    setBusy(false);
  } catch (e) {
    setStatus(`Could not load the model (${e.message}). Check your connection and reload once.`);
    console.error(e);
  }
}

function setStatus(t) { $("status").textContent = t; }
function setBusy(b) {
  document.querySelectorAll(".btn").forEach((el) => el.setAttribute("aria-disabled", String(b)));
}

/* Decode with EXIF orientation applied, then resize + centre crop with EXACTLY the geometry of
 * torchvision Resize(224)+CenterCrop(224) (see export_cls.py): long side = trunc(224*long/short),
 * crop offset = round((dim-224)/2). Large phone photos are first halved step by step so the
 * downscale is smooth like PIL's antialiased bilinear. */
async function toTensor(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const W = bmp.width, H = bmp.height;
  const nw = W <= H ? SIZE : Math.trunc(SIZE * W / H);
  const nh = W <= H ? Math.trunc(SIZE * H / W) : SIZE;
  const left = Math.round((nw - SIZE) / 2), top = Math.round((nh - SIZE) / 2);
  let src = bmp, w = W, h = H;
  while (w >= nw * 4 && h >= nh * 4) {
    const c = new OffscreenCanvasOrCanvas(Math.round(w / 2), Math.round(h / 2));
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  const c = new OffscreenCanvasOrCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h, -left, -top, nw, nh);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE, data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    data[i] = px[4 * i] / 255; data[n + i] = px[4 * i + 1] / 255; data[2 * n + i] = px[4 * i + 2] / 255;
  }
  bmp.close?.();
  return new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]);
}
function OffscreenCanvasOrCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}

async function classify(file) {
  if (!state.session || !file) return;
  setBusy(true); setStatus("Looking…");
  try {
    $("preview").src = URL.createObjectURL(file);
    const input = await toTensor(file);
    const t0 = performance.now();
    const out = await state.session.run({ [state.session.inputNames[0]]: input });
    const ms = performance.now() - t0;
    const probs = Array.from(out[state.session.outputNames[0]].data);
    const ranked = probs.map((p, i) => ({ cls: state.labels[i], p })).sort((a, b) => b.p - a.p);
    state.last = ranked;
    render(ranked);
    setStatus(`Done in ${Math.round(ms)} ms on this device.`);
  } catch (e) {
    setStatus(`Something went wrong: ${e.message}`);
    console.error(e);
  } finally {
    setBusy(false);
  }
}

function localName(info) {
  const lang = $("lang").value;
  if (lang === "en" || !info.local) return null;
  const l = info.local[lang];
  if (!l || !l.text) return { text: "Translation pending", tag: "" };
  return { text: l.text, tag: l.verified ? "checked by a speaker" : "unverified" };
}

function render(ranked) {
  if (!ranked) return;
  const top = ranked[0], info = state.species[top.cls] || { name: top.cls };
  const sure = top.p >= state.config.threshold;
  const unknown = top.cls === "other";
  $("result").hidden = false;
  $("verdict").textContent = unknown ? "Result" : sure ? "Most likely" : "Not sure, best guess";
  $("name").textContent = info.name;
  $("sci").textContent = info.scientific || "";
  const ln = unknown ? null : localName(info);
  const lnEl = $("localname");
  lnEl.hidden = !ln;
  if (ln) {
    lnEl.textContent = ln.text + " ";
    if (ln.tag) { const s = document.createElement("span"); s.className = "tag"; s.textContent = `(${ln.tag})`; lnEl.append(s); }
  }
  $("meterfill").style.width = `${Math.round(top.p * 100)}%`;
  $("conf").textContent = `Confidence ${Math.round(top.p * 100)}%` +
    (sure ? "" : `, below the ${Math.round(state.config.threshold * 100)}% needed to be sure. Try a closer, clearer photo.`);
  $("lowdata").hidden = !info.low_data;
  $("safety").hidden = !info.safety;
  $("safety").textContent = info.safety || "";
  const alt = $("altlist"); alt.replaceChildren();
  for (const r of ranked.slice(1, 4)) {
    const li = document.createElement("li");
    li.textContent = `${(state.species[r.cls] || { name: r.cls }).name}: ${Math.round(r.p * 100)}%`;
    alt.append(li);
  }
  const facts = $("facts"); facts.replaceChildren();
  for (const f of (sure && !unknown ? info.facts || [] : [])) {
    const li = document.createElement("li"); li.textContent = f; facts.append(li);
  }
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

for (const id of ["camera", "gallery"]) {
  $(id).addEventListener("change", (e) => { classify(e.target.files[0]); e.target.value = ""; });
}
$("lang").addEventListener("change", () => { localStorage.setItem("lang", $("lang").value); render(state.last); });
$("lang").value = localStorage.getItem("lang") || "en";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW not registered", e));
}
setBusy(true);
init();
