/* UgaWildVision PWA - pocket field guide + on-device species classifier.
 * Preprocessing must match scripts/export_cls.py PREPROCESS exactly:
 *   EXIF-rotate -> RGB -> shorter side to 224 -> centre-crop 224x224 -> /255 -> NCHW float32.
 * Model output = softmax probabilities [1, nClasses]; class order = model/labels.json.
 */
"use strict";
const SIZE = 224;
const $ = (id) => document.getElementById(id);
const state = { session: null, labels: [], species: {}, catalog: {}, config: { threshold: 0.5 }, last: null,
                filter: "All", current: null, inApp: 0, installEvt: null };
const STATUS_CLASS = { "least concern": "lc", "near threatened": "nt", "vulnerable": "vu", "endangered": "en",
                       "critically endangered": "en" };
const SWAHILI = "kiswahili";

// absolute URL: ORT loads its .mjs with import(), which rejects bare relative specifiers
ort.env.wasm.wasmPaths = new URL("vendor/", location.href).href;
ort.env.wasm.numThreads = 1; // threaded WASM needs cross-origin isolation; 1 thread is fast enough at 224 px

async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/* ---------------- data helpers ---------------- */
const animals = () => Object.keys(state.species).filter((c) => c !== "other");
const info = (cls) => state.species[cls] || { name: cls };
const cat = (cls) => state.catalog[cls] || {};
const sightings = () => JSON.parse(localStorage.getItem("sightings") || "[]");
const seenCount = (cls) => sightings().filter((s) => s.cls === cls).length;

function nameIn(cls, lang) {
  const l = (info(cls).local || {})[lang];
  if (!l || !l.text) return null;
  const ok = l.verified || !l.auto_check || l.auto_check.startsWith("pass");
  if (!ok) return null;
  return { text: l.text, audio: l.audio || "", tts: l.tts || "",
           tag: l.verified ? "checked by a speaker"
                : (l.source || "").startsWith("Sunbird") ? "machine translation, not yet checked" : "not yet checked" };
}
function localName(cls) {
  const lang = $("lang").value;
  if (lang === "en") return null;
  return nameIn(cls, lang) || { text: "Translation pending", tag: "" };
}
function speak(ln) {
  if (ln.audio) { new Audio(ln.audio).play().catch(() => {}); return; }
  if (ln.tts && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(ln.text); u.lang = ln.tts;   // phone's own voice
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}
const canSpeak = (ln) => ln && (ln.audio || (ln.tts && "speechSynthesis" in window));

function toast(t) {
  const el = $("toast"); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 1800);
}
function el(tag, cls, text) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e;
}

/* ---------------- navigation (hash routes, so the phone's back button works) ----------------
 *   #home  #animals  #animal/<class>  #identify  #sightings  #help  #about                       */
const VIEWS = ["home", "animals", "detail", "identify", "sightings", "help", "about"];
const go = (route) => { if (location.hash !== "#" + route) location.hash = route; else routeNow(); };

function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  const tab = view === "detail" ? "animals" : view === "about" ? "help" : view;
  document.querySelectorAll(".tabs button").forEach((b) => {
    const on = b.dataset.view === tab;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (view === "home") renderHome();
  if (view === "animals") renderGrid();
  if (view === "sightings") renderSightings();
  window.scrollTo(0, 0);
}
function routeNow() {
  const h = decodeURIComponent(location.hash.slice(1)) || "home";
  if (h.startsWith("animal/") && state.species[h.slice(7)]) { renderDetail(h.slice(7)); show("detail"); return; }
  show(VIEWS.includes(h) && h !== "detail" ? h : "home");
}
window.addEventListener("hashchange", () => { state.inApp++; routeNow(); });
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go(b.dataset.go); }));
const openDetail = (cls) => go("animal/" + cls);

