// growth-compare: total element copies as n grows, for different growth rules.
// "factor-vs-constant": ×2 (O(n) total) vs +k (O(n²) total). "factors": CPython ≈×1.125, ×1.5, ×2 → copies vs wasted slots.
// input: { mode?: "factor-vs-constant" | "factors" (default "factor-vs-constant"), k?: constant step 1–64 (default 4),
//          n?: number of appends to inspect 10–2000 (default 1000) }

const opts = (typeof input === "object" && input) || {};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let MODE = opts.mode === "factors" ? "factors" : "factor-vs-constant";
let K = clamp(Math.round(Number(opts.k ?? 4)) || 4, 1, 64);
let N = clamp(Math.round(Number(opts.n ?? 1000)) || 1000, 10, 2000);
const NMAX = 2000;

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
const controls = el("div", "display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const modeBtn = el("button", "", "", controls);
const nLab = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
el("span", "", "n", nLab);
const nIn = el("input", "width:130px;", null, nLab);
nIn.type = "range"; nIn.min = 10; nIn.max = NMAX; nIn.step = 10; nIn.value = N;
const nVal = el("span", "font-family:var(--font-monospace);min-width:3em;", "", nLab);
const kLab = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
el("span", "", "k", kLab);
const kIn = el("input", "width:90px;", null, kLab);
kIn.type = "range"; kIn.min = 1; kIn.max = 64; kIn.value = K;
const kVal = el("span", "font-family:var(--font-monospace);", "", kLab);

const svgBox = el("div", "");
const rows = el("div", "font-family:var(--font-monospace);font-size:12px;margin-top:6px;");
const board = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- model ----------
// Each rule: next(cap) → new capacity when full. Simulate NMAX appends, record cumulative copies/resizes/capacity.
function simulate(start, next) {
  const copies = [0], resizes = [0], caps = [start];
  let cap = start, size = 0, c = 0, r = 0;
  for (let i = 1; i <= NMAX; i++) {
    if (size === cap) { c += size; r++; cap = next(cap, size); }
    size++;
    copies.push(c); resizes.push(r); caps.push(cap);
  }
  return { copies, resizes, caps };
}
function series() {
  if (MODE === "factor-vs-constant") {
    return [
      { name: "×2", color: "#2b8a3e", ...simulate(1, (c) => c * 2) },
      { name: `+${K}`, color: "#d6336c", ...simulate(K, (c) => c + K) },
    ];
  }
  return [
    { name: "CPython ≈×1.125", color: "#9c36b5", ...simulate(0, (c, s) => ((s + 1) + ((s + 1) >> 3) + 6) & ~3) },
    { name: "×1.5 (MSVC, Java)", color: "#e8590c", ...simulate(1, (c) => Math.max(c + 1, Math.floor(c * 1.5))) },
    { name: "×2 (GCC)", color: "#2b8a3e", ...simulate(1, (c) => c * 2) },
  ];
}

function render() {
  modeBtn.textContent = MODE === "factors" ? "⇄ show ×2 vs +k" : "⇄ compare real factors";
  kLab.style.display = MODE === "factors" ? "none" : "flex";
  nVal.textContent = String(N); kVal.textContent = String(K);
  const S = series();
  const W = 640, H = 200, L = 52, B = 20, T = 10, R = 10;
  const maxY = Math.max(10, ...S.map((s) => s.copies[NMAX]));
  const x = (n) => L + (n / NMAX) * (W - L - R);
  const y = (v) => H - B - (v / maxY) * (H - B - T);
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">`;
  for (const t of [0, maxY / 2, maxY]) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--background-modifier-border)"/>` +
      `<text x="${L - 4}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="var(--text-muted)">${Math.round(t).toLocaleString("en-US")}</text>`;
  }
  g += `<text x="${(L + W) / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--text-muted)">appends (n) → ${NMAX}</text>`;
  for (const s of S) {
    const pts = [];
    for (let n = 0; n <= NMAX; n += 10) pts.push(`${x(n).toFixed(1)},${y(s.copies[n]).toFixed(1)}`);
    g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    g += `<circle cx="${x(N)}" cy="${y(s.copies[N])}" r="4" fill="${s.color}"/>`;
  }
  g += `<line x1="${x(N)}" x2="${x(N)}" y1="${T}" y2="${H - B}" stroke="var(--text-faint)" stroke-dasharray="3 3"/>`;
  svgBox.innerHTML = g + "</svg>";

  rows.innerHTML = S.map((s) => {
    const cap = s.caps[N], waste = cap - N;
    return `<div style="margin:2px 0;"><span style="color:${s.color};font-weight:bold;">■ ${s.name}</span>: ` +
      `${s.resizes[N]} resizes · <b>${s.copies[N].toLocaleString("en-US")}</b> copies (${(s.copies[N] / N).toFixed(2)} per append) · ` +
      `capacity ${cap} · unused ${waste} (${Math.round((100 * waste) / cap)}%)</div>`;
  }).join("");

  if (MODE === "factor-vs-constant") {
    const ratio = S[1].copies[N] / Math.max(1, S[0].copies[N]);
    board.innerHTML = `At n = ${N}: <b>+${K}</b> copies ≈ n²/2k = ${Math.round((N * N) / (2 * K)).toLocaleString("en-US")} ` +
      `vs <b>×2</b> &lt; 2n = ${2 * N}. That's about <b>${ratio.toFixed(0)}×</b> more copying.<br>` +
      `<span style="color:var(--text-muted);">+k resizes every k appends and each copies everything → O(n²) total, O(n) per append. ` +
      `A factor makes resizes exponentially rarer → O(n) total, O(1) amortized. Drag n: the pink curve bends up, the green one stays a straight line.</span>`;
  } else {
    board.innerHTML = `<span style="color:var(--text-muted);">Bigger factor → fewer resizes and copies, but more unused capacity right after a resize ` +
      `(×2 can leave ~50% empty). Smaller factor → less waste, more copying. All are geometric, so all give amortized O(1). ` +
      `Drag n and watch the "unused" numbers jump after each resize.</span>`;
  }
}

modeBtn.onclick = () => { MODE = MODE === "factors" ? "factor-vs-constant" : "factors"; render(); };
nIn.oninput = () => { N = Number(nIn.value); render(); };
kIn.oninput = () => { K = Number(kIn.value); render(); };

render();
