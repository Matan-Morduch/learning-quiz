// array-shift: insert or delete at index i in an array. Everything after i has to shift (animated), so it costs O(n − i).
// Insert/delete at the end moves nothing; at index 0 it moves everything.
// input: { op?: "insert" | "delete" (default "insert"), index?: position (default 2), n?: starting items 3–11 (default 8) }

const opts = (typeof input === "object" && input) || {};
const CAP = 12;
const N0 = Math.max(3, Math.min(CAP - 1, Math.round(Number(opts.n ?? 8)) || 8));
let op = opts.op === "delete" ? "delete" : "insert";
let index = Math.max(0, Math.round(Number(opts.index ?? 2)) || 0);

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
const opBtn = el("button", "", "", controls);
const iLab = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
el("span", "", "i =", iLab);
const iIn = el("input", "width:120px;", null, iLab);
iIn.type = "range"; iIn.min = 0;
const iVal = el("span", "font-family:var(--font-monospace);min-width:1.5em;", "", iLab);
const goBtn = el("button", "", "", controls);
const endBtn = el("button", "", "", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const cellsBox = el("div", "display:flex;gap:3px;flex-wrap:wrap;margin:6px 0;");
const note = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");
const board = el("div", "margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let arr, next, busy, hl, msg, lastMoves, totalMoves;

function reset() {
  arr = [];
  for (let i = 0; i < N0; i++) arr.push(String.fromCharCode(65 + i));
  next = N0; busy = false; hl = {}; lastMoves = null; totalMoves = 0;
  msg = "";
  render();
}

function maxIndex() { return op === "insert" ? arr.length : Math.max(0, arr.length - 1); }

function render() {
  index = Math.min(index, maxIndex());
  iIn.max = maxIndex(); iIn.value = index; iVal.textContent = String(index);
  opBtn.textContent = op === "insert" ? "⇄ switch to delete" : "⇄ switch to insert";
  goBtn.textContent = op === "insert" ? `➕ insert at ${index}` : `➖ delete at ${index}`;
  endBtn.textContent = op === "insert" ? "➕ append (end)" : "➖ pop (end)";
  let h = "";
  for (let i = 0; i < CAP; i++) {
    const v = arr[i];
    const filled = v != null;
    const target = i === index && !busy;
    const bg = hl[i] || (filled ? "var(--interactive-accent)" : "transparent");
    h += `<div style="width:34px;text-align:center;">
      <div style="height:32px;line-height:28px;border:${target ? "2px dashed #e8590c" : "1px solid var(--background-modifier-border)"};border-radius:5px;font-weight:bold;
        background:${bg};color:${filled ? "var(--text-on-accent)" : "var(--text-faint)"};transition:background .15s;">${filled ? v : "·"}</div>
      <div style="font-size:10px;color:${target ? "#e8590c" : "var(--text-muted)"};">${i}</div></div>`;
  }
  cellsBox.innerHTML = h;
  const n = arr.length;
  const predicted = op === "insert" ? n - index : n - 1 - index;
  note.textContent = msg || `size n = ${n}. ${op === "insert" ? "Insert" : "Delete"} at i = ${index} will move n − ${op === "insert" ? "i" : "i − 1"} = ${predicted} element(s).`;
  board.innerHTML = (lastMoves == null ? "" : `Last operation moved <b>${lastMoves}</b> element(s). Total moves so far: <b>${totalMoves}</b>.<br>`) +
    `<span style="color:var(--text-muted);">Cost = number of elements after i → <b>O(n − i)</b>. At the end: 0 moves, O(1). At index 0: all n move, O(n).</span>`;
}

async function insertAt(i, fast = false) {
  if (busy) return;
  if (arr.length >= CAP) { msg = `full (capacity ${CAP}): a real dynamic array would resize first. Delete something.`; render(); return; }
  busy = true;
  const x = String.fromCharCode(97 + (next++ % 26));
  const n = arr.length;
  let moves = 0;
  const stepMs = fast ? 60 : Math.max(120, 1200 / Math.max(1, n - i));
  // shift from the END backwards, so nothing gets overwritten
  for (let j = n - 1; j >= i; j--) {
    arr[j + 1] = arr[j]; arr[j] = null;
    moves++;
    hl = { [j + 1]: "#e8590c" };
    msg = `shift ${arr[j + 1]}: index ${j} → ${j + 1} (move #${moves})`;
    render();
    await sleep(stepMs); if (!root.isConnected) return;
  }
  arr[i] = x;
  hl = { [i]: "#2b8a3e" };
  lastMoves = moves; totalMoves += moves;
  msg = `wrote ${x} at index ${i}. Moved ${moves} element(s) = n − i = ${n} − ${i}${moves === 0 ? " → O(1) ✅" : ""}`;
  busy = false;
  render();
}

async function deleteAt(i, fast = false) {
  if (busy) return;
  if (arr.length === 0) { msg = "empty: nothing to delete"; render(); return; }
  busy = true;
  const n = arr.length;
  const x = arr[i];
  hl = { [i]: "var(--text-error)" };
  msg = `removing ${x} at index ${i}…`;
  render();
  await sleep(fast ? 80 : 450); if (!root.isConnected) return;
  arr[i] = null;
  let moves = 0;
  const stepMs = fast ? 60 : Math.max(120, 1200 / Math.max(1, n - 1 - i));
  // shift from the gap FORWARDS to close it
  for (let j = i + 1; j < n; j++) {
    arr[j - 1] = arr[j]; arr[j] = null;
    moves++;
    hl = { [j - 1]: "#e8590c" };
    msg = `shift ${arr[j - 1]}: index ${j} → ${j - 1} (move #${moves})`;
    render();
    await sleep(stepMs); if (!root.isConnected) return;
  }
  arr.length = n - 1;
  hl = {};
  lastMoves = moves; totalMoves += moves;
  msg = `deleted ${x}. Moved ${moves} element(s) = n − i − 1 = ${n} − ${i} − 1${moves === 0 ? " → just size--, O(1) ✅" : ""}`;
  busy = false;
  render();
}

opBtn.onclick = () => { if (busy) return; op = op === "insert" ? "delete" : "insert"; msg = ""; hl = {}; render(); };
iIn.oninput = () => { if (busy) return; index = Number(iIn.value); msg = ""; hl = {}; render(); };
goBtn.onclick = () => (op === "insert" ? insertAt(index) : deleteAt(index));
endBtn.onclick = () => (op === "insert" ? insertAt(arr.length) : deleteAt(arr.length - 1));
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