/* ---------------- home ---------------- */
const LANG_LABEL = () => Object.fromEntries([...$("lang").options].map((o) => [o.value, o.textContent]));
function renderHome() {
  if (!animals().length) return;
  const all = animals();
  $("h-browse").textContent = `\u{1F43E} Browse ${all.length} animals`;
  // language chips mirror the header menu
  const box = $("h-langs"); box.replaceChildren();
  for (const [v, label] of Object.entries(LANG_LABEL())) {
    const b = el("button", "chip" + ($("lang").value === v ? " on" : ""), label); b.type = "button";
    b.addEventListener("click", () => { $("lang").value = v; $("lang").dispatchEvent(new Event("change")); });
    box.append(b);
  }
  // animal of the day: the same animal for everyone on a given date
  const day = Math.floor(Date.now() / 86400000);
  const cls = all[day % all.length], i = info(cls), c = cat(cls);
  const a = $("h-aotd"); a.replaceChildren();
  if (c.photo) { const img = el("img"); img.src = c.photo.src; img.alt = i.name; a.append(img); }
  const txt = el("div", "aotd-text");
  const ln = localName(cls);
  txt.append(el("p", "eyebrow", "Animal of the day"), el("h3", "", i.name));
  if (ln && ln.text !== "Translation pending") txt.append(el("p", "local", ln.text));
  if ((i.facts || []).length) txt.append(el("p", "fact", i.facts[day % i.facts.length]));
  const more = el("button", "btn small-btn", "Learn more \u203A"); more.type = "button";
  more.addEventListener("click", () => openDetail(cls));
  txt.append(more); a.append(txt);
  // stats
  const seen = new Set(sightings().map((x) => x.cls)).size;
  $("h-stat-animals").textContent = all.length;
  $("h-stat-langs").textContent = Object.keys(LANG_LABEL()).length;
  $("h-stat-seen").textContent = `${seen}/${all.length}`;
  // install: native prompt where the browser offers one; once installed, the QR card is for sharing
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("h-install").hidden = !state.installEvt;
  $("h-qr-title").textContent = standalone ? "Share with a friend" : "Get it on your phone";
}
$("h-identify").addEventListener("click", () => go("identify"));
$("h-browse").addEventListener("click", () => go("animals"));
$("h-sightings").addEventListener("click", () => go("sightings"));
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installEvt = e; if (!$("view-home").hidden) renderHome(); });
$("h-install").addEventListener("click", async () => {
  if (!state.installEvt) return;
  state.installEvt.prompt(); await state.installEvt.userChoice; state.installEvt = null; renderHome();
});
window.addEventListener("appinstalled", () => toast("UgaWildVision installed"));

/* ---------------- animals grid ---------------- */
function renderChips() {
  const groups = ["All", ...new Set(animals().map((c) => cat(c).category || "Mammals"))];
  const box = $("chips"); box.replaceChildren();
  for (const g of groups) {
    const b = el("button", "chip" + (g === state.filter ? " on" : ""), g);
    b.addEventListener("click", () => { state.filter = g; renderChips(); renderGrid(); });
    box.append(b);
  }
}
function renderGrid() {
  const q = $("search").value.trim().toLowerCase();
  const lang = $("lang").value;
  const grid = $("grid"); grid.replaceChildren();
  for (const cls of animals()) {
    const i = info(cls), c = cat(cls);
    if (state.filter !== "All" && (c.category || "Mammals") !== state.filter) continue;
    const ln = lang === "en" ? null : nameIn(cls, lang);
    const hay = [i.name, i.scientific, ln && ln.text].join(" ").toLowerCase();
    if (q && !hay.includes(q)) continue;
    const card = el("button", "cardA"); card.type = "button";
    const ph = el("div", "ph");
    if (c.photo) { const img = el("img"); img.src = c.photo.src; img.alt = i.name; img.loading = "lazy"; ph.append(img); }
    ph.append(el("span", "cat", c.category || "Mammals"));
    const n = seenCount(cls);
    card.append(ph, el("div", "nm", i.name), el("div", "ln", ln ? ln.text : ""),
                el("span", "seen", n ? `\u{1F441} Seen ${n} time${n > 1 ? "s" : ""}` : "Not seen yet"));
    card.addEventListener("click", () => openDetail(cls));
    grid.append(card);
  }
}
$("search").addEventListener("input", renderGrid);

