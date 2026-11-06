// search-race: linear scan (O(n)) vs binary search (O(log n)) looking for the same value, step by step.
// Binary search needs a sorted array and O(1) index access; shuffle the array and it's out of the race.
// input: { n?: array length 8–64 (default 32), sorted?: start sorted (default true) }

const opts = (typeof input === "object" && input) || {};
let N = Math.max(8, Math.min(64, Math.round(Number(opts.n ?? 32)) || 32));
let sorted = opts.sorted !== false;

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
const raceBtn = el("button", "", "▶ Race", controls);
const tgtBtn = el("button", "", "🎯 New target", controls);
const sortBtn = el("button", "", "", controls);
const nLab = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
el("span", "", "n", nLab);
const nIn = el("input", "width:100px;", null, nLab);
nIn.type = "range"; nIn.min = 8; nIn.max = 64; nIn.value = N;
const nVal = el("span", "font-family:var(--font-monospace);", "", nLab);

const tgtLine = el("div", "font-weight:bold;margin:4px 0;");
const linTitle = el("div", "margin-top:6px;font-weight:bold;", "🐢 Linear scan: check every element in order");
const linCells = el("div", "display:flex;gap:2px;flex-wrap:wrap;margin:4px 0;");
const linNote = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");
const binTitle = el("div", "margin-top:8px;font-weight:bold;", "🐇 Binary search: look at the middle, throw away half");
const binCells = el("div", "display:flex;gap:2px;flex-wrap:wrap;margin:4px 0;");
const binNote = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let vals, target, busy = false, lin, bin, seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function build() {
  vals = Array.from({ length: N }, (_, i) => 3 + i * 3 + (i % 3)); // strictly increasing, distinct
  if (!sorted) for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
  if (target == null || !vals.includes(target)) target = [...vals].sort((a, b) => a - b)[Math.round(N * 0.8)];
  resetRace();
}
function resetRace() {
  lin = { i: -1, steps: 0, found: -1, done: false };
  bin = { lo: 0, hi: N - 1, mid: -1, steps: 0, found: -1, done: !sorted };
  render();
}

function cells(box, hlFn) {
  let h = "";
  for (let i = 0; i < N; i++) {
    const [bg, fg, op] = hlFn(i);
    h += `<div style="width:26px;height:24px;line-height:24px;text-align:center;font-size:11px;border-radius:4px;border:1px solid var(--background-modifier-border);background:${bg};color:${fg};opacity:${op};">${vals[i]}</div>`;
  }
  box.innerHTML = h;
}

function render() {
  sortBtn.textContent = sorted ? "🔀 Shuffle (unsorted)" : "↕ Sort";
  nVal.textContent = String(N);
  tgtLine.innerHTML = `Looking for <span style="color:#e8590c">${target}</span> in ${N} ${sorted ? "sorted" : "unsorted"} values`;
  const acc = ["var(--interactive-accent)", "var(--text-on-accent)", 1];
  cells(linCells, (i) => {
    if (i === lin.found) return ["#2b8a3e", "#fff", 1];
    if (i === lin.i) return ["#e8590c", "#fff", 1];
    if (i < lin.i) return ["var(--background-secondary)", "var(--text-faint)", 0.6];
    return acc;
  });
  cells(binCells, (i) => {
    if (!sorted) return ["var(--background-secondary)", "var(--text-faint)", 0.5];
    if (i === bin.found) return ["#2b8a3e", "#fff", 1];
    if (i === bin.mid) return ["#e8590c", "#fff", 1];
    if (i < bin.lo || i > bin.hi) return ["var(--background-secondary)", "var(--text-faint)", 0.35];
    return acc;
  });
  if (lin.i < 0) linNote.textContent = "waiting…";
  else linNote.textContent = lin.found >= 0 ? `found at index ${lin.found} after ${lin.steps} comparisons` : `arr[${lin.i}] = ${vals[lin.i]} ≠ ${target} → next (steps: ${lin.steps})`;
  if (!sorted) binNote.textContent = "✗ can't run: halving only works if the array is sorted";
  else if (bin.mid < 0) binNote.textContent = `waiting… (worst case ⌈log₂(${N}+1)⌉ = ${Math.ceil(Math.log2(N + 1))} steps)`;
  else if (bin.found >= 0) binNote.textContent = `found at index ${bin.found} after ${bin.steps} comparisons`;
  else binNote.textContent = `mid = ${bin.mid}: ${vals[bin.mid]} ${vals[bin.mid] < target ? "<" : ">"} ${target} → keep [${bin.lo}…${bin.hi}] (steps: ${bin.steps})`;
  board.innerHTML = `Steps: <b>linear ${lin.steps}</b> vs <b>binary ${sorted ? bin.steps : "—"}</b>.<br>` +
    `<span style="color:var(--text-muted);">Linear: up to n = ${N} checks, <b>O(n)</b>, works on any order. ` +
    `Binary: halves the range each step, <b>O(log n)</b>, needs sorted data and O(1) access to arr[mid]. ` +
    `For n = 1,000,000: up to 1,000,000 vs about 20.</span>`;
}

function stepLin() {
  if (lin.done) return;
  lin.i++; lin.steps++;
  if (vals[lin.i] === target) { lin.found = lin.i; lin.done = true; }
  else if (lin.i >= N - 1) lin.done = true;
}
function stepBin() {
  if (bin.done) return;
  if (bin.lo > bin.hi) { bin.done = true; return; }
  bin.mid = Math.floor((bin.lo + bin.hi) / 2); bin.steps++;
  const v = vals[bin.mid];
  if (v === target) { bin.found = bin.mid; bin.done = true; }
  else if (v < target) bin.lo = bin.mid + 1;
  else bin.hi = bin.mid - 1;
}

async function race() {
  if (busy) return;
  busy = true;
  resetRace();
  while (!(lin.done && bin.done)) {
    stepLin(); stepBin();
    render();
    await sleep(Math.max(60, 2400 / N)); if (!root.isConnected) return;
  }
  busy = false;
}

raceBtn.onclick = () => race();
tgtBtn.onclick = () => { if (busy) return; target = vals[Math.floor(rnd() * N)]; resetRace(); };
sortBtn.onclick = () => { if (busy) return; sorted = !sorted; build(); };
nIn.oninput = () => { if (busy) { nIn.value = N; return; } N = Number(nIn.value); target = null; build(); };

build();
