// bucket-outlier: why one extreme value wrecks bucket sort. Equal-width buckets are cut from min to max,
// so a single outlier stretches the range and squeezes all the other values into bucket 0.
// Fixes shown: drop the outlier, or pick boundaries from a sorted sample (TeraSort-style).
// input: { n: 20 (10–40; k = n equal-width buckets, or ⌈n/2⌉ + 1 sampled ones), outlier: 1000 (0 = none, else 12–10000), mode: "equal"|"sampled" }

const opts = (typeof input === "object" && input) || {};
const n = Math.max(10, Math.min(40, Math.round(Number(opts.n ?? 20)) || 20));
const k = n;
const OUTS = [0, 12, 20, 50, 100, 1000, 10000];
let outIdx = OUTS.indexOf(Number(opts.outlier ?? 1000));
if (outIdx < 0) outIdx = 5;
let mode = opts.mode === "sampled" ? "sampled" : "equal";
let seed = 7;

// ---------- DOM ----------
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
const controls = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const outLbl = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
el("span", "", "Outlier:", outLbl);
const outSl = el("input", "width:120px;", null, outLbl);
outSl.type = "range"; outSl.min = 0; outSl.max = OUTS.length - 1; outSl.step = 1; outSl.value = outIdx;
const outVal = el("b", "min-width:4em;font-family:var(--font-monospace);", "", outLbl);
const modeSel = el("select", "", null, controls);
for (const [v, t] of [["equal", "Equal-width buckets (min → max)"], ["sampled", "Boundaries from a sample (TeraSort)"]]) {
  const o = el("option", "", t, modeSel); o.value = v;
}
modeSel.value = mode;
const shuffleBtn = el("button", "", "🎲 New data", controls);

const lineTitle = el("div", "font-size:12px;color:var(--text-muted);", "");
const lineBox = el("div", "");
const histTitle = el("div", "font-size:12px;color:var(--text-muted);margin-top:8px;", `Items per bucket (k = ${k} buckets)`);
const histBox = el("div", "");
const narr = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;line-height:1.6;");

