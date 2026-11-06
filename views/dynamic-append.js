// dynamic-append: what push(x) really does to a dynamic array.
// Size vs capacity; when full: allocate a bigger block, copy every element, free the old block, then write.
// input: { cap?: starting capacity 0–8 (default 1), factor?: growth factor 1.25–4 (default 2),
//          reserve?: show a reserve(target) button + "without reserve" comparison (default false),
//          target?: capacity that reserve() asks for, 4–32 (default 16),
//          showCode?: show the push pseudocode with the current line highlighted (default false) }

const opts = (typeof input === "object" && input) || {};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const CAP0 = clamp(Math.round(Number(opts.cap ?? 1)) || 0, 0, 8);
const FACTOR = clamp(Number(opts.factor ?? 2) || 2, 1.25, 4);
const RESERVE = !!opts.reserve;
const TARGET = clamp(Math.round(Number(opts.target ?? 16)) || 16, 4, 32);
const SHOW_CODE = !!opts.showCode;
const MAX = 32; // demo limit on size

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
const hex = (n) => "0x" + n.toString(16).toUpperCase();
const grow = (c) => Math.max(c + 1, Math.floor(c * FACTOR));

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;");
const pushBtn = el("button", "", "➕ push", controls);
const push8Btn = el("button", "", "⏩ push ×8", controls);
const resBtn = RESERVE ? el("button", "", `📦 reserve(${TARGET})`, controls) : null;
const resetBtn = el("button", "", "↺ Reset", controls);

const header = el("div", "font-family:var(--font-monospace);font-size:13px;margin-bottom:4px;");
const blocks = el("div", "");
const note = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:2.6em;margin-top:6px;");
const code = SHOW_CODE ? el("pre", "font-family:var(--font-monospace);font-size:12px;background:var(--background-secondary);border-radius:6px;padding:6px 0;margin:8px 0;overflow-x:auto;") : null;
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

const factorTxt = FACTOR === 2 ? "capacity * 2" : `floor(capacity * ${FACTOR})`;
const CODE = [
  "push(x):",
  "    if size == capacity:",
  `        new_cap = max(1, ${factorTxt})`,
  "        new_data = allocate(new_cap)",
  "        for i in 0 .. size-1:",
  "            new_data[i] = data[i]",
  "        free(data)",
  "        data = new_data; capacity = new_cap",
  "    data[size] = x",
  "    size += 1",
];

// ---------- state ----------
let data, size, cap, addr, nextAddr, copies, resizes, allocs, pushes, letter, busy, oldB, hlOld, hlNew, line, msg;

function reset() {
  cap = CAP0; data = Array(cap).fill(null); size = 0;
  addr = 0x1000; nextAddr = 0x1000 + Math.max(cap, 1) * 8 + 0x40;
  copies = 0; resizes = 0; allocs = cap > 0 ? 1 : 0; pushes = 0; letter = 0;
  busy = false; oldB = null; hlOld = {}; hlNew = {}; line = -1;
  msg = `empty array: size 0, capacity ${cap}. Press push.`;
  render();
}

function cells(arr, c, hl, used, faded) {
  let h = "";
  for (let i = 0; i < c; i++) {
    const v = arr[i];
    const filled = v != null && i < used;
    const bg = hl[i] || (filled ? "var(--interactive-accent)" : "transparent");
    h += `<div style="width:26px;text-align:center;opacity:${faded ? 0.35 : 1};">
      <div style="height:26px;line-height:24px;border:1px solid var(--background-modifier-border);border-radius:4px;font-weight:bold;
      background:${bg};color:${filled || hl[i] ? "var(--text-on-accent)" : "var(--text-faint)"};">${filled ? v : "·"}</div>
      <div style="font-size:9px;color:var(--text-muted);">${i}</div></div>`;
  }
  return h || `<div style="color:var(--text-faint);font-size:12px;">(no block yet: capacity 0)</div>`;
}

function blockHtml(label, arr, c, hl, used, faded) {
  return `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;${faded ? "text-decoration:line-through;" : ""}">${label}</div>
    <div style="display:flex;gap:2px;flex-wrap:wrap;margin:3px 0;">${cells(arr, c, hl, used, faded)}</div>`;
}

