// bucket-cost-squares: why bucket sort is O(n) on evenly spread data.
// Sorting a bucket of b items costs about b² (insertion sort), so each bucket is drawn as a b×b square
// of tiles. Evenly spread → lots of tiny squares (total ≈ 2n). Clumped → one huge square (≈ n²).
// input: { n: 40 (10–200), data: "uniform"|"clustered" }

const opts = (typeof input === "object" && input) || {};
let n = Math.max(10, Math.min(200, opts.n ?? 40));
let dataKind = opts.data === "clustered" ? "clustered" : "uniform";
let counts = [];

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
const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const uBtn = el("button", "", "🎲 Evenly spread", top);
const cBtn = el("button", "", "🫧 Clumped", top);
const reroll = el("button", "", "🔁 Scatter again", top);
const nRow = el("label", "display:flex;gap:6px;align-items:center;font-size:13px;margin-left:auto;", "n = k =", top);
const nIn = el("input", "width:110px;", null, nRow);
Object.assign(nIn, { type: "range", min: 10, max: 200, step: 10, value: n });
const nOut = el("b", "width:30px;", null, nRow);
const hist = el("div", "margin:10px 0 4px;");
const squares = el("div", "display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin:8px 0;min-height:30px;");
const totals = el("div", "margin-top:6px;padding:8px;border-radius:6px;background:var(--background-secondary);line-height:1.7;");

function scatter() {
  counts = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const x = dataKind === "uniform" ? Math.random() : (Math.floor(0.42 * n) + 0.05 + Math.random() * 0.9) / n; // clumped: all inside one bucket
    counts[Math.min(n - 1, Math.floor(x * n))]++;
  }
  draw();
}

function draw() {
  nOut.textContent = n;
  uBtn.style.outline = dataKind === "uniform" ? "2px solid var(--interactive-accent)" : "none";
  cBtn.style.outline = dataKind === "clustered" ? "2px solid var(--interactive-accent)" : "none";

  // histogram: how many buckets hold 0, 1, 2, … items
  const bySize = {};
  for (const c of counts) bySize[c] = (bySize[c] || 0) + 1;
  const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
  const maxCount = Math.max(...Object.values(bySize));
  hist.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">How many of the ${n} buckets got 0, 1, 2… items:</div>` +
    `<div style="display:flex;gap:6px;align-items:flex-end;height:90px;">` +
    sizes.slice(0, 12).map((s) => `<div style="text-align:center;width:42px;">
      <div style="font-size:11px;">${bySize[s]}</div>
      <div style="height:${Math.max(3, (bySize[s] / maxCount) * 60)}px;background:${s === 0 ? "var(--background-modifier-border)" : "#3b82f6"};border-radius:3px 3px 0 0;"></div>
      <div style="font-size:11px;color:var(--text-muted);">${s} item${s === 1 ? "" : "s"}</div></div>`).join("") +
    (sizes.length > 12 ? `<div style="font-size:11px;color:var(--text-muted);align-self:center;">…up to ${sizes[sizes.length - 1]}</div>` : "") + `</div>`;

  // squares: each non-empty bucket = b×b tiles (its sorting cost)
  const filled = counts.filter((c) => c > 0).sort((a, b) => b - a);
  const tile = Math.max(1, Math.min(9, Math.floor(300 / filled[0]))); // biggest square ≤ ~300px wide
  squares.innerHTML = `<div style="width:100%;font-size:12px;color:var(--text-muted);">Each bucket's sorting cost ≈ b² → drawn as a b × b square (1 tile = 1 step):</div>` +
    filled.map((b) => `<div title="bucket with ${b} items: ${b}² = ${b * b} steps" style="width:${b * tile}px;height:${b * tile}px;
      background-image:linear-gradient(var(--background-primary) 1px, transparent 1px),linear-gradient(90deg, var(--background-primary) 1px, transparent 1px);
      background-size:${tile}px ${tile}px;background-color:${b >= 4 ? "#e8590c" : "#2b8a3e"};"></div>`).join("");

  const sumSq = counts.reduce((a, c) => a + c * c, 0);
  const total = n + n + sumSq;
  const nlogn = Math.round(n * Math.log2(n));
  totals.innerHTML =
    `Sorting all buckets: Σ b² = <b>${sumSq}</b> steps ` +
    (dataKind === "uniform"
      ? `≈ <b>${(sumSq / n).toFixed(1)} × n</b> (theory: 2n − 1 = ${2 * n - 1}). Small squares stay small!`
      : `: one bucket got <b>${filled[0]}</b> of ${n} items, and its square alone is ${filled[0]}² = <b>${filled[0] * filled[0]}</b>.`) +
    `<br>Whole sort ≈ n (scatter) + k (visit buckets) + Σ b² = ${n} + ${n} + ${sumSq} = <b>${total}</b> ≈ <b>${(total / n).toFixed(1)} × n</b>` +
    ` · compare n·log₂n ≈ ${nlogn} · all in one bucket: n² = ${n * n}` +
    `<br><span style="color:var(--text-muted);font-size:13px;">${dataKind === "uniform"
      ? "Double n and the total roughly doubles too (try it!): that's what O(n) means."
      : "Double n and the big square's area roughly quadruples: that's O(n²)."}</span>`;
}

uBtn.onclick = () => { dataKind = "uniform"; scatter(); };
cBtn.onclick = () => { dataKind = "clustered"; scatter(); };
reroll.onclick = scatter;
nIn.oninput = () => { n = Number(nIn.value); scatter(); };
scatter();