// ---------- data ----------
function rng(s) { return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeData() {
  const r = rng(seed), out = OUTS[outIdx];
  const m = out ? n - 1 : n;
  const xs = [];
  for (let i = 0; i < m; i++) xs.push(Math.round(r() * 1000) / 100);   // 0.00 – 10.00
  if (out) xs.push(out);
  return { xs, r };
}
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

function bucketize(xs, r) {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  let idx, bounds;
  if (mode === "equal") {
    const w = (hi - lo) / k;
    bounds = []; for (let i = 1; i < k; i++) bounds.push(lo + i * w);
    idx = xs.map((x) => (hi === lo ? 0 : Math.min(k - 1, Math.floor(((x - lo) / (hi - lo)) * k))));
    return { lo, hi, w, idx, bounds };
  }
  // sampled: take m random items, sort them (small), use evenly spaced sample values as splitters
  const m = Math.ceil(n / 2), pool = xs.slice(), sample = [];
  for (let i = 0; i < m; i++) sample.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  sample.sort((a, b) => a - b);
  bounds = sample;                                   // m splitters → m + 1 buckets, ~n/(m+1) items each
  idx = xs.map((x) => { let c = 0; while (c < bounds.length && bounds[c] <= x) c++; return c; });
  return { lo, hi, idx, bounds, m, kk: m + 1 };
}

// ---------- render ----------
function render() {
  const { xs, r } = makeData();
  const B = bucketize(xs, r);
  const out = OUTS[outIdx];
  outVal.textContent = out ? String(out) : "none";
  const kk = B.kk || k;
  histTitle.textContent = `Items per bucket (${kk} buckets)`;
  const counts = Array(kk).fill(0);
  B.idx.forEach((i) => counts[i]++);
  const big = Math.max(...counts), bigAt = counts.indexOf(big);
  const work = counts.reduce((s, b) => s + (b * b) / 4, 0);
  const worst = (n * n) / 4;
  const clumped = big > n / 2;

  // number line: min → max, with bucket boundaries
  const W = 640, H = 70, L = 20, R = 620;
  const X = (v) => (B.hi === B.lo ? L : L + ((v - B.lo) / (B.hi - B.lo)) * (R - L));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif" font-size="11">`;
  s += `<line x1="${L}" y1="40" x2="${R}" y2="40" stroke="var(--text-muted)"/>`;
  for (const b of B.bounds) s += `<line x1="${X(b).toFixed(1)}" y1="22" x2="${X(b).toFixed(1)}" y2="50" stroke="var(--text-faint)" stroke-width="0.8"/>`;
  xs.forEach((x, i) => {
    const isOut = out && x === out && i === xs.length - 1;
    s += `<circle cx="${X(x).toFixed(1)}" cy="${30 + (i % 4) * 4}" r="${isOut ? 6 : 4}" fill="${isOut ? "#d6336c" : "#3b82f6"}" opacity="0.8"/>`;
  });
  s += `<text x="${L}" y="64" fill="currentColor">min ${fmt(B.lo)}</text><text x="${R}" y="64" text-anchor="end" fill="currentColor">max ${fmt(B.hi)}</text></svg>`;
  lineBox.innerHTML = s;
  lineTitle.textContent = `Values on a number line (${n} items, gray lines = bucket boundaries)`;

  // histogram
  const HH = 110, bw = (R - L) / kk;
  let h = `<svg viewBox="0 0 ${W} ${HH + 20}" width="100%" font-family="sans-serif" font-size="10">`;
  counts.forEach((c, i) => {
    const bh = (c / n) * HH;
    const col = c === big && clumped ? "#e8590c" : "#2b8a3e";
    h += `<rect x="${(L + i * bw + 1).toFixed(1)}" y="${(HH - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}" rx="2"/>`;
    if (c) h += `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${(HH - bh - 3).toFixed(1)}" text-anchor="middle" fill="currentColor">${c}</text>`;
  });
  h += `<line x1="${L}" y1="${HH}" x2="${R}" y2="${HH}" stroke="var(--text-muted)"/>`;
  h += `<text x="${L}" y="${HH + 14}" fill="currentColor">bucket 0</text><text x="${R}" y="${HH + 14}" text-anchor="end" fill="currentColor">bucket ${kk - 1}</text></svg>`;
  histBox.innerHTML = h;

  const lines = [];
  if (mode === "equal") {
    lines.push(`range = max − min = ${fmt(B.hi)} − ${fmt(B.lo)} = ${fmt(B.hi - B.lo)} → bucket width = ${fmt(B.hi - B.lo)} / ${k} = ${fmt(B.w)}`);
    if (out) lines.push(`the ${n - 1} normal values (0–10) only reach bucket ⌊(10 − ${fmt(B.lo)}) / ${fmt(B.hi - B.lo)} × ${k}⌋ = ${Math.min(k - 1, Math.floor(((10 - B.lo) / (B.hi - B.lo)) * k))}; the outlier sits alone in bucket ${k - 1}`);
    else lines.push(`no outlier: the range is just the data itself, so values spread across the buckets`);
  } else {
    lines.push(`sampled ${B.m} random items, sorted them, used them as ${B.m} boundaries → ${kk} buckets, ≈ ${(n / kk).toFixed(1)} items each expected`);
    lines.push(`boundaries follow the data, not the range: the outlier can't squeeze anyone`);
  }
  lines.push(`biggest bucket: #${bigAt} holds ${big} of ${n} items${clumped ? "  ⚠️ clumped" : ""}`);
  lines.push(`insertion-sort work ≈ Σ b²/4 = ${work.toFixed(1)} comparisons  (all in one bucket: n²/4 = ${worst})`);
  narr.innerHTML = lines.map((t) => `<div>${t}</div>`).join("");
}

outSl.oninput = () => { outIdx = Number(outSl.value); render(); };
modeSel.onchange = () => { mode = modeSel.value; render(); };
shuffleBtn.onclick = () => { seed = (seed * 31 + 17) % 100000; render(); };
render();
