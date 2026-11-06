// pointer-array: how a Python list holds [1, "hi", 3.5] and still does O(1) index math.
// The list's array holds equal-size 8-byte pointers; the objects (different sizes) live elsewhere on the heap.
// Sizes are sys.getsizeof on 64-bit CPython (approximate, vary a little by version).
// input: { items?: how many of the preset objects to start with, 1–6 (default 3) }

const opts = (typeof input === "object" && input) || {};
const PRESET = [
  { repr: "1", type: "int", size: 28, addr: 0x7f3a40 },
  { repr: '"hi"', type: "str", size: 51, addr: 0x7f1c80 },
  { repr: "3.5", type: "float", size: 24, addr: 0x7f52e0 },
  { repr: '"x" * 1000', type: "str", size: 1049, addr: 0x7f0a00 },
  { repr: "10**30", type: "int", size: 40, addr: 0x7f61c0 },
  { repr: "None", type: "NoneType", size: 16, addr: 0x55e2a0 },
];
const START = Math.max(1, Math.min(6, Math.round(Number(opts.items ?? 3)) || 3));
const BASE = 0x1000;
const ROWORDER = [2, 0, 4, 1, 5, 3]; // where each object is drawn on the right, so the arrows cross (scattered heap)

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
const hex = (n) => "0x" + n.toString(16);

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const appendBtn = el("button", "", "", controls);
const resetBtn = el("button", "", "↺ Reset", controls);
const idxBox = el("div", "display:flex;gap:4px;flex-wrap:wrap;", null, controls);

const listLine = el("div", "font-family:var(--font-monospace);font-weight:bold;margin:4px 0;");
const svgBox = el("div", "");
const note = el("div", "font-family:var(--font-monospace);font-size:12px;min-height:2.8em;margin-top:4px;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let count, sel;
function reset() { count = START; sel = Math.min(1, count - 1); render(); }

function render() {
  const items = PRESET.slice(0, count);
  appendBtn.textContent = count < PRESET.length ? `➕ append(${PRESET[count].repr})` : "demo limit reached";
  listLine.textContent = `lst = [${items.map((o) => o.repr).join(", ")}]`;
  idxBox.innerHTML = "";
  items.forEach((_, i) => {
    const b = el("button", i === sel ? "background:#e8590c;color:#fff;" : "", `lst[${i}]`, idxBox);
    b.onclick = () => { sel = i; render(); };
  });

  const W = 640, rh = 34, top = 22, H = top + 6 * rh + 8;
  const sx = 10, sw = 150, ox = 330;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">`;
  s += `<text x="${sx}" y="14" font-size="11" fill="var(--text-muted)">list's array: 8 B slots, contiguous</text>`;
  s += `<text x="${ox}" y="14" font-size="11" fill="var(--text-muted)">objects somewhere on the heap</text>`;
  items.forEach((o, i) => {
    const y = top + i * rh, on = i === sel;
    s += `<rect x="${sx}" y="${y}" width="${sw}" height="${rh - 6}" rx="4" fill="${on ? "#e8590c" : "#3b82f6"}"/>`;
    s += `<text x="${sx + 6}" y="${y + 18}" font-size="11" fill="#fff">[${i}] @${hex(BASE + i * 8)}: ${hex(o.addr)}</text>`;
    const oy = top + ROWORDER[i] * rh;
    const ow = Math.min(W - ox - 10, 60 + Math.sqrt(o.size) * 6);
    s += `<line x1="${sx + sw}" y1="${y + (rh - 6) / 2}" x2="${ox - 4}" y2="${oy + (rh - 6) / 2}" stroke="${on ? "#e8590c" : "var(--text-faint)"}" stroke-width="${on ? 2.5 : 1.2}"/>`;
    s += `<circle cx="${ox - 4}" cy="${oy + (rh - 6) / 2}" r="3" fill="${on ? "#e8590c" : "var(--text-faint)"}"/>`;
    s += `<rect x="${ox}" y="${oy}" width="${ow}" height="${rh - 6}" rx="4" fill="${on ? "rgba(232,89,12,0.2)" : "var(--background-secondary)"}" stroke="${on ? "#e8590c" : "#9c36b5"}"/>`;
    s += `<text x="${ox + 6}" y="${oy + 18}" font-size="11" fill="var(--text-normal)">${o.type} ${o.repr.replace(/</g, "&lt;")} · ${o.size} B</text>`;
  });
  svgBox.innerHTML = s + "</svg>";

  const o = items[sel];
  note.innerHTML = `lst[${sel}]: slot address = ${hex(BASE)} + ${sel} × 8 = <b>${hex(BASE + sel * 8)}</b> (O(1) math)<br>` +
    `→ read the pointer ${hex(o.addr)} → follow it → ${o.type} ${o.repr.replace(/</g, "&lt;")} (${o.size} B)`;
  const total = items.reduce((a, b) => a + b.size, 0);
  board.innerHTML = `Slots: ${count} × 8 B = <b>${count * 8} B</b>, all the same size. Objects: ${total} B of mixed sizes, scattered.<br>` +
    `<span style="color:var(--text-muted);">Index math only needs equal-size slots, so a pointer array gives O(1) access to any mix of types. ` +
    `The price: one extra hop per access and worse cache locality than a packed array of raw numbers.</span>`;
}

appendBtn.onclick = () => { if (count < PRESET.length) { count++; sel = count - 1; render(); } };
resetBtn.onclick = () => reset();

reset();
