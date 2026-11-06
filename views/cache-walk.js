// cache-walk: why arrays are fast beyond Big-O. RAM is read in 64-byte cache lines.
// Walking an array touches consecutive lines (one load serves 8 elements); a linked list's nodes are scattered,
// so nearly every step is a cache miss. Both walks are O(n), but the load counts are very different.
// input: { n?: number of elements 8–32 (default 16) }

const opts = (typeof input === "object" && input) || {};
const N = Math.max(8, Math.min(32, Math.round(Number(opts.n ?? 16)) || 16));
const LINES = 32, PER_ROW = 8, SLOTS = 8; // 32 cache lines of 64 B = 8 slots of 8 B each

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

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const walkBtn = el("button", "", "▶ Walk both", controls);
const stepBtn = el("button", "", "⏭ Step", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const aTitle = el("div", "font-weight:bold;margin-top:4px;", `📦 Array: ${N} × 8 B elements, back to back`);
const aSvg = el("div", "");
const aNote = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");
const lTitle = el("div", "font-weight:bold;margin-top:10px;", `🔗 Linked list: ${N} nodes (8 B value + 8 B next) wherever malloc put them`);
const lSvg = el("div", "");
const lNote = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- layout ----------
// array element i → slot i in lines 0.. ; list node k → a scattered (line, slot pair)
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const arrPos = Array.from({ length: N }, (_, i) => ({ line: Math.floor(i / SLOTS), slot: i % SLOTS, w: 1 }));
const listPos = [];
{
  const taken = new Set();
  for (let k = 0; k < N; k++) {
    let line, slot;
    do { line = Math.floor(rnd() * LINES); slot = 2 * Math.floor(rnd() * 4); } while (taken.has(line * 8 + slot));
    taken.add(line * 8 + slot);
    listPos.push({ line, slot, w: 2 });
  }
}

// ---------- state ----------
let step, aLoaded, lLoaded, aLoads, lLoads, aLast, lLast, busy;

function reset() {
  step = 0; aLoaded = new Set(); lLoaded = new Set(); aLoads = 0; lLoads = 0; aLast = ""; lLast = ""; busy = false;
  render();
}

function memSvg(pos, loaded, cur) {
  const W = 640, lw = (W - 16) / PER_ROW, sw = (lw - 6) / SLOTS, rh = 26;
  const rows = LINES / PER_ROW;
  let s = `<svg viewBox="0 0 ${W} ${rows * rh + 4}" width="100%" style="display:block;">`;
  for (let ln = 0; ln < LINES; ln++) {
    const x = 8 + (ln % PER_ROW) * lw, y = 2 + Math.floor(ln / PER_ROW) * rh;
    s += `<rect x="${x}" y="${y}" width="${lw - 6}" height="${rh - 6}" rx="3" fill="${loaded.has(ln) ? "rgba(59,130,246,0.22)" : "var(--background-secondary)"}" stroke="${loaded.has(ln) ? "#3b82f6" : "var(--background-modifier-border)"}"/>`;
  }
  pos.forEach((p, i) => {
    const x = 8 + (p.line % PER_ROW) * lw + p.slot * sw, y = 2 + Math.floor(p.line / PER_ROW) * rh;
    const done = i < cur, now = i === cur - 1;
    s += `<rect x="${x + 0.5}" y="${y + 2}" width="${p.w * sw - 1}" height="${rh - 10}" rx="2" fill="${now ? "#e8590c" : done ? "#2b8a3e" : "var(--interactive-accent)"}"/>`;
    s += `<text x="${x + (p.w * sw) / 2}" y="${y + 14}" font-size="8" text-anchor="middle" fill="#fff">${i}</text>`;
  });
  return s + "</svg>";
}

function render() {
  aSvg.innerHTML = memSvg(arrPos, aLoaded, step);
  lSvg.innerHTML = memSvg(listPos, lLoaded, step);
  aNote.textContent = aLast || "each box = one 64-byte cache line";
  lNote.textContent = lLast || "node i's next pointer leads to node i+1, somewhere else";
  board.innerHTML = `Cache-line loads from RAM after ${step} of ${N} elements: <b>array ${aLoads}</b> vs <b>list ${lLoads}</b>.<br>` +
    `<span style="color:var(--text-muted);">A miss costs roughly 100× a cache hit. The array's next element is almost always already in the line just loaded ` +
    `(and the prefetcher fetches the next line early). The list jumps around, so almost every node is a miss.</span>`;
}

function doStep() {
  if (step >= N) return false;
  const a = arrPos[step], l = listPos[step];
  if (aLoaded.has(a.line)) aLast = `arr[${step}] in line ${a.line}: hit ✅ (already cached)`;
  else { aLoaded.add(a.line); aLoads++; aLast = `arr[${step}] in line ${a.line}: miss → load 64 B = elements ${a.line * 8}…${Math.min(N, a.line * 8 + 8) - 1}`; }
  if (lLoaded.has(l.line)) lLast = `node ${step} in line ${l.line}: hit ✅ (lucky neighbor)`;
  else { lLoaded.add(l.line); lLoads++; lLast = `node ${step} in line ${l.line}: miss → load 64 B for one 16 B node 😩`; }
  step++;
  render();
  return true;
}

walkBtn.onclick = async () => {
  if (busy) return;
  if (step >= N) reset();
  busy = true;
  while (doStep()) { await sleep(Math.max(120, 3200 / N)); if (!root.isConnected) return; }
  busy = false;
};
stepBtn.onclick = () => { if (!busy) doStep(); };
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
