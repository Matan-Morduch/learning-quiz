// spsc-ring: one producer (an interrupt) + one consumer (the main loop) sharing a ring
// buffer without a lock. The producer only ever writes `write`, the consumer only `read`,
// so nobody overwrites the other's variable. Switch to a shared `count` and replay the same
// interleaving: count±1 is load → change → store, and an interrupt in the middle loses an update.
// input: { mode?: "indexes" | "count" (default "indexes") }

const opts = (typeof input === "object" && input) || {};
let mode = opts.mode === "count" ? "count" : "indexes";
const CAP = 8;

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
const modeRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const idxBtn = el("button", "", "read + write only", modeRow);
const cntBtn = el("button", "", "shared count", modeRow);
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;");
const runBtn = el("button", "", "▶ Run both", controls);
const raceBtn = el("button", "", "⚡ Interrupt mid-dequeue", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const actors = el("div", "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;");
const prodBox = el("div", "flex:1;min-width:150px;padding:6px 8px;border-radius:6px;border:2px solid #e8590c;font-size:12px;", null, actors);
const consBox = el("div", "flex:1;min-width:150px;padding:6px 8px;border-radius:6px;border:2px solid #2b8a3e;font-size:12px;", null, actors);
const cells = el("div", "display:flex;gap:3px;flex-wrap:wrap;margin-top:10px;");
const varsEl = el("div", "font-family:var(--font-monospace);font-size:12px;margin-top:6px;line-height:1.6;");
const note = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:3em;line-height:1.6;");

// ---------- state ----------
let data, read, write, count, next, busy = false, running = false, loopId = 0, who = {}, hl = {}, regs = "";
const size = () => (write - read + CAP) % CAP;              // leave-one-slot-empty: usable = CAP − 1
const full = () => (mode === "count" ? count === CAP - 1 : size() === CAP - 1);
const empty = () => (mode === "count" ? count === 0 : size() === 0);
const letter = () => String.fromCharCode(65 + (next++ % 26));

function reset(items = 3) {
  data = Array(CAP).fill(null); read = 0; write = 0; count = 0; next = 0; who = {}; hl = {}; regs = "";
  for (let k = 0; k < items; k++) { data[write] = letter(); write = (write + 1) % CAP; count++; }
  note.innerHTML = mode === "count"
    ? "Both sides now update <b>count</b>: producer count += 1, consumer count −= 1. Try ⚡."
    : "Producer writes only <b>write</b>, consumer writes only <b>read</b>. Try ⚡: nothing breaks.";
  render();
}

function render() {
  idxBtn.style.outline = mode === "indexes" ? "2px solid var(--interactive-accent)" : "none";
  cntBtn.style.outline = mode === "count" ? "2px solid var(--interactive-accent)" : "none";
  const c = mode === "count" ? ", <b>count</b>" : "";
  prodBox.innerHTML = `<b style="color:#e8590c">⚡ Producer</b> (interrupt)<br>writes: data[write], <b>write</b>${c}${regs && regs.p ? `<br>${regs.p}` : ""}`;
  consBox.innerHTML = `<b style="color:#2b8a3e">🔁 Consumer</b> (main loop)<br>writes: <b>read</b>${c}${regs && regs.c ? `<br>${regs.c}` : ""}`;
  let h = "";
  for (let i = 0; i < CAP; i++) {
    const v = data[i], border = i === read ? "3px solid #2b8a3e" : i === write ? "3px solid #e8590c" : "1px solid var(--background-modifier-border)";
    h += `<div style="width:34px;text-align:center;"><div style="height:30px;line-height:26px;border:${border};border-radius:4px;box-sizing:border-box;font-weight:bold;
      background:${hl[i] || (v != null ? "var(--interactive-accent)" : "transparent")};color:${v != null ? "var(--text-on-accent)" : "var(--text-faint)"};">${v ?? "·"}</div>
      <div style="font-size:10px;color:var(--text-muted)">${i}</div></div>`;
  }
  cells.innerHTML = h;
  const tag = (name) => (who[name] ? ` <span style="color:${who[name] === "P" ? "#e8590c" : "#2b8a3e"}">(last: ${who[name] === "P" ? "producer" : "consumer"})</span>` : "");
  const real = size();
  varsEl.innerHTML = `<span style="color:#2b8a3e">● read = ${read}</span>${tag("read")} · <span style="color:#e8590c">● write = ${write}</span>${tag("write")}` +
    (mode === "count" ? `<br>count = <b>${count}</b>${tag("count")} · items really stored = ${real} ${count === real ? "✅" : busy ? "⏳ mid-update" : "❌ count is WRONG"}` : `<br>size = (write − read + ${CAP}) % ${CAP} = <b>${real}</b> ✅`) +
    `<br>variables written by BOTH sides: <b>${mode === "count" ? "1 (count) → needs a lock" : "0 → no lock needed"}</b>`;
}

function produce() {
  if (full()) return "producer: full, byte dropped";
  const x = letter(); data[write] = x; hl = { [write]: "#e8590c" };
  write = (write + 1) % CAP; who.write = "P";
  if (mode === "count") { count++; who.count = "P"; }
  return `producer: data[${(write - 1 + CAP) % CAP}] = ${x}, write → ${write}${mode === "count" ? `, count → ${count}` : ""}`;
}
function consume() {
  if (empty()) return "consumer: empty, nothing to read";
  const x = data[read]; data[read] = null; hl = { [read]: "#2b8a3e" };
  read = (read + 1) % CAP; who.read = "C";
  if (mode === "count") { count--; who.count = "C"; }
  return `consumer: got ${x}, read → ${read}${mode === "count" ? `, count → ${count}` : ""}`;
}

async function run() {
  const id = ++loopId;
  while (running && id === loopId && root.isConnected) {
    note.textContent = Math.random() < 0.5 ? produce() : consume();
    render();
    await sleep(450);
  }
}

// the same interleaving in both modes: consumer is interrupted in the middle of its update
async function race() {
  if (busy) return;
  running = false; runBtn.textContent = "▶ Run both"; loopId++;
  busy = true; reset(3);
  const steps = [];
  if (mode === "count") {
    let tmp;
    steps.push(() => { const x = data[read]; data[read] = null; hl = { [read]: "#2b8a3e" }; read = (read + 1) % CAP; who.read = "C"; regs = { c: `took ${x}, then tmp = count` }; return `consumer takes ${x}, read → ${read}. Now count −= 1, which is 3 CPU steps: load, subtract, store`; });
    steps.push(() => { tmp = count; regs = { c: `tmp = ${tmp} (loaded)` }; return `consumer: tmp = count = ${tmp}   (1. load)`; });
    steps.push(() => { const x = letter(); data[write] = x; hl = { [write]: "#e8590c" }; write = (write + 1) % CAP; who.write = "P"; count++; who.count = "P"; regs = { c: `tmp = ${tmp} (paused!)`, p: `count = ${count}` }; return `⚡ INTERRUPT! producer stores ${x}, count = count + 1 = ${count}`; });
    steps.push(() => { count = tmp - 1; who.count = "C"; regs = { c: `count = ${tmp} − 1 = ${count}` }; return `consumer resumes with its OLD tmp: count = ${tmp} − 1 = ${count}. The producer's +1 is lost ❌ (${size()} items stored)`; });
  } else {
    let tmp;
    steps.push(() => { const x = data[read]; data[read] = null; hl = { [read]: "#2b8a3e" }; regs = { c: `took ${x}` }; return `consumer takes ${x} from data[${read}]. Now read = read + 1: load, add, store`; });
    steps.push(() => { tmp = read; regs = { c: `tmp = ${tmp} (loaded)` }; return `consumer: tmp = read = ${tmp}   (1. load)`; });
    steps.push(() => { const x = letter(); data[write] = x; hl = { [write]: "#e8590c" }; write = (write + 1) % CAP; who.write = "P"; regs = { c: `tmp = ${tmp} (paused!)`, p: `write = ${write}` }; return `⚡ INTERRUPT! producer stores ${x}, write → ${write}. It never touches read`; });
    steps.push(() => { read = (tmp + 1) % CAP; who.read = "C"; regs = { c: `read = ${read}` }; return `consumer resumes: read = ${tmp} + 1 = ${read}. Nothing was lost ✅ size = ${size()}`; });
  }
  for (const s of steps) {
    await sleep(1100);
    if (!root.isConnected) return;
    note.innerHTML = s();
    render();
  }
  busy = false;
  render();
}

function setMode(m) { if (busy) return; mode = m; running = false; loopId++; runBtn.textContent = "▶ Run both"; reset(); }
idxBtn.onclick = () => setMode("indexes");
cntBtn.onclick = () => setMode("count");
runBtn.onclick = () => {
  if (busy) return;
  running = !running;
  runBtn.textContent = running ? "⏸ Pause" : "▶ Run both";
  if (running) run();
};
raceBtn.onclick = race;
resetBtn.onclick = () => { if (busy) return; running = false; loopId++; runBtn.textContent = "▶ Run both"; reset(); };

reset();
el("div", "font-size:11px;color:var(--text-muted);margin-top:6px;", "Real code still needs atomics / memory barriers so the CPU can't publish write before data[write] is stored.");
