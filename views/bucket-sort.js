// bucket-sort: animated bucket sort. 1) scatter each value into a bucket by its value range,
// 2) insertion-sort each bucket, 3) gather the buckets in order. Counts comparisons, so you can see
// how evenly spread data stays fast and clumped data degrades toward O(n²).
// input: { n: 10 (5–20), k: 5 (1–10), data: "uniform"|"clustered"|"ints" }

const opts = (typeof input === "object" && input) || {};
let n = Math.max(5, Math.min(20, opts.n ?? 10));
let k = Math.max(1, Math.min(10, opts.k ?? 5));
let dataKind = ["uniform", "clustered", "ints"].includes(opts.data) ? opts.data : "uniform";
let values = [], steps = [], pos = 0, timer = null;

// ---------- DOM ----------
const root = document.createElement("div");
root.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:10px;padding:12px;font-size:14px;";
dv.container.appendChild(root);
function el(tag, css, text, parent = root) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}
const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const dataSel = el("select", "", null, top);
for (const [v, t] of [["uniform", "🎲 Evenly spread 0–1"], ["clustered", "🫧 Clumped together"], ["ints", "🔢 Integers 0–99"]]) {
  const o = el("option", "", t, dataSel); o.value = v;
}
dataSel.value = dataKind;
function slider(label, min, max, get, set) {
  const w = el("label", "display:flex;gap:4px;align-items:center;font-size:13px;", label, top);
  const s = el("input", "width:80px;", null, w);
  Object.assign(s, { type: "range", min, max, step: 1, value: get() });
  const out = el("b", "width:22px;", String(get()), w);
  s.oninput = () => { set(Number(s.value)); out.textContent = s.value; build(true); };
}
slider("n", 5, 20, () => n, (v) => (n = v));
slider("buckets k", 1, 10, () => k, (v) => (k = v));
const ctrl = el("div", "display:flex;gap:6px;margin:8px 0;flex-wrap:wrap;");
const stepBtn = el("button", "", "⏭ Step", ctrl);
const playBtn = el("button", "", "▶ Play", ctrl);
const resetBtn = el("button", "", "↺ Restart", ctrl);
const newBtn = el("button", "", "🎲 New numbers", ctrl);
const phaseEl = el("div", "font-weight:bold;");
const inputRow = el("div", "display:flex;gap:4px;flex-wrap:wrap;margin:6px 0;min-height:30px;");
const bucketRow = el("div", "display:flex;gap:4px;align-items:flex-end;margin:6px 0;");
const outRow = el("div", "display:flex;gap:4px;flex-wrap:wrap;margin:6px 0;min-height:30px;");
const narr = el("div", "font-family:var(--font-monospace);font-size:13px;min-height:2.8em;");
const stats = el("div", "margin-top:4px;font-size:13px;color:var(--text-muted);");

const isInt = () => dataKind === "ints";
const fmt = (x) => (isInt() ? String(x) : x.toFixed(2));
// bucket index: floats are in [0, 1) → floor(x × k); ints are in [0, 100) → floor(x × k / 100)
const bucketOf = (x) => Math.min(k - 1, Math.floor(isInt() ? (x * k) / 100 : x * k));
const indexMath = (x) => isInt()
  ? `⌊${x} × ${k} / 100⌋ = ⌊${((x * k) / 100).toFixed(2)}⌋ = ${bucketOf(x)}`
  : `⌊${fmt(x)} × ${k}⌋ = ⌊${(x * k).toFixed(2)}⌋ = ${bucketOf(x)}`;
const rangeLabel = (b) => isInt()
  ? `${Math.ceil((b * 100) / k)}–${Math.ceil(((b + 1) * 100) / k) - 1}`
  : `${(b / k).toFixed(2)}–${((b + 1) / k).toFixed(2)}`;

function newData() {
  values = Array.from({ length: n }, () => {
    if (dataKind === "ints") return Math.floor(Math.random() * 100);
    if (dataKind === "clustered") return +(0.1 + Math.random() * 0.09).toFixed(2);
    return +(Math.random() * 0.99).toFixed(2);
  });
}

// Pre-compute every step, then the view just replays steps[0..pos].
function build(fresh) {
  stop();
  if (fresh || values.length !== n) newData();
  steps = [];
  const buckets = Array.from({ length: k }, () => []);
  values.forEach((x, i) => {
    const b = bucketOf(x);
    buckets[b].push(x);
    steps.push({ phase: "scatter", i, b, text: `${fmt(x)} → bucket ${indexMath(x)}` });
  });
  let total = 0;
  buckets.forEach((arr, b) => {
    if (arr.length === 0) return;
    const a = [...arr];
    let comps = 0;
    for (let i = 1; i < a.length; i++) {          // insertion sort, counting comparisons
      const x = a[i];
      let j = i - 1;
      while (j >= 0) { comps++; if (a[j] > x) { a[j + 1] = a[j]; j--; } else break; }
      a[j + 1] = x;
    }
    total += comps;
    steps.push({ phase: "sort", b, sorted: a, comps, total,
      text: arr.length === 1 ? `bucket ${b}: one item, already sorted (0 comparisons)` : `bucket ${b}: [${arr.map(fmt).join(", ")}] → [${a.map(fmt).join(", ")}] (${comps} comparisons)` });
  });
  buckets.forEach((arr, b) => {
    if (arr.length) steps.push({ phase: "gather", b, text: `append bucket ${b} to the output` });
  });
  pos = 0;
  render();
}

