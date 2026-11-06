// pipeline-gantt: one-at-a-time vs pipelined stages, as two Gantt charts sharing one time axis.
// Each item's latency is the same in both (stages × stage time), but the pipeline finishes one
// item every stage time once it's full → more throughput. A time cursor animates both.
// input: { stages: 3 (2–5), stageTime: 30, items: 3 (1–8), unit: "min", labels: ["Wash","Dry","Fold"] }

const opts = (typeof input === "object" && input) || {};
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
const T = Number.isFinite(Number(opts.stageTime)) && Number(opts.stageTime) > 0 ? Number(opts.stageTime) : 30;
const unit = typeof opts.unit === "string" ? opts.unit : "min";
const DEFAULT_LABELS = ["Wash", "Dry", "Fold", "Iron", "Store"];
const labelsIn = Array.isArray(opts.labels) ? opts.labels : [];
const COLORS = ["#3b82f6", "#e8590c", "#2b8a3e", "#9c36b5", "#d6336c"];
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

// ---------- DOM helpers ----------
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
function slider(label, min, max, value) {
  const row = el("div", "display:flex;gap:8px;align-items:center;margin:3px 0;flex-wrap:wrap;");
  el("span", "width:80px;", label, row);
  const inp = el("input", "flex:1;min-width:120px;", null, row);
  Object.assign(inp, { type: "range", min, max, step: 1, value });
  const out = el("b", "width:30px;font-family:var(--font-monospace);", String(value), row);
  inp.addEventListener("input", () => { out.textContent = inp.value; stop(); t = 0; draw(); });
  return inp;
}

// ---------- UI ----------
const S = slider("Stages", 2, 5, clamp(opts.stages, 2, 5, 3));
const N = slider("Items", 1, 8, clamp(opts.items, 1, 8, 3));
const ctrl = el("div", "display:flex;gap:6px;margin:8px 0;flex-wrap:wrap;");
const playBtn = el("button", "", "▶ Run the clock", ctrl);
const endBtn = el("button", "", "⏭ Show end", ctrl);
const legend = el("div", "display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);");
const svgWrap = el("div", "");
const live = el("div", "font-family:var(--font-monospace);font-size:13px;margin:6px 0;min-height:1.4em;");
const stats = el("div", "padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;line-height:1.5;");

let t = 0, raf = null, t0 = 0, busy = false;
const vals = () => ({ s: Number(S.value), n: Number(N.value) });
const label = (k) => String(labelsIn[k] ?? DEFAULT_LABELS[k] ?? `Stage ${k + 1}`);

