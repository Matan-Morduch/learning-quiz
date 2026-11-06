// shrink-thrash: when should a dynamic array shrink? Shrinking at ½ full makes push/pop at the boundary
// grow, shrink, grow… (each an O(n) copy). Shrinking at ¼ full leaves a gap, so the copies stop.
// input: { rule?: "half" | "quarter" (default "half"), start?: starting size = capacity, 2–16 (default 8) }

const opts = (typeof input === "object" && input) || {};
let rule = opts.rule === "quarter" ? "quarter" : "half";
const START = Math.max(2, Math.min(16, Math.round(Number(opts.start ?? 8)) || 8));
const MAXCAP = 64;

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
const ruleBtn = el("button", "", "", controls);
const pushBtn = el("button", "", "➕ push", controls);
const popBtn = el("button", "", "➖ pop", controls);
const autoBtn = el("button", "", "⚡ push, pop ×5", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const ruleLine = el("div", "font-weight:bold;margin:2px 0 6px;");
const header = el("div", "font-family:var(--font-monospace);font-size:13px;");
const cellsBox = el("div", "display:flex;gap:2px;flex-wrap:wrap;margin:6px 0;");
const note = el("div", "font-family:var(--font-monospace);font-size:12px;min-height:1.4em;");
const log = el("div", "font-family:var(--font-monospace);font-size:11px;color:var(--text-muted);margin-top:4px;min-height:5em;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let size, cap, copies, ops, resizes, busy, flash, msg, history;

function reset() {
  size = START; cap = START; copies = 0; ops = 0; resizes = 0; busy = false; flash = false;
  history = []; msg = `size ${size} = capacity ${cap}: sitting exactly on the boundary. Now push, then pop, then push…`;
  render();
}

function render() {
  ruleBtn.textContent = rule === "half" ? "⇄ use ¼ rule" : "⇄ use ½ rule";
  ruleLine.innerHTML = rule === "half"
    ? `Rule: grow ×2 when full · shrink to half when size ≤ <span style="color:var(--text-error)">½</span> capacity`
    : `Rule: grow ×2 when full · shrink to half when size ≤ <span style="color:#2b8a3e">¼</span> capacity`;
  const lim = rule === "half" ? cap / 2 : cap / 4;
  header.textContent = `size = ${size} · capacity = ${cap} · shrink when size ≤ ${lim}`;
  let h = "";
  for (let i = 0; i < cap; i++) {
    const filled = i < size;
    const mark = i === Math.floor(lim) - 1 ? "border-right:3px solid " + (rule === "half" ? "var(--text-error)" : "#2b8a3e") + ";" : "";
    h += `<div style="width:16px;height:22px;border-radius:3px;border:1px solid var(--background-modifier-border);${mark}
      background:${filled ? (flash ? "#e8590c" : "var(--interactive-accent)") : "transparent"};transition:background .2s;"></div>`;
  }
  cellsBox.innerHTML = h;
  note.textContent = msg;
  log.innerHTML = history.slice(-6).map((t) => `<div>${t}</div>`).join("");
  board.innerHTML = `Operations <b>${ops}</b> · resizes <b>${resizes}</b> · elements copied <b>${copies}</b> ` +
    `(${ops ? (copies / ops).toFixed(1) : "0"} per op)<br><span style="color:var(--text-muted);">` +
    (rule === "half"
      ? "½ rule: after a grow the array is exactly half full, so one pop shrinks it again → every op at the boundary is an O(n) copy (thrashing)."
      : "¼ rule: after a grow or shrink the array is half full, so you need about n/4 more pushes or pops before the next resize → amortized O(1).") +
    "</span>";
}

async function resize(newCap, why) {
  copies += size; resizes++;
  const moved = size;
  flash = true; render();
  await sleep(250); if (!root.isConnected) return false;
  const old = cap; cap = newCap; flash = false;
  return { old, moved, why };
}

async function push() {
  if (busy) return;
  if (size >= MAXCAP) { msg = `demo limit (${MAXCAP})`; render(); return; }
  busy = true; ops++;
  let r = null;
  if (size === cap) { r = await resize(cap * 2); if (!r) return; }
  size++;
  msg = r ? `push → full, grow ${r.old} → ${cap}: copied ${r.moved} 😩` : `push → size ${size}, no resize ✅`;
  history.push(`#${ops} push  size ${size}/${cap}  ${r ? `GROW  +${r.moved} copies` : "0 copies"}`);
  busy = false; render();
}

async function pop() {
  if (busy) return;
  if (size === 0) { msg = "empty"; render(); return; }
  busy = true; ops++;
  size--;
  const lim = rule === "half" ? cap / 2 : cap / 4;
  let r = null;
  if (size <= lim && cap > 1) { r = await resize(Math.floor(cap / 2)); if (!r) return; }
  msg = r ? `pop → size ${size} ≤ ${lim}: shrink ${r.old} → ${cap}, copied ${r.moved} 😩` : `pop → size ${size} > ${lim}: no resize ✅`;
  history.push(`#${ops} pop   size ${size}/${cap}  ${r ? `SHRINK +${r.moved} copies` : "0 copies"}`);
  busy = false; render();
}

ruleBtn.onclick = () => { if (busy) return; rule = rule === "half" ? "quarter" : "half"; reset(); };
pushBtn.onclick = () => push();
popBtn.onclick = () => pop();
autoBtn.onclick = async () => {
  if (busy) return;
  for (let k = 0; k < 5 && root.isConnected; k++) {
    await push(); await sleep(250); if (!root.isConnected) return;
    await pop(); await sleep(250); if (!root.isConnected) return;
  }
};
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
