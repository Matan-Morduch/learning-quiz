// front-removal: why dequeuing from the front of a plain array is O(n), and a ring buffer's is O(1).
// Side by side: the array shifts every element left, while the ring only moves its read index.
// input: { n?: number of starting items (3–12, default 6) }

const opts = (typeof input === "object" && input) || {};
const CAP = 12;
const START = Math.max(3, Math.min(CAP, opts.n ?? 6));

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

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;");
const deqBtn = el("button", "", "➖ Dequeue (remove front)", controls);
const enqBtn = el("button", "", "➕ Enqueue", controls);
const allBtn = el("button", "", "⏩ Dequeue all", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const arrTitle = el("div", "font-weight:bold;margin-top:4px;", "📦 Plain array: dequeue = pop(0)");
const arrCells = el("div", "display:flex;gap:3px;flex-wrap:wrap;margin:6px 0;");
const arrStats = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");

const ringTitle = el("div", "font-weight:bold;margin-top:12px;", "🔄 Ring buffer: dequeue = read index + 1");
const ringCells = el("div", "display:flex;gap:3px;flex-wrap:wrap;margin:6px 0;");
const ringStats = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");

const scoreboard = el("div", "margin-top:12px;padding:8px;border-radius:6px;background:var(--background-secondary);");

// ---------- state ----------
let arr, ring, read, write, count, nextLetter, arrMovesTotal, arrMovesLast, busy, arrHl, ringHl, arrNote, ringNote;

function reset() {
  arr = [];
  ring = Array(CAP).fill(null);
  read = 0; write = 0; count = 0; nextLetter = 0;
  arrMovesTotal = 0; arrMovesLast = 0; busy = false;
  arrHl = {}; ringHl = {}; arrNote = ""; ringNote = "";
  for (let i = 0; i < START; i++) enqueueBoth(false);
  render();
}

function enqueueBoth(show = true) {
  if (count === CAP) { if (show) { arrNote = ringNote = "full: dequeue something first"; render(); } return; }
  const x = String.fromCharCode(65 + (nextLetter++ % 26));
  arr.push(x);
  ring[write] = x;
  write = (write + 1) % CAP;
  count++;
  if (show) { arrNote = `appended ${x} at the end: O(1)`; ringNote = `wrote ${x} at the write index: O(1)`; arrHl = {}; ringHl = {}; render(); }
}

function cellsHtml(values, hl, markers = {}) {
  let h = "";
  for (let i = 0; i < CAP; i++) {
    const v = values[i];
    const filled = v != null;
    const bg = hl[i] || (filled ? "var(--interactive-accent)" : "transparent");
    const border = markers[i] || "1px solid var(--background-modifier-border)";
    h += `<div style="width:34px;text-align:center;">
      <div style="height:32px;line-height:30px;border:${border};border-radius:5px;font-weight:bold;
        background:${bg};color:${filled ? "var(--text-on-accent)" : "var(--text-faint)"};transition:background .15s;">${filled ? v : "·"}</div>
      <div style="font-size:10px;color:var(--text-muted);">${i}</div></div>`;
  }
  return h;
}

function render() {
  arrCells.innerHTML = cellsHtml(arr, arrHl);
  arrStats.textContent = arrNote || `size = ${arr.length} · last dequeue moved ${arrMovesLast} element(s)`;
  const markers = {};
  if (count > 0) markers[read] = "3px solid #2b8a3e";
  if (count < CAP) markers[write] = markers[write] ? markers[write] : "3px solid #e8590c";
  ringCells.innerHTML = cellsHtml(ring, ringHl, markers);
  ringStats.innerHTML = ringNote ||
    `<span style="color:#2b8a3e">■ read = ${read}</span> · <span style="color:#e8590c">■ write = ${write}</span> · size = ${count} · moved 0 elements`;
  scoreboard.innerHTML =
    `Total element moves so far: <b>array ${arrMovesTotal}</b> vs <b>ring 0</b><br>` +
    `<span style="color:var(--text-muted);font-size:13px;">Removing all n items from an array costs (n−1) + (n−2) + … + 1 = n(n−1)/2 moves → <b>O(n)</b> per dequeue, <b>O(n²)</b> total. ` +
    `The ring never moves anything → <b>O(1)</b> per dequeue.</span>`;
}

async function dequeueBoth(fast = false) {
  if (busy) return;
  if (count === 0) { arrNote = ringNote = "empty: nothing to dequeue"; render(); return; }
  busy = true;
  const x = arr[0];

  // ring: one step, instant
  ringHl = { [read]: "var(--text-error)" };
  // array: the front element leaves...
  arrHl = { 0: "var(--text-error)" };
  arrNote = `removing ${x} from index 0…`;
  ringNote = `reading ${x} at read = ${read}…`;
  render();
  await sleep(fast ? 60 : 450);
  if (!root.isConnected) return;

  ring[read] = null;
  const oldRead = read;
  read = (read + 1) % CAP;
  count--;
  ringHl = {};
  ringNote = `done: read = (${oldRead} + 1) % ${CAP} = ${read}. Nothing else moved. ✅`;

  // ...and every other element has to slide one step left
  arr[0] = null;
  arrMovesLast = 0;
  const n = arr.length;
  const stepMs = fast ? 25 : Math.max(90, 900 / n);
  for (let j = 1; j < n; j++) {
    arr[j - 1] = arr[j];
    arr[j] = null;
    arrMovesLast++;
    arrMovesTotal++;
    arrHl = { [j - 1]: "#e8590c" };
    arrNote = `shifting ${arr[j - 1]}: index ${j} → ${j - 1} (move #${arrMovesLast})`;
    render();
    await sleep(stepMs);
    if (!root.isConnected) return;
  }
  arr.length = n - 1;
  arrHl = {};
  arrNote = `done: ${arrMovesLast} element(s) had to move for ONE dequeue 😩`;
  render();
  busy = false;
}

deqBtn.onclick = () => dequeueBoth(false);
enqBtn.onclick = () => { if (!busy) enqueueBoth(true); };
allBtn.onclick = async () => {
  if (busy) return;
  while (count > 0 && root.isConnected) await dequeueBoth(true);
};
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
