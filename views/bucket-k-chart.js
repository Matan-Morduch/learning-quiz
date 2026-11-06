// bucket-k-chart: how many buckets should you use? Total work ≈ n (scatter) + k (visit every bucket)
// + insertion-sort work inside buckets (≈ b²/4 comparisons for a bucket of size b, on average).
// Too few buckets → big buckets → quadratic. Too many → lots of empty buckets to visit.
// input: { n: 100 (10–1000), data: "uniform"|"clustered" }

const opts = (typeof input === "object" && input) || {};
let n = Math.max(10, Math.min(1000, opts.n ?? 100));
let dataKind = opts.data === "clustered" ? "clustered" : "uniform";
const TRIALS = 20;

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
const top = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;");
const uBtn = el("button", "", "🎲 Evenly spread", top);
const cBtn = el("button", "", "🫧 Clumped (90% in 10% of the range)", top);
const nRow = el("div", "display:flex;gap:8px;align-items:center;margin:6px 0;");
el("span", "", "n =", nRow);
const nIn = el("input", "flex:1;", null, nRow);
Object.assign(nIn, { type: "range", min: 1, max: 3, step: 0.01, value: Math.log10(n) });
const nOut = el("b", "width:50px;font-family:var(--font-monospace);", null, nRow);
const svgWrap = el("div", "");
const verdict = el("div", "margin-top:4px;");

function sample() {
  return dataKind === "uniform" ? Math.random()
    : Math.random() < 0.9 ? 0.45 + Math.random() * 0.1 : Math.random();
}
function work(k) {
  let total = 0;
  for (let t = 0; t < TRIALS; t++) {
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) counts[Math.min(k - 1, Math.floor(sample() * k))]++;
    total += n + k + counts.reduce((s, b) => s + (b * b) / 4, 0);
  }
  return total / TRIALS;
}

function draw() {
  nOut.textContent = n;
  uBtn.style.outline = dataKind === "uniform" ? "2px solid var(--interactive-accent)" : "none";
  cBtn.style.outline = dataKind === "clustered" ? "2px solid var(--interactive-accent)" : "none";
  const ks = [];
  for (let e = 0; e <= 40; e++) ks.push(Math.max(1, Math.round(10 ** ((e / 40) * Math.log10(4 * n)))));
  const uniq = [...new Set(ks)];
  const pts = uniq.map((k) => [k, work(k)]);
  const best = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const nlogn = n * Math.log2(n);
  const W = 600, H = 190, x0 = 55, x1 = 590, y0 = 165, y1 = 12;
  const maxY = Math.max(...pts.map((p) => p[1]), nlogn) * 1.05;
  const lmax = Math.log10(4 * n);
  const X = (k) => x0 + (Math.log10(k) / lmax) * (x1 - x0);
  const Y = (v) => y0 - (Math.log10(v) / Math.log10(maxY)) * (y0 - y1);
  let s = `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" font-family="sans-serif" font-size="11">`;
  s += `<line x1="${x0}" x2="${x1}" y1="${Y(nlogn)}" y2="${Y(nlogn)}" stroke="#e8590c" stroke-dasharray="6 4" stroke-width="2"/>`;
  s += `<text x="${x1}" y="${Y(nlogn) - 4}" text-anchor="end" fill="#e8590c">n·log₂n ≈ ${Math.round(nlogn)} (merge sort-ish)</text>`;
  s += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(" ")}" fill="none" stroke="#3b82f6" stroke-width="3"/>`;
  s += `<circle cx="${X(best[0])}" cy="${Y(best[1])}" r="6" fill="#2b8a3e"/>`;
  s += `<text x="${X(best[0])}" y="${Y(best[1]) + 18}" text-anchor="middle" fill="#2b8a3e" font-weight="bold">best k ≈ ${best[0]}</text>`;
  s += `<line x1="${X(n)}" x2="${X(n)}" y1="${y1}" y2="${y0}" stroke="#9c36b5" stroke-dasharray="3 3"/><text x="${X(n) + 3}" y="${y1 + 10}" fill="#9c36b5">k = n</text>`;
  s += `<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" stroke="gray"/>`;
  for (const k of [1, 10, 100, 1000, 4000].filter((k) => k <= 4 * n)) s += `<text x="${X(k)}" y="${y0 + 14}" text-anchor="middle" fill="gray">${k}</text>`;
  s += `<text x="${x1}" y="${y0 + 14}" text-anchor="end" fill="gray">number of buckets k (log scale) →</text>`;
  s += `<text x="${x0 - 4}" y="${y1 + 8}" text-anchor="end" fill="gray">work</text></svg>`;
  svgWrap.innerHTML = s;
  const w1 = work(1);
  verdict.innerHTML = `With <b>1 bucket</b> it's plain insertion sort: ≈ ${Math.round(w1).toLocaleString()} steps. ` +
    `At <b>k ≈ ${best[0]}</b>: ≈ ${Math.round(best[1]).toLocaleString()} steps (${(w1 / best[1]).toFixed(0)}× less). ` +
    (dataKind === "clustered"
      ? `Clumped data needs <b>more</b> buckets, because most of them stay empty while a few get crowded.`
      : `For evenly spread data the sweet spot is the <b>same order as n</b> (here ≈ n/2; anything from about n/4 to 2n is close): a handful of items per bucket, so total work grows ≈ linearly.`);
}
uBtn.onclick = () => { dataKind = "uniform"; draw(); };
cBtn.onclick = () => { dataKind = "clustered"; draw(); };
nIn.oninput = () => { n = Math.round(10 ** Number(nIn.value)); draw(); };
draw();
