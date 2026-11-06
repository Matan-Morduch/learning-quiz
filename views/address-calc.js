// address-calc: why arr[i] is O(1). Contiguous, equal-size elements → address(i) = base + i × size, one jump.
// Click an element (or use the arrows), change the element size, and see the byte range it occupies.
// input: { base?: start address (default 1000), size?: bytes per element 1|2|4|8 (default 4), n?: elements 3–12 (default 8),
//          fixed?: show an "add one more" button that fails because a static array can't grow (default false) }

const opts = (typeof input === "object" && input) || {};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const BASE = Math.max(0, Math.round(Number(opts.base ?? 1000)) || 0);
let SIZE = [1, 2, 4, 8].includes(Number(opts.size)) ? Number(opts.size) : 4;
const N = clamp(Math.round(Number(opts.n ?? 8)) || 8, 3, 12);
const FIXED = !!opts.fixed;

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
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const prevBtn = el("button", "", "◀", controls);
const nextBtn = el("button", "", "▶", controls);
const lastBtn = el("button", "", `⏭ arr[${N - 1}]`, controls);
const sLab = el("label", "display:flex;gap:4px;align-items:center;margin-left:6px;", null, controls);
el("span", "", "element size", sLab);
const sSel = el("select", "", null, sLab);
for (const s of [1, 2, 4, 8]) { const o = el("option", "", `${s} B`, sSel); o.value = s; if (s === SIZE) o.selected = true; }
const pushBtn = FIXED ? el("button", "", `➕ add element #${N + 1}`, controls) : null;

const title = el("div", "font-size:12px;color:var(--text-muted);", "");
const svgBox = el("div", "margin:4px 0;");
const formula = el("div", "font-family:var(--font-monospace);font-size:14px;margin:6px 0;min-height:1.4em;");
const note = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let idx = Math.min(5, N - 1), msg = "";
const VALUES = Array.from({ length: N }, (_, i) => (i * 7 + 3) % 50 + 10);

function render() {
  const bytes = N * SIZE;
  title.textContent = `array of ${N} elements × ${SIZE} B = ${bytes} bytes in one contiguous block, starting at address ${BASE}`;
  const W = 640, H = 104, L = 8, R = 8;
  const bw = (W - L - R) / bytes;
  const ew = bw * SIZE;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">`;
  const start = BASE + idx * SIZE;
  // base arrow → selected element
  const selX = L + idx * ew;
  s += `<text x="${L}" y="12" font-size="10" fill="var(--text-muted)">base = ${BASE}</text>`;
  s += `<path d="M ${L + 4} 16 Q ${(L + selX) / 2 + ew / 4} 2 ${selX + ew / 2} 22" fill="none" stroke="#e8590c" stroke-width="2"/>`;
  s += `<text x="${Math.min(W - 70, selX + ew / 2 + 4)}" y="14" font-size="10" fill="#e8590c">+ ${idx} × ${SIZE}</text>`;
  for (let i = 0; i < N; i++) {
    const x = L + i * ew, sel = i === idx;
    s += `<g data-i="${i}" style="cursor:pointer;">`;
    s += `<rect x="${x + 1}" y="24" width="${ew - 2}" height="30" rx="4" fill="${sel ? "#e8590c" : "var(--interactive-accent)"}"/>`;
    s += `<text x="${x + ew / 2}" y="44" font-size="12" font-weight="bold" text-anchor="middle" fill="var(--text-on-accent)">${VALUES[i]}</text>`;
    s += `<text x="${x + ew / 2}" y="68" font-size="10" text-anchor="middle" fill="${sel ? "#e8590c" : "var(--text-muted)"}">[${i}]</text>`;
    s += `</g>`;
  }
  // byte strip
  for (let b = 0; b < bytes; b++) {
    const inSel = b >= idx * SIZE && b < (idx + 1) * SIZE;
    s += `<rect x="${L + b * bw + 0.5}" y="74" width="${Math.max(1, bw - 1)}" height="10" fill="${inSel ? "#e8590c" : "var(--background-secondary)"}" stroke="var(--background-modifier-border)" stroke-width="0.5"/>`;
  }
  s += `<text x="${L}" y="98" font-size="10" fill="var(--text-muted)">${BASE}</text>`;
  s += `<text x="${W - R}" y="98" font-size="10" text-anchor="end" fill="var(--text-muted)">${BASE + bytes - 1}</text>`;
  s += `<text x="${selX + ew / 2}" y="98" font-size="10" text-anchor="middle" fill="#e8590c">${start}</text>`;
  svgBox.innerHTML = s + "</svg>";
  svgBox.querySelectorAll("g[data-i]").forEach((g) => {
    g.onclick = () => { idx = Number(g.getAttribute("data-i")); msg = ""; render(); };
  });

  formula.innerHTML = `address(${idx}) = ${BASE} + ${idx} × ${SIZE} = <b style="color:#e8590c">${start}</b> → bytes ${start}…${start + SIZE - 1}`;
  note.textContent = msg || `arr[${idx}] = ${VALUES[idx]}: 1 multiply + 1 add + 1 memory read. Click any element or change the size.`;
  board.innerHTML = `Work to reach arr[${idx}]: <b>array 3 steps</b>, always, for any index (O(1)). ` +
    `<span style="color:var(--text-muted);">A linked list would need ${idx} pointer hop(s) to get here (O(i)). ` +
    `This only works because every element has the same size and they sit back to back with no gaps.</span>`;
}

prevBtn.onclick = () => { idx = (idx - 1 + N) % N; msg = ""; render(); };
nextBtn.onclick = () => { idx = (idx + 1) % N; msg = ""; render(); };
lastBtn.onclick = () => { idx = N - 1; msg = `the last element costs the same as the first: still ${BASE} + ${N - 1} × ${SIZE}`; render(); };
sSel.onchange = () => { SIZE = Number(sSel.value); msg = `element size now ${SIZE} B: every address shifts, the formula doesn't change`; render(); };
if (pushBtn) pushBtn.onclick = () => {
  msg = `✗ no room: a static array's size (${N}) is fixed at creation. Address ${BASE + N * SIZE} may already belong to something else.`;
  render();
};

render();