function render() {
  header.innerHTML = `size = <b>${size}</b> · capacity = <b>${cap}</b> · free = ${cap - size} · data → ${hex(addr)}`;
  let h = "";
  if (oldB) {
    h += blockHtml(`old block @${hex(oldB.addr)} (capacity ${oldB.cap})${oldB.freed ? " — freed" : ""}`, oldB.data, oldB.cap, hlOld, oldB.size, oldB.freed);
    h += blockHtml(`new block @${hex(oldB.newAddr)} (capacity ${oldB.newCap})`, oldB.newData, oldB.newCap, hlNew, oldB.newCap, false);
  } else {
    h += blockHtml(`block @${hex(addr)}`, data, cap, hlNew, size, false);
  }
  blocks.innerHTML = h;
  note.textContent = msg;
  if (code) {
    code.innerHTML = CODE.map((t, i) =>
      `<div style="padding:0 8px;${i === line ? "background:#e8590c;color:#fff;" : ""}">${t.replace(/</g, "&lt;")}</div>`).join("");
  }
  const avg = pushes ? (copies / pushes).toFixed(2) : "0";
  let b = `pushes <b>${pushes}</b> · resizes <b>${resizes}</b> · element copies <b>${copies}</b> · allocations <b>${allocs}</b><br>` +
    `<span style="color:var(--text-muted);">copies per push so far ≈ <b>${avg}</b>. Resizes are rare and get rarer, so the average stays small → amortized O(1).</span>`;
  if (RESERVE) {
    let c = CAP0, cp = 0, rs = 0;
    for (let s = 0; s < TARGET; s++) if (s === c) { cp += s; rs++; c = grow(c); }
    b += `<br><span style="color:var(--text-muted);">Filling ${TARGET} items from capacity ${CAP0} <b>without</b> reserve: ${rs} resizes, ${cp} copies. ` +
      `With reserve(${TARGET}) first: 1 allocation, 0 copies.</span>`;
  }
  board.innerHTML = b;
}

async function step(k, ms) {
  line = k; render();
  if (SHOW_CODE && ms) await sleep(ms);
  return root.isConnected;
}

// Allocate a new block of capacity nc, copy, free the old one. Animated.
async function resizeTo(nc, fast) {
  const d = fast ? 40 : 380;
  oldB = { data, cap, addr, size, freed: false, newCap: nc, newAddr: nextAddr, newData: Array(nc).fill(null) };
  nextAddr += nc * 8 + 0x40;
  allocs++;
  msg = `allocate a new block of ${nc} slots at ${hex(oldB.newAddr)} (the old one stays until the copy is done)`;
  if (!(await step(3, d))) return false;
  render(); await sleep(d); if (!root.isConnected) return false;
  for (let i = 0; i < size; i++) {
    oldB.newData[i] = data[i];
    copies++;
    hlOld = { [i]: "#e8590c" }; hlNew = { [i]: "#e8590c" };
    msg = `copy ${i + 1} of ${size}: new_data[${i}] = data[${i}] (${data[i]})`;
    if (!(await step(5, 0))) return false;
    await sleep(fast ? 25 : Math.max(90, 900 / size)); if (!root.isConnected) return false;
  }
  hlOld = {}; hlNew = {};
  oldB.freed = true;
  msg = `free(data): the old block at ${hex(oldB.addr)} goes back to the allocator. Copied ${size} element(s).`;
  if (!(await step(6, d))) return false;
  await sleep(d); if (!root.isConnected) return false;
  data = oldB.newData; addr = oldB.newAddr; cap = nc; oldB = null; resizes++;
  await step(7, d);
  return root.isConnected;
}

async function push(fast = false) {
  if (busy) return;
  if (size >= MAX) { msg = `demo limit: ${MAX} items. Reset to start over.`; render(); return; }
  busy = true;
  const x = String.fromCharCode(65 + (letter++ % 26));
  const d = fast ? 40 : 380;
  hlOld = {}; hlNew = {};
  msg = `push(${x}): is size (${size}) == capacity (${cap})?`;
  if (!(await step(1, d))) return;
  let resized = false, copied = size;
  if (size === cap) {
    const nc = grow(cap);
    msg = `yes → full! new_cap = max(1, ${FACTOR === 2 ? `${cap} × 2` : `floor(${cap} × ${FACTOR})`}) = ${nc}`;
    if (!(await step(2, d))) return;
    await sleep(fast ? 60 : 600); if (!root.isConnected) return;
    if (!(await resizeTo(nc, fast))) return;
    resized = true;
  }
  data[size] = x;
  hlNew = { [size]: "#2b8a3e" };
  if (!(await step(8, d))) return;
  size++; pushes++;
  msg = resized
    ? `data[${size - 1}] = ${x}. This push cost ${copied} copies + 1 write = O(n) 😬`
    : `no → room left: data[${size - 1}] = ${x}, size = ${size}. Cost: 1 write, O(1) ✅`;
  await step(9, d);
  if (!root.isConnected) return;
  line = -1; render();
  busy = false;
}

async function reserve() {
  if (busy) return;
  if (cap >= TARGET) { msg = `capacity ${cap} is already ≥ ${TARGET}: reserve does nothing.`; render(); return; }
  busy = true;
  const moved = size;
  if (!(await resizeTo(TARGET, false))) return;
  line = -1;
  msg = `reserve(${TARGET}): one allocation (copied ${moved}). The next ${TARGET - size} pushes need no resize at all.`;
  render();
  busy = false;
}

pushBtn.onclick = () => push(false);
push8Btn.onclick = async () => {
  if (busy) return;
  for (let k = 0; k < 8 && root.isConnected && size < MAX; k++) await push(true);
};
if (resBtn) resBtn.onclick = () => reserve();
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
