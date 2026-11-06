// amortized-chart: the cost of every single append as a bar (1 write, plus a spike of copies at each resize),
// with the running average line staying below 3. Shows worst case O(n) per op vs amortized O(1).
// input: { n?: number of appends 8–128 (default 32), factor?: growth factor 1.25–4 (default 2) }

const opts = (typeof input === "object" && input) || {};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let N = clamp(Math.round(Number(opts.n ?? 32)) || 32, 8, 128);
let FACTOR = clamp(Number(opts.factor ?? 2) || 2, 1.25, 4);

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
const controls = el("div", "display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const playBtn = el("button", "", "▶ Play appends", controls);
const nLab = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
el("span", "", "n", nLab);
const nIn = el("input", "width:110px;", null, nLab);
nIn.type = "range"; nIn.min = 8; nIn.max = 128; nIn.value = N;
const nVal = el("span", "font-family:var(--font-monospace);", String(N), nLab);
const fLab = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
el("span", "", "growth ×", fLab);
const fSel = el("select", "", null, fLab);
const FACTORS = [1.25, 1.5, 2, 3];
if (!FACTORS.includes(FACTOR)) FACTORS.push(FACTOR);
for (const f of FACTORS) { const o = el("option", "", String(f), fSel); o.value = f; if (f === FACTOR) o.selected = true; }

const svgBox = el("div", "");
const legend = el("div", "font-size:12px;color:var(--text-muted);margin:2px 0 6px;");
legend.innerHTML = `<span style="color:#3b82f6">■</span> 1 write &nbsp; <span style="color:#e8590c">■</span> resize: copy every element &nbsp; ` +
  `<span style="color:#2b8a3e">━</span> running average (total ÷ appends) &nbsp; <span style="color:var(--text-muted)">┅</span> ≈ 1 + f/(f−1) (= 3 for ×2)`;
const note = el("div", "font-family:var(--font-monospace);font-size:12px;min-height:2.6em;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- model ----------
let costs, caps, shown, busy = false;
function compute() {
  costs = []; caps = [];
  let cap = 1, size = 0;
  for (let k = 1; k <= N; k++) {
    let c = 1;
    if (size === cap) { c += size; cap = Math.max(cap + 1, Math.floor(cap * FACTOR)); }
    size++;
    costs.push(c); caps.push(cap);
  }
}

function render() {
  const W = 640, H = 220, L = 34, B = 22, T = 10, R = 8;
  const maxC = Math.max(7, ...costs);
  const bw = (W - L - R) / N;
  const y = (v) => H - B - (v / maxC) * (H - B - T);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">`;
  for (const t of [0, Math.round(maxC / 2), maxC]) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--background-modifier-border)"/>` +
      `<text x="${L - 4}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="var(--text-muted)">${t}</text>`;
  }
  let total = 0, pts = [];
  for (let k = 0; k < shown; k++) {
    const c = costs[k];
    total += c;
    const x = L + k * bw;
    if (c > 1) s += `<rect x="${x + bw * 0.1}" y="${y(c)}" width="${bw * 0.8}" height="${y(1) - y(c)}" fill="#e8590c"/>`;
    s += `<rect x="${x + bw * 0.1}" y="${y(1)}" width="${bw * 0.8}" height="${y(0) - y(1)}" fill="#3b82f6"/>`;
    if (c > 1 && N <= 64) s += `<text x="${x + bw / 2}" y="${y(c) - 3}" font-size="9" text-anchor="middle" fill="#e8590c">${c - 1}</text>`;
    pts.push(`${x + bw / 2},${y(total / (k + 1))}`);
  }
  const bound = 1 + FACTOR / (FACTOR - 1);
  s += `<line x1="${L}" x2="${W - R}" y1="${y(bound)}" y2="${y(bound)}" stroke="var(--text-muted)" stroke-dasharray="4 3"/>`;
  if (pts.length > 1) s += `<polyline points="${pts.join(" ")}" fill="none" stroke="#2b8a3e" stroke-width="2"/>`;
  s += `<text x="${(L + W) / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--text-muted)">append #1 … #${N}</text>`;
  svgBox.innerHTML = s + "</svg>";

  if (shown === 0) { note.textContent = "press play"; }
  else {
    const k = shown, c = costs[k - 1];
    note.textContent = c > 1
      ? `append #${k}: array was full (${c - 1}/${c - 1}) → copy ${c - 1} + write 1 = ${c}. New capacity ${caps[k - 1]}.`
      : `append #${k}: free slot → cost 1. Capacity ${caps[k - 1]}.`;
  }
  const copies = costs.slice(0, shown).reduce((a, b) => a + b, 0) - shown;
  const spikes = costs.slice(0, shown).filter((c) => c > 1).length;
  const worst = Math.max(0, ...costs.slice(0, shown));
  board.innerHTML = shown === 0 ? "" :
    `After <b>${shown}</b> appends: ${shown} writes + <b>${copies}</b> copies = <b>${shown + copies}</b> total ` +
    `${FACTOR === 2 ? `(< 3n = ${3 * shown})` : ""}. Average <b>${((shown + copies) / shown).toFixed(2)}</b> per append.<br>` +
    `<span style="color:var(--text-muted);">Only ${spikes} of ${shown} appends were expensive (worst single one: ${worst}). ` +
    `The spikes are O(n) but so rare that the average stays constant → <b>amortized O(1)</b>.</span>`;
}

async function play() {
  if (busy) return;
  busy = true;
  shown = 0; render();
  const ms = Math.max(20, 2400 / N);
  while (shown < N) {
    shown++;
    render();
    await sleep(costs[shown - 1] > 1 ? ms * 4 : ms);
    if (!root.isConnected) return;
  }
  busy = false;
}

function rebuild() { compute(); shown = N; render(); }
playBtn.onclick = () => play();
nIn.oninput = () => { if (busy) { nIn.value = N; return; } N = Number(nIn.value); nVal.textContent = String(N); rebuild(); };
fSel.onchange = () => { if (busy) { fSel.value = FACTOR; return; } FACTOR = Number(fSel.value); rebuild(); };

rebuild();
