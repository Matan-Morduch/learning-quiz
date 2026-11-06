// buffer-vs-cache: the same request stream sent through a buffer and through a cache.
// Buffer = waiting room: every item is fetched from the slow source, passes through once (FIFO), then is gone.
// Cache = shortcut shelf: keeps copies, so a repeated request is a fast HIT with no fetch.
// input: { stream?: string of requests, one letter each (default "ABACABA"), cap?: cache slots (1–5, default 3) }

const opts = (typeof input === "object" && input) || {};
const STREAM = (String(opts.stream ?? "ABACABA").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12)) || "ABACABA";
const CAP = Math.max(1, Math.min(5, Math.round(Number(opts.cap ?? 3)) || 3));
const BUF_HOLD = 2; // the consumer reads an item once 2 are waiting (so you can see items in transit)

// ---------- tiny DOM helpers ----------
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const box = (v, bg, border = "1px solid var(--background-modifier-border)") =>
  `<div style="width:30px;height:30px;line-height:28px;text-align:center;border:${border};border-radius:5px;font-weight:bold;` +
  `background:${bg};color:${v ? "#fff" : "var(--text-faint)"};transition:background .15s;">${v || "·"}</div>`;
const row = (label, inner) =>
  `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0;"><span style="width:92px;font-size:12px;color:var(--text-muted);">${label}</span>${inner}</div>`;

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const stepBtn = el("button", "", "➡ Next request", controls);
const allBtn = el("button", "", "⏩ Run all", controls);
const resetBtn = el("button", "", "↺ Reset", controls);
const reqEl = el("div", "");
const bufPanel = el("div", "margin-top:8px;padding:8px;border-radius:6px;border:2px solid #e8590c;");
const cachePanel = el("div", "margin-top:8px;padding:8px;border-radius:6px;border:2px solid #9c36b5;");
const narr = el("div", "margin-top:8px;font-family:var(--font-monospace);font-size:12px;min-height:2.8em;");
const score = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let pos, queue, received, bufFetches, shelf, hits, misses, flash, busy, lastBuf, lastCache;
function reset() {
  pos = 0; queue = []; received = []; bufFetches = 0;
  shelf = []; hits = 0; misses = 0; flash = {}; busy = false; lastBuf = ""; lastCache = "";
}

function render() {
  let r = "";
  for (let i = 0; i < STREAM.length; i++) {
    const bg = i < pos ? "var(--text-faint)" : i === pos ? "#3b82f6" : "var(--interactive-accent)";
    r += box(STREAM[i], bg, i === pos ? "3px solid #3b82f6" : undefined);
  }
  reqEl.innerHTML = row("requests →", r);

  let q = ""; for (let i = 0; i < BUF_HOLD; i++) q += box(queue[i], queue[i] ? (flash.buf === i ? "#e8590c" : "var(--interactive-accent)") : "transparent");
  let rc = received.map((v) => box(v, "#2b8a3e")).join("") || `<span style="color:var(--text-faint)">none yet</span>`;
  bufPanel.innerHTML = `<b style="color:#e8590c">🪣 Buffer</b> <span style="font-size:12px;color:var(--text-muted)">(in transit, FIFO, each item used once)</span>` +
    row("in buffer", q) + row("consumer got", rc) +
    `<div style="font-size:12px;">🐢 slow fetches from the source: <b>${bufFetches}</b></div>`;

  let s = ""; for (let i = 0; i < CAP; i++) s += box(shelf[i], shelf[i] ? (flash.cache === i ? (flash.hit ? "#2b8a3e" : "#e8590c") : "#9c36b5") : "transparent");
  cachePanel.innerHTML = `<b style="color:#9c36b5">📚 Cache</b> <span style="font-size:12px;color:var(--text-muted)">(keeps copies for reuse, ${CAP} slots, evicts least recently used)</span>` +
    row("on the shelf", s) +
    `<div style="font-size:12px;">✅ hits: <b>${hits}</b> · 🐢 misses = slow fetches: <b>${misses}</b></div>`;

  narr.innerHTML = (lastBuf || lastCache) ? `buffer: ${lastBuf}<br>cache: &nbsp;${lastCache}` : "Press ➡ to send the first request through both.";

  // precomputed totals for the whole stream, so the answer is visible up front
  const distinct = new Set(STREAM).size;
  let m = 0; const sim = [];
  for (const c of STREAM) { const k = sim.indexOf(c); if (k >= 0) sim.splice(k, 1); else { m++; if (sim.length === CAP) sim.shift(); } sim.push(c); }
  score.innerHTML = `For all ${STREAM.length} requests (${distinct} different items): buffer fetches <b>${STREAM.length}</b> times, ` +
    `cache fetches only <b>${m}</b> and serves <b>${STREAM.length - m}</b> repeats from its copies.`;
}

async function step(fast = false) {
  if (busy || pos >= STREAM.length) return;
  busy = true;
  const c = STREAM[pos];
  // buffer: fetch, enqueue; the consumer takes the oldest once BUF_HOLD are waiting
  bufFetches++;
  queue.push(c);
  flash = { buf: queue.length - 1 };
  lastBuf = `fetched ${c} from the source, queued (${queue.length} waiting)`;
  // cache: hit or miss (LRU)
  const k = shelf.indexOf(c);
  if (k >= 0) {
    hits++; shelf.splice(k, 1); shelf.push(c);
    flash.cache = shelf.length - 1; flash.hit = true;
    lastCache = `${c} is already on the shelf → HIT, no fetch ⚡`;
  } else {
    misses++;
    let ev = "";
    if (shelf.length === CAP) ev = ` (evicted ${shelf.shift()})`;
    shelf.push(c);
    flash.cache = shelf.length - 1; flash.hit = false;
    lastCache = `${c} not on the shelf → MISS, fetched and kept a copy${ev}`;
  }
  pos++;
  render();
  await sleep(fast ? 150 : 500);
  if (!root.isConnected) return;
  const outs = [];
  while (queue.length && (queue.length >= BUF_HOLD || pos >= STREAM.length)) outs.push(queue.shift());
  if (outs.length) {
    received.push(...outs);
    lastBuf += ` → consumer read ${outs.join(", ")}; gone from the buffer`;
  }
  flash = {};
  render();
  busy = false;
}

stepBtn.onclick = () => step(false);
allBtn.onclick = async () => {
  if (busy) return;
  while (pos < STREAM.length && root.isConnected) await step(true);
  while (queue.length && root.isConnected) { received.push(queue.shift()); }
  render();
};
resetBtn.onclick = () => { if (!busy) { reset(); render(); } };

reset();
render();
