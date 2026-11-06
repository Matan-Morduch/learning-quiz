// write-back: why you "safely eject" a USB drive.
// Saving puts the file's blocks into the OS write buffer in RAM (fast, the app says "Saved").
// The OS drains them to the slow USB stick later. Yank early → the blocks still in RAM are lost.
// Eject = flush: the OS writes everything out first, then says it's safe.
// input: { blocks?: blocks in the file (4–16, default 10) }

const opts = (typeof input === "object" && input) || {};
const N = Math.max(4, Math.min(16, Math.round(Number(opts.blocks ?? 10)) || 10));
const LAZY_MS = 700;   // the OS drains slowly in the background
const FLUSH_MS = 180;  // eject: write everything now

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

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const saveBtn = el("button", "", "💾 Save file", controls);
const ejectBtn = el("button", "", "⏏ Safely eject", controls);
const yankBtn = el("button", "", "🔌 Yank USB now", controls);
const resetBtn = el("button", "", "↺ Reset", controls);
const lanes = el("div", "display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;");
const ramPane = el("div", "flex:1;min-width:150px;padding:8px;border:2px solid #3b82f6;border-radius:8px;", null, lanes);
const usbPane = el("div", "flex:1;min-width:150px;padding:8px;border:2px solid #2b8a3e;border-radius:8px;", null, lanes);
const narr = el("div", "margin-top:8px;font-family:var(--font-monospace);font-size:12px;min-height:1.4em;");
const verdict = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-weight:bold;");

// ---------- state ----------
let ram, usb, lost, plugged, flushing, saved, timer;
function reset() {
  stopTimer();
  ram = []; usb = []; lost = []; plugged = true; flushing = false; saved = false;
  // start right after a save: the app already said "Saved ✅" but every block is still in RAM
  for (let i = 1; i <= N; i++) ram.push(i);
  saved = true;
  narr.textContent = `app: "Saved ✅" … but all ${N} blocks are still in the RAM write buffer. The OS writes later, in batches.`;
  render();
}
function stopTimer() { if (timer) clearTimeout(timer); timer = null; }

function blocks(list, color, strike = false) {
  return `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:6px;min-height:26px;">` +
    list.map((b) => `<div style="width:26px;height:26px;line-height:26px;text-align:center;border-radius:4px;font-size:11px;font-weight:bold;` +
      `background:${color};color:#fff;${strike ? "text-decoration:line-through;opacity:0.8;" : ""}">${b}</div>`).join("") + `</div>`;
}
function render() {
  ramPane.innerHTML = `<b style="color:#3b82f6">🧠 RAM write buffer</b> <span style="font-size:12px;color:var(--text-muted)">(fast)</span>` +
    blocks(ram, "#3b82f6") +
    (lost.length ? `<div style="font-size:12px;color:var(--text-error);margin-top:4px;">never written:</div>` + blocks(lost, "#d6336c", true) : "");
  usbPane.innerHTML = `<b style="color:#2b8a3e">🔑 USB stick</b> <span style="font-size:12px;color:var(--text-muted)">(slow) ${plugged ? "plugged in" : "❌ removed"}</span>` +
    blocks(usb, "#2b8a3e");
  if (!plugged) verdict.innerHTML = lost.length
    ? `<span style="color:var(--text-error)">💥 File on the stick is corrupt: ${usb.length}/${N} blocks written, ${lost.length} lost.</span>`
    : `<span style="color:#2b8a3e">✅ All ${N}/${N} blocks were on the stick. File is fine.</span>`;
  else if (flushing) verdict.textContent = `⏳ Ejecting: flushing ${ram.length} block(s)… don't pull it out yet`;
  else if (ram.length === 0 && saved) verdict.innerHTML = `<span style="color:#2b8a3e">✅ Buffer empty: ${N}/${N} blocks on the stick. Safe to remove.</span>`;
  else verdict.textContent = `on stick ${usb.length}/${N} · still only in RAM: ${ram.length} → yanking now would lose ${ram.length}`;
  saveBtn.disabled = !plugged;
  ejectBtn.disabled = !plugged || flushing;
  yankBtn.disabled = !plugged;
}

function drain() {
  timer = null;
  if (!root.isConnected || !plugged) return;
  if (ram.length === 0) {
    if (flushing) { flushing = false; narr.textContent = "flush done → OS: \"Safe to remove\" ✅"; }
    render();
    return;
  }
  const b = ram.shift();
  usb.push(b);
  narr.textContent = `${flushing ? "flush" : "OS background write"}: block ${b} RAM → USB (${ram.length} left in RAM)`;
  render();
  timer = setTimeout(drain, flushing ? FLUSH_MS : LAZY_MS);
}

saveBtn.onclick = () => {
  if (!plugged) return;
  // re-save: the whole file goes back into the buffer, and the OS starts writing it lazily
  stopTimer();
  ram = []; usb = []; lost = []; saved = true; flushing = false;
  for (let i = 1; i <= N; i++) ram.push(i);
  narr.textContent = `saved in ~0 ms: ${N} blocks copied into RAM. The OS now trickles them to the stick in the background…`;
  render();
  timer = setTimeout(drain, LAZY_MS);
};
ejectBtn.onclick = () => {
  if (!plugged || flushing) return;
  stopTimer();
  flushing = true;
  narr.textContent = `eject → flush: write all ${ram.length} buffered block(s) now`;
  render();
  timer = setTimeout(drain, FLUSH_MS);
};
yankBtn.onclick = () => {
  if (!plugged) return;
  stopTimer();
  plugged = false; flushing = false;
  lost = ram; ram = [];
  narr.textContent = lost.length ? `yanked with ${lost.length} block(s) still in RAM → they can never reach the stick` : "yanked after the buffer was empty → nothing lost";
  render();
};
resetBtn.onclick = reset;

reset();
