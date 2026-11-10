import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";

const MODEL = "Horizon-Labs/multilingual-emotions-small";
const REPO_FILE = (f) => `https://huggingface.co/${MODEL}/resolve/main/${f}`;
const CACHE_KEY = env.cacheKey; // "transformers-cache"
const CACHE_API = typeof caches !== "undefined";

const EMOJI = {
  admiration: "🤩", amusement: "😄", anger: "😠", annoyance: "😒", approval: "👍",
  caring: "🤗", confusion: "😕", curiosity: "🤔", desire: "😍", disappointment: "😞",
  disapproval: "👎", disgust: "🤢", embarrassment: "😳", excitement: "🎉", fear: "😨",
  gratitude: "🙏", grief: "😭", joy: "😊", love: "❤️", nervousness: "😬",
  optimism: "🌤️", pride: "🦚", realization: "💡", relief: "😌", remorse: "😔",
  sadness: "😢", surprise: "😲", neutral: "😐",
};

const EXAMPLES = [
  "Thank you so much, this made my day!",
  "Ich kann nicht glauben, dass sie das Konzert abgesagt haben.",
  "Tengo miedo de que no lleguemos a tiempo.",
  "我真的很想念我的奶奶。",
  "Wait, you did all of this yourself? I had no idea!",
  "The meeting has moved to 3pm.",
];

const $ = (id) => document.getElementById(id);
const textEl = $("text"), runEl = $("run"), statusEl = $("status");
const statusText = $("status-text"), progressEl = $("progress");

let classifier = null;
let thresholds = {};
let ekman = {};
let wantSave = false;         // visitor ticked "keep" before the model finished loading
const modelFiles = new Set(); // model repo files fetched by Transformers.js

// ---- Storage --------------------------------------------------------------
// By default nothing is written to the visitor's device: the model lives only
// in this tab's memory. Visitors can opt in to keeping it in the Cache API.
const noStoreFetch = (url, init = {}) => fetch(url, { ...init, cache: "no-store" });

function configureStorage(keep) {
  env.useBrowserCache = keep && CACHE_API;
  env.useWasmCache = keep && CACHE_API;
  env.fetch = keep ? fetch.bind(globalThis) : noStoreFetch;
}

// True only if the model weights themselves were stored. Browsers can refuse to
// store a file this large, leaving just the small config/runtime files behind.
async function isSaved() {
  try {
    if (!CACHE_API || !(await caches.has(CACHE_KEY))) return false;
    const keys = await (await caches.open(CACHE_KEY)).keys();
    return keys.some((req) => req.url.endsWith(".onnx"));
  } catch {
    return false;
  }
}

async function clearSaved() {
  try {
    if (CACHE_API) await caches.delete(CACHE_KEY);
  } catch {}
}

async function showStored() {
  let size = "";
  try {
    const { usage } = await navigator.storage.estimate();
    if (usage) size = ` (${Math.round(usage / 1e6)} MB)`;
  } catch {}
  $("stored-text").textContent = `Model saved on this device${size}.`;
  $("remove").hidden = false;
  $("stored").hidden = false;
}

// Save the already-loaded model for next time. The files were fetched without
// storing them, so this downloads them once more, straight into the cache,
// under the same keys Transformers.js looks up on the next visit.
async function saveModel() {
  const keepEl = $("keep");
  keepEl.disabled = true;
  $("stored-text").textContent = "Saving the model to this device…";
  $("remove").hidden = true;
  $("stored").hidden = false;
  try {
    const cache = await caches.open(CACHE_KEY);
    for (const file of modelFiles) {
      const url = REPO_FILE(file);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
      await cache.put(url, res);
    }
  } catch (err) {
    console.warn("Saving the model failed:", err);
  }
  if (await isSaved()) {
    configureStorage(true);
    $("keep-wrap").hidden = true;
    showStored();
  } else {
    await clearSaved();
    keepEl.checked = false;
    keepEl.disabled = false;
    $("stored-text").textContent =
      "Your browser didn't allow saving the model, so nothing was kept on this device.";
  }
}

$("keep").addEventListener("change", (e) => {
  wantSave = e.target.checked;
  if (wantSave && classifier) saveModel();
});

$("remove").addEventListener("click", async () => {
  try {
    if (!(await caches.delete(CACHE_KEY)) && (await caches.has(CACHE_KEY))) {
      throw new Error("the browser didn't delete it");
    }
    configureStorage(false); // don't re-save anything this session
    $("stored-text").textContent =
      "Removed from this device. It stays in memory until you close this tab.";
    $("remove").hidden = true;
  } catch (err) {
    $("stored-text").textContent = `Couldn't remove it: ${err.message ?? err}`;
  }
});

// ---- Examples -------------------------------------------------------------
for (const ex of EXAMPLES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "example";
  b.textContent = ex;
  b.addEventListener("click", () => {
    textEl.value = ex;
    if (classifier) analyze();
  });
  $("examples").append(b);
}