/* ---------------- detail ---------------- */
function renderDetail(cls) {
  state.current = cls;
  const i = info(cls), c = cat(cls);
  if (c.photo) {
    $("d-photo").src = c.photo.src; $("d-photo").alt = i.name;
    $("d-credit").textContent = `Photo: ${c.photo.author || "unknown"}, ${c.photo.licence}`;
    $("d-credit").href = c.photo.page || "#";
  } else { $("d-photo").removeAttribute("src"); $("d-credit").textContent = ""; }
  $("d-name").textContent = i.name;
  const ln = localName(cls);
  const loc = $("d-local"); loc.replaceChildren();
  // DEMO: "not yet checked" label hidden for the demo; restore by un-commenting the tag line below.
  if (ln) { loc.append(ln.text + " "); /* if (ln.tag) loc.append(el("span", "tag", ln.tag)); */ }
  $("d-listen").hidden = !canSpeak(ln);
  $("d-listen").onclick = () => speak(ln);

  const tags = $("d-tags"); tags.replaceChildren();
  tags.append(el("span", "tag cat", c.category || "Mammals"));
  if (c.status) tags.append(el("span", `tag ${STATUS_CLASS[c.status.toLowerCase()] || ""}`, `IUCN: ${c.status}`));
  if (i.safety) tags.append(el("span", "tag danger", "Keep your distance"));
  if (i.low_data) tags.append(el("span", "tag low", "Few training photos"));
  const n = seenCount(cls);
  tags.append(el("span", "tag seen", n ? `Seen ${n} time${n > 1 ? "s" : ""}` : "Not seen yet"));
  $("d-safety").hidden = !i.safety; $("d-safety").textContent = i.safety ? `⚠️ ${i.safety}` : "";

  const sw = nameIn(cls, SWAHILI);
  const rows = [["Latin name", i.scientific], ["Swahili name", sw ? sw.text : ""], ["Class", c.class],
                ["Order", c.order], ["Family", c.family]];
  const tax = $("d-tax"); tax.replaceChildren();
  for (const [k, v] of rows) { if (!v) continue; tax.append(el("dt", "", k), el("dd", "", v)); }

  const facts = $("d-facts"); facts.replaceChildren();
  for (const f of i.facts || []) facts.append(el("li", "", f));
  $("d-facts").hidden = $("d-facts-h").hidden = !(i.facts || []).length;
  $("d-wiki").href = c.wikipedia || "#";
}
// Back returns to wherever the user came from; a shared link opened directly goes to the list.
$("d-back").addEventListener("click", () => { if (state.inApp > 0) history.back(); else go("animals"); });
function sawIt(cls) {
  const s = sightings(); s.unshift({ cls, t: Date.now() });
  localStorage.setItem("sightings", JSON.stringify(s));
  toast(`Recorded: ${info(cls).name}`);
}
$("d-saw").addEventListener("click", () => { sawIt(state.current); renderDetail(state.current); });

/* ---------------- sightings ---------------- */
function renderSightings() {
  const s = sightings(), all = animals();
  const got = new Set(s.map((x) => x.cls));
  $("s-count").textContent = got.size; $("s-total").textContent = all.length;
  $("s-fill").style.width = `${Math.round(100 * got.size / all.length)}%`;
  const badges = $("s-badges"); badges.replaceChildren();
  const groups = [...new Set(all.map((c) => cat(c).category || "Mammals"))];
  for (const g of groups) {
    const members = all.filter((c) => (cat(c).category || "Mammals") === g);
    const n = members.filter((c) => got.has(c)).length;
    badges.append(el("span", "badge" + (n === members.length ? " got" : ""), `${g}: ${n}/${members.length}`));
  }
  const list = $("s-list"); list.replaceChildren();
  $("s-empty").hidden = s.length > 0;
  for (const x of s) {
    const li = el("li"); const c = cat(x.cls);
    if (c.photo) { const img = el("img"); img.src = c.photo.src; img.alt = ""; li.append(img); }
    const d = el("div"); d.append(el("div", "", info(x.cls).name),
      el("div", "when", new Date(x.t).toLocaleString()));
    li.append(d); li.addEventListener("click", () => openDetail(x.cls));
    list.append(li);
  }
}