function draw() {
  const { s, n } = vals();
  const seqTotal = n * s * T, pipeTotal = (s + n - 1) * T;
  const W = 620, x0 = 60, x1 = 600, rowH = 18, top1 = 22;
  const scale = (x1 - x0) / seqTotal;
  const top2 = top1 + n * rowH + 34;
  const H = top2 + n * rowH + 26;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif" font-size="11">`;
  const panel = (top, title, startOf, total) => {
    svg += `<text x="0" y="${top - 8}" font-weight="bold" fill="currentColor" font-size="12">${title}</text>`;
    let done = 0;
    for (let i = 0; i < n; i++) {
      const y = top + i * rowH;
      svg += `<text x="0" y="${y + 12}" fill="gray">item ${i + 1}</text>`;
      for (let k = 0; k < s; k++) {
        const st = startOf(i, k), x = x0 + st * scale, w = T * scale;
        const finished = t >= st + T, active = t > st && !finished;
        const op = finished ? 0.9 : active ? 0.6 : 0.18;
        svg += `<rect x="${x + 0.5}" y="${y}" width="${Math.max(1, w - 1)}" height="${rowH - 3}" rx="3" fill="${COLORS[k]}" fill-opacity="${op}"/>`;
        if (w > 30) svg += `<text x="${x + w / 2}" y="${y + 11}" text-anchor="middle" fill="white" font-size="9">${label(k)}</text>`;
      }
      if (t >= startOf(i, s - 1) + T) done++;
    }
    const xe = x0 + total * scale;
    svg += `<line x1="${xe}" y1="${top - 4}" x2="${xe}" y2="${top + n * rowH}" stroke="#d6336c" stroke-width="2" stroke-dasharray="4 3"/>`;
    svg += `<text x="${Math.min(xe + 3, W - 2)}" y="${top + n * rowH + 12}" fill="#d6336c" font-weight="bold" text-anchor="${xe > W - 70 ? "end" : "start"}">${fmt(total)} ${unit}</text>`;
    return done;
  };
  const seqDone = panel(top1, `One at a time: an item finishes every ${fmt(s * T)} ${unit}`, (i, k) => (i * s + k) * T, seqTotal);
  const pipeDone = panel(top2, `Pipelined: an item finishes every ${fmt(T)} ${unit} (once full)`, (i, k) => (i + k) * T, pipeTotal);
  const xc = x0 + Math.min(t, seqTotal) * scale;
  if (t > 0) svg += `<line x1="${xc}" y1="${top1 - 4}" x2="${xc}" y2="${H - 14}" stroke="var(--text-normal)" stroke-width="1.5"/>`;
  svg += `<text x="${x0}" y="${H - 2}" fill="gray">0</text><text x="${x1}" y="${H - 2}" fill="gray" text-anchor="end">${fmt(seqTotal)} ${unit}</text></svg>`;
  svgWrap.innerHTML = svg;
  legend.innerHTML = Array.from({ length: s }, (_, k) =>
    `<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${COLORS[k]};"></span> ${label(k)} (${fmt(T)} ${unit})</span>`).join("");

  live.innerHTML = t > 0
    ? `t = <b>${fmt(Math.min(t, seqTotal))} ${unit}</b> · finished: one-at-a-time <b>${seqDone}/${n}</b> · pipelined <b>${pipeDone}/${n}</b>`
    : `Press ▶. Predict: pipelined total = (${s} + ${n} − 1) × ${fmt(T)} = <b>${fmt(pipeTotal)} ${unit}</b>`;
  stats.innerHTML =
    `⏱️ <b>Latency</b> (one item, start → done): <b>${s} × ${fmt(T)} = ${fmt(s * T)} ${unit}</b> in both.<br>` +
    `🚰 <b>Throughput</b>: 1 per ${fmt(s * T)} ${unit} → 1 per ${fmt(T)} ${unit} = <b>${s}×</b> more once the pipeline is full.<br>` +
    `📦 ${n} item${n > 1 ? "s" : ""}: ${n} × ${fmt(s * T)} = <b>${fmt(seqTotal)}</b> vs ${fmt(s * T)} + ${n - 1} × ${fmt(T)} = <b>${fmt(pipeTotal)} ${unit}</b>` +
    (n === 1 ? " (one item: no gain at all)" : "");
}

function stop() { if (raf) cancelAnimationFrame(raf); raf = null; busy = false; playBtn.textContent = "▶ Run the clock"; }
function frame(now) {
  if (!root.isConnected) return stop();
  const { s, n } = vals();
  const seqTotal = n * s * T;
  const secs = Math.min(8, 1 + n * s * 0.4); // whole run in a few seconds
  t = ((now - t0) / 1000 / secs) * seqTotal;
  if (t >= seqTotal) { t = seqTotal; draw(); stop(); playBtn.textContent = "▶ Run again"; return; }
  draw();
  raf = requestAnimationFrame(frame);
}
playBtn.onclick = () => {
  if (busy) return;
  busy = true; t = 0; t0 = performance.now(); playBtn.textContent = "⏳ Running…";
  raf = requestAnimationFrame(frame);
};
endBtn.onclick = () => { stop(); const { s, n } = vals(); t = n * s * T; draw(); };

draw();
