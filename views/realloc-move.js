// realloc-move: why a full array can't just grow in place. The next bytes may belong to someone else,
// so it gets a new block elsewhere → copy → old block freed → any old pointer into it now dangles.
// input: { neighbor?: memory right after the array is taken (default true), pointer?: show p = &arr[1] (default true) }

const opts = (typeof input === "object" && input) || {};
let neighbor = opts.neighbor !== false;
const SHOW_P = opts.pointer !== false;
const M = 24, BASE = 100;

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
const pushBtn = el("button", "", "➕ push(e) (array is full)", controls);
const readBtn = SHOW_P ? el("button", "", "👉 read *p", controls) : null;
const mallocBtn = SHOW_P ? el("button", "", "🧱 someone else mallocs", controls) : null;
const fixBtn = SHOW_P ? el("button", "", "↻ p = &arr[1] again", controls) : null;
const nbBtn = el("button", "", "", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const svgBox = el("div", "");
const legend = el("div", "font-size:12px;color:var(--text-muted);margin:2px 0 6px;");
legend.innerHTML = `<span style="color:#3b82f6">■</span> our array &nbsp; <span style="color:#9c36b5">■</span> someone else's data &nbsp; ` +
  `<span style="color:var(--text-faint)">□</span> free &nbsp; <span style="color:var(--text-error)">▨</span> freed (not ours any more)`;
const note = el("div", "font-family:var(--font-monospace);font-size:12px;min-height:2.6em;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let mem, arr, p, busy, hl, msg, copies, stale;

function reset() {
  mem = Array.from({ length: M }, () => ({ kind: "free", v: "" }));
  mem[0] = { kind: "other", v: "q" }; mem[1] = { kind: "other", v: "q" };
  if (neighbor) for (let i = 6; i <= 8; i++) mem[i] = { kind: "other", v: "N" };
  arr = { start: 2, cap: 4, size: 4 };
  ["a", "b", "c", "d"].forEach((v, i) => (mem[2 + i] = { kind: "arr", v }));
  p = 3; stale = false; busy = false; hl = {}; copies = 0;
  msg = `data → ${BASE + 2}, size 4 = capacity 4. ${neighbor ? "The 3 slots right after it belong to someone else." : "The slots right after it are free."}`;
  render();
}

const COLORS = { arr: "#3b82f6", other: "#9c36b5", y: "#9c36b5", free: "transparent", freed: "transparent" };

function render() {
  nbBtn.textContent = neighbor ? "⇄ make neighbor free" : "⇄ make neighbor taken";
  const W = 640, H = 120, L = 8, cw = (W - 2 * L) / M, top = 42;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">`;
  s += `<defs><pattern id="rmh" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-error)" stroke-width="2"/></pattern></defs>`;
  for (let i = 0; i < M; i++) {
    const c = mem[i], x = L + i * cw;
    const fill = hl[i] || (c.kind === "freed" ? "url(#rmh)" : COLORS[c.kind]);
    s += `<rect x="${x + 1}" y="${top}" width="${cw - 2}" height="30" rx="3" fill="${fill}" stroke="var(--background-modifier-border)"/>`;
    if (c.v) s += `<text x="${x + cw / 2}" y="${top + 20}" font-size="12" font-weight="bold" text-anchor="middle" fill="${c.kind === "freed" ? "var(--text-error)" : "#fff"}">${c.v}</text>`;
    if (i % 4 === 0) s += `<text x="${x + 2}" y="${top + 44}" font-size="9" fill="var(--text-muted)">${BASE + i}</text>`;
  }
  // array bracket + data pointer
  const ax = L + arr.start * cw, aw = arr.cap * cw;
  s += `<path d="M ${ax + 2} ${top + 50} v 6 h ${aw - 4} v -6" fill="none" stroke="#3b82f6" stroke-width="2"/>`;
  s += `<text x="${ax + aw / 2}" y="${top + 70}" font-size="10" text-anchor="middle" fill="#3b82f6">data → ${BASE + arr.start} (cap ${arr.cap})</text>`;
  if (SHOW_P) {
    const px = L + p * cw + cw / 2, col = stale ? "var(--text-error)" : "#2b8a3e";
    s += `<text x="${px}" y="12" font-size="11" font-weight="bold" text-anchor="middle" fill="${col}">p = ${BASE + p}${stale ? " ⚠ dangling" : ""}</text>`;
    s += `<line x1="${px}" y1="16" x2="${px}" y2="${top - 4}" stroke="${col}" stroke-width="2"/>`;
    s += `<path d="M ${px - 4} ${top - 9} L ${px} ${top - 2} L ${px + 4} ${top - 9}" fill="none" stroke="${col}" stroke-width="2"/>`;
  }
  svgBox.innerHTML = s + "</svg>";
  note.textContent = msg;
  board.innerHTML = `Copies: <b>${copies}</b> · p is <b style="color:${stale ? "var(--text-error)" : "#2b8a3e"}">${stale ? "INVALID" : "valid"}</b><br>` +
    `<span style="color:var(--text-muted);">An array must be one contiguous block. If the memory after it is taken, growing means: new block → copy all → free old. ` +
    `Every pointer, reference or iterator into the old block now dangles (in C++: undefined behavior).</span>`;
}

async function push() {
  if (busy) return;
  if (arr.cap > 4) { msg = "already grown. Reset to try again."; render(); return; }
  busy = true;
  const need = arr.cap * 2;
  const endOld = arr.start + arr.cap;
  let inPlace = true;
  for (let i = endOld; i < arr.start + need; i++) if (mem[i].kind !== "free") inPlace = false;
  for (let i = endOld; i < arr.start + need; i++) hl[i] = inPlace ? "#2b8a3e" : "var(--text-error)";
  msg = `need capacity ${need}: are slots ${BASE + endOld}…${BASE + arr.start + need - 1} free? ${inPlace ? "yes ✅" : "no ✗ taken by someone else"}`;
  render();
  await sleep(1100); if (!root.isConnected) return;
  hl = {};
  if (inPlace) {
    for (let i = endOld; i < arr.start + need; i++) mem[i] = { kind: "arr", v: "" };
    arr.cap = need;
    mem[arr.start + arr.size] = { kind: "arr", v: "e" }; arr.size++;
    msg = `lucky: extended in place (what realloc can do when the neighbor is free). 0 copies, p still valid. You can't count on this.`;
    busy = false; render(); return;
  }
  const ns = 12;
  for (let i = ns; i < ns + need; i++) mem[i] = { kind: "arr", v: "" };
  const oldStart = arr.start;
  msg = `allocate a new block of ${need} at ${BASE + ns}`;
  render();
  await sleep(700); if (!root.isConnected) return;
  for (let k = 0; k < arr.size; k++) {
    mem[ns + k].v = mem[oldStart + k].v;
    copies++;
    hl = { [oldStart + k]: "#e8590c", [ns + k]: "#e8590c" };
    msg = `copy ${mem[ns + k].v}: ${BASE + oldStart + k} → ${BASE + ns + k} (copy #${copies})`;
    render();
    await sleep(400); if (!root.isConnected) return;
  }
  hl = {};
  for (let k = 0; k < 4; k++) mem[oldStart + k] = { kind: "freed", v: mem[oldStart + k].v };
  arr = { start: ns, cap: need, size: 4 };
  stale = SHOW_P;
  msg = `free the old block at ${BASE + oldStart}. data now → ${BASE + ns}.${SHOW_P ? ` But p still says ${BASE + p}: freed memory!` : ""}`;
  render();
  await sleep(700); if (!root.isConnected) return;
  mem[ns + 4] = { kind: "arr", v: "e" }; arr.size = 5;
  msg = `write e at index 4. Done: ${copies} copies.${SHOW_P ? " p is dangling ⚠" : ""}`;
  busy = false; render();
}

if (readBtn) readBtn.onclick = () => {
  if (busy) return;
  const c = mem[p];
  if (!stale) msg = `*p = ${c.v} ✅ (p points into our live array)`;
  else if (c.kind === "freed") msg = `*p → freed memory. It may still show "${c.v}", or garbage, or crash: undefined behavior 💥`;
  else msg = `*p = "${c.v}" — that's someone else's data now! Writing through p would corrupt it 💥`;
  render();
};
if (mallocBtn) mallocBtn.onclick = () => {
  if (busy) return;
  let n = 0;
  for (let i = 0; i < M; i++) if (mem[i].kind === "freed") { mem[i] = { kind: "y", v: "Y" }; n++; }
  msg = n ? "another allocation reused the freed block. Now look at what *p reads." : "nothing freed yet: push first";
  render();
};
if (fixBtn) fixBtn.onclick = () => {
  if (busy) return;
  p = arr.start + 1; stale = false;
  msg = `re-fetched after the resize: p = &arr[1] = ${BASE + p} ✅ (the fix: never keep pointers across a push that may resize)`;
  render();
};
nbBtn.onclick = () => { if (busy) return; neighbor = !neighbor; reset(); };
pushBtn.onclick = () => push();
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