/* ---------------- identify (model) ---------------- */
async function init() {
  try {
    [state.labels, state.species, state.config, state.catalog] = await Promise.all([
      loadJSON("model/labels.json"), loadJSON("model/species.json"), loadJSON("model/config.json"),
      loadJSON("model/catalog.json"),
    ]);
    renderChips(); renderCredits(); routeNow();
    $("ncls").textContent = state.labels.filter((c) => c !== "other").length;
    state.session = await ort.InferenceSession.create("model/model.onnx", { executionProviders: ["wasm"] });
    $("version").textContent = `Model ${state.config.model_version || "?"} · threshold ${state.config.threshold}`;
    setStatus("Ready. Take or choose a photo.");
    setBusy(false);
  } catch (e) {
    setStatus(`Could not load the app data (${e.message}). Check your connection and reload once.`);
    console.error(e);
  }
}
function renderCredits() {
  const ul = $("credits"); ul.replaceChildren();
  for (const cls of animals()) {
    const p = cat(cls).photo; if (!p) continue;
    const li = el("li"); li.append(`${info(cls).name}: ${p.author || "unknown"}, `);
    const a = el("a", "", p.licence); a.href = p.licence_url || p.page; a.target = "_blank"; a.rel = "noopener";
    const s = el("a", "", "source"); s.href = p.page; s.target = "_blank"; s.rel = "noopener";
    li.append(a, " (Wikimedia Commons, ", s, ")"); ul.append(li);
  }
}

function setStatus(t) { $("status").textContent = t; }
function setBusy(b) {
  document.querySelectorAll(".actions .btn").forEach((e) => e.setAttribute("aria-disabled", String(b)));
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
    renderResult(ranked);
    setStatus(`Done in ${Math.round(ms)} ms on this device.`);
  } catch (e) {
    setStatus(`Something went wrong: ${e.message}`);
    console.error(e);
  } finally {
    setBusy(false);
  }
}

function renderResult(ranked) {
  if (!ranked) return;
  const top = ranked[0], i = info(top.cls);
  const sure = top.p >= state.config.threshold;
  const unknown = top.cls === "other";
  $("result").hidden = false;
  $("verdict").textContent = unknown ? "Result" : sure ? "Most likely" : "Not sure, best guess";
  $("name").textContent = i.name;
  $("sci").textContent = i.scientific || "";
  const ln = unknown ? null : localName(top.cls);
  const lnEl = $("localname"); lnEl.replaceChildren(); lnEl.hidden = !ln;
  if (ln) {
    lnEl.append(ln.text + " ");
    if (canSpeak(ln)) { const b = el("button", "play", "▶ Listen"); b.type = "button"; b.onclick = () => speak(ln); lnEl.append(b, " "); }
    // DEMO: "not yet checked" label hidden for the demo; restore by un-commenting the next line.
    // if (ln.tag) lnEl.append(el("span", "tag", ln.tag));
  }
  $("meterfill").style.width = `${Math.round(top.p * 100)}%`;
  $("conf").textContent = `Confidence ${Math.round(top.p * 100)}%` +
    (sure ? "" : `, below the ${Math.round(state.config.threshold * 100)}% needed to be sure. Try a closer, clearer photo.`);
  $("lowdata").hidden = !i.low_data;
  $("safety").hidden = !i.safety; $("safety").textContent = i.safety || "";
  $("r-open").hidden = $("r-saw").hidden = unknown;
  $("r-open").onclick = () => openDetail(top.cls);
  $("r-saw").onclick = () => sawIt(top.cls);
  const alt = $("altlist"); alt.replaceChildren();
  for (const r of ranked.slice(1, 4)) alt.append(el("li", "", `${info(r.cls).name}: ${Math.round(r.p * 100)}%`));
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

for (const id of ["camera", "gallery"]) {
  $(id).addEventListener("change", (e) => { classify(e.target.files[0]); e.target.value = ""; });
}
$("lang").addEventListener("change", () => {
  localStorage.setItem("lang", $("lang").value);
  renderGrid(); renderResult(state.last);
  if (!$("view-detail").hidden && state.current) renderDetail(state.current);
  if (!$("view-home").hidden) renderHome();
});
$("lang").value = localStorage.getItem("lang") || "en";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW not registered", e));
}
setBusy(true);
init();