function render() {
  // replay steps
  const buckets = Array.from({ length: k }, () => []);
  const placed = new Set(), sortedB = new Set(), gathered = [];
  let comps = 0, last = steps[pos - 1];
  for (let s = 0; s < pos; s++) {
    const st = steps[s];
    if (st.phase === "scatter") { buckets[st.b].push(values[st.i]); placed.add(st.i); }
    if (st.phase === "sort") { buckets[st.b] = [...st.sorted]; sortedB.add(st.b); comps = st.total; }
    if (st.phase === "gather") { gathered.push(...buckets[st.b]); buckets[st.b] = []; }
  }
  const phase = !last ? "ready" : last.phase;
  phaseEl.textContent = { ready: "Input (press Step or Play)", scatter: "1️⃣ Scatter: drop each number into its bucket", sort: "2️⃣ Sort each bucket (insertion sort)", gather: "3️⃣ Gather: read the buckets in order" }[phase] + (pos === steps.length ? " · ✅ done!" : "");
  const chip = (x, hl, faded) => `<span style="padding:3px 7px;border-radius:5px;font-family:var(--font-monospace);font-size:13px;
    background:${faded ? "transparent" : hl ? "#e8590c" : "var(--interactive-accent)"};color:${faded ? "var(--text-faint)" : "var(--text-on-accent)"};
    border:1px ${faded ? "dashed var(--background-modifier-border)" : "solid transparent"};">${fmt(x)}</span>`;
  inputRow.innerHTML = `<span style="font-size:12px;color:var(--text-muted);align-self:center;">input:</span>` +
    values.map((x, i) => chip(x, last && last.phase === "scatter" && last.i === i, placed.has(i))).join("");
  const maxLen = Math.max(1, ...steps.filter((s) => s.phase === "sort").map((s) => s.sorted.length));
  bucketRow.innerHTML = buckets.map((arr, b) => {
    const active = last && (last.b === b) && last.phase !== "scatter" ? "#e8590c" : last && last.phase === "scatter" && last.b === b ? "#e8590c" : "var(--background-modifier-border)";
    return `<div style="flex:1;min-width:0;text-align:center;">
      <div style="display:flex;flex-direction:column-reverse;gap:2px;align-items:center;min-height:${Math.min(maxLen, 12) * 24 + 8}px;border:2px solid ${active};border-top:none;border-radius:0 0 8px 8px;padding:3px 1px;">
        ${arr.map((x) => `<span style="font-family:var(--font-monospace);font-size:11px;padding:1px 3px;border-radius:4px;background:${sortedB.has(b) ? "#2b8a3e" : "#3b82f6"};color:white;">${fmt(x)}</span>`).join("")}
      </div>
      <div style="font-size:10px;color:var(--text-muted);">#${b}<br>${rangeLabel(b)}</div></div>`;
  }).join("");
  outRow.innerHTML = `<span style="font-size:12px;color:var(--text-muted);align-self:center;">output:</span>` + gathered.map((x) => chip(x, false, false)).join("");
  narr.textContent = last ? last.text : `Bucket index = ⌊value × k${isInt() ? " / 100" : ""}⌋. Each bucket covers one slice of the range.`;
  const sizes = steps.filter((s) => s.phase === "sort").map((s) => s.sorted.length);
  const biggest = Math.max(0, ...sizes);
  const nlogn = Math.round(n * Math.log2(n));
  stats.innerHTML = `comparisons so far: <b>${comps}</b> · biggest bucket: <b>${biggest}</b> of ${n} · for reference n·log₂n ≈ ${nlogn}` +
    (biggest > n / 2 ? ` · ⚠️ most numbers landed in ONE bucket, so this is basically insertion sort: O(n²)` : "");
}

function stop() { clearInterval(timer); timer = null; playBtn.textContent = "▶ Play"; }
stepBtn.onclick = () => { stop(); if (pos < steps.length) { pos++; render(); } };
playBtn.onclick = () => {
  if (timer) return stop();
  if (pos >= steps.length) pos = 0;
  playBtn.textContent = "⏸ Pause";
  timer = setInterval(() => {
    if (!root.isConnected) return stop();
    if (pos >= steps.length) return stop();
    pos++; render();
  }, 650);
};
resetBtn.onclick = () => { stop(); pos = 0; render(); };
newBtn.onclick = () => build(true);
dataSel.onchange = () => { dataKind = dataSel.value; build(true); };
build(true);