// ---- Model loading --------------------------------------------------------
const fileProgress = new Map(); // file -> [loaded, total]

function onProgress(p) {
  if (p.status === "initiate" && p.name === MODEL) modelFiles.add(p.file);
  if (p.status === "progress" && p.total) {
    fileProgress.set(p.file, [p.loaded, p.total]);
    let loaded = 0, total = 0;
    for (const [l, t] of fileProgress.values()) { loaded += l; total += t; }
    progressEl.style.width = `${total ? ((loaded / total) * 100).toFixed(1) : 0}%`;
    statusText.textContent =
      `Downloading the model… ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`;
  } else if (p.status === "ready") {
    statusText.textContent = "Starting up…";
  }
}

async function loadJSON(file) {
  try {
    const r = await noStoreFetch(REPO_FILE(file));
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

async function loadModel(keep) {
  configureStorage(keep);
  statusText.textContent = keep ? "Loading the model from this device…" : "Downloading the model…";

  try {
    [thresholds, ekman, classifier] = await Promise.all([
      loadJSON("thresholds.json"),
      loadJSON("ekman_mapping.json"),
      pipeline("text-classification", MODEL, { dtype: "q8", progress_callback: onProgress }),
    ]);
    statusEl.hidden = true;
    runEl.disabled = false;
    runEl.textContent = "Analyze";
    if (keep && CACHE_API) {
      if (await isSaved()) {
        showStored();
      } else {
        // Saving failed partway: remove the leftovers so nothing lingers.
        await clearSaved();
        configureStorage(false);
        $("stored-text").textContent =
          "Your browser didn't allow saving the model, so nothing was kept on this device.";
        $("remove").hidden = true;
        $("stored").hidden = false;
      }
    } else if (wantSave) {
      saveModel();
    }
    if (textEl.value.trim()) analyze();
  } catch (err) {
    console.error(err);
    statusEl.classList.add("error");
    statusText.textContent = `Couldn't load the model: ${err.message ?? err}. Try reloading the page.`;
    runEl.textContent = "Unavailable";
  }
}

async function init() {
  if (await isSaved()) {
    // The visitor opted in on an earlier visit: load straight from the device.
    loadModel(true);
  } else {
    // Download right away, keeping it only in memory. Saving is opt-in.
    await clearSaved(); // drop leftovers from an interrupted or failed save
    if (CACHE_API) $("keep-wrap").hidden = false;
    loadModel(false);
  }
}

// ---- Inference ------------------------------------------------------------
async function analyze() {
  const text = textEl.value.trim();
  if (!text || !classifier) return;

  runEl.disabled = true;
  runEl.textContent = "Analyzing…";
  try {
    let out = await classifier(text, { top_k: 28 });
    if (Array.isArray(out[0])) out = out[0]; // some versions nest single inputs
    render(out);
  } catch (err) {
    console.error(err);
    alert(`Something went wrong: ${err.message ?? err}`);
  } finally {
    runEl.disabled = false;
    runEl.textContent = "Analyze";
  }
}

// ---- Rendering ------------------------------------------------------------
const pct = (s) => `${Math.round(s * 100)}%`;
const name = (l) => `${EMOJI[l] ?? ""} ${l}`.trim();

function barRow(label, score, highlight) {
  const row = document.createElement("div");
  row.className = "row" + (highlight ? " hi" : "");
  row.innerHTML = `
    <span class="row-label"></span>
    <span class="track"><span class="fill" style="width:${(score * 100).toFixed(1)}%"></span></span>
    <span class="row-val">${pct(score)}</span>`;
  row.querySelector(".row-label").textContent = label;
  return row;
}

function render(out) {
  const scores = Object.fromEntries(out.map((x) => [x.label, x.score]));
  const sorted = [...out].sort((a, b) => b.score - a.score);

  // Detected: above the model's tuned per-label threshold.
  let detected = sorted.filter((x) => x.score >= (thresholds[x.label] ?? 0.5));
  if (!detected.length) detected = sorted.slice(0, 1);
  $("detected").replaceChildren(
    ...detected.map((x) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = `${name(x.label)} · ${pct(x.score)}`;
      return c;
    })
  );

  // Ekman: max score over each group of labels, plus neutral so calm text
  // doesn't show a weak emotion as the top result.
  const ek = Object.entries({ ...ekman, neutral: ["neutral"] })
    .map(([e, labels]) => [e, Math.max(...labels.map((l) => scores[l] ?? 0))])
    .sort((a, b) => b[1] - a[1]);
  $("ekman").replaceChildren(...ek.map(([e, s], i) => barRow(name(e), s, i === 0)));

  $("all").replaceChildren(
    ...sorted.map((x) => barRow(name(x.label), x.score, x.score >= (thresholds[x.label] ?? 0.5)))
  );

  $("results").hidden = false;
}

// ---- Wire up --------------------------------------------------------------
runEl.addEventListener("click", analyze);
textEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyze();
});

init();
