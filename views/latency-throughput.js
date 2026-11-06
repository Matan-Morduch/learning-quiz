// latency-throughput: packets travel down a pipe. Latency = how long ONE packet takes to cross,
// throughput = how many packets per second get pushed in. Total time = latency + size / throughput.
// input: { latency: 2 (s, 0.2–5), throughput: 4 (packets/s, 1–20), size: 12 (packets, 1–40), preset?: "tiny"|"big"|"satellite"|"slowlink" }

const opts = (typeof input === "object" && input) || {};
const PRESETS = {
  tiny: { latency: 2, throughput: 4, size: 1, label: "🔍 Tiny request" },
  big: { latency: 2, throughput: 4, size: 40, label: "📦 Big download" },
  satellite: { latency: 5, throughput: 20, size: 20, label: "🛰️ Satellite: far but wide" },
  slowlink: { latency: 0.3, throughput: 1, size: 8, label: "🐌 Close but narrow" },
};
const start = { latency: 2, throughput: 4, size: 12, ...(PRESETS[opts.preset] || {}), ...opts };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));

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
function slider(label, min, max, step, value, fmt) {
  const row = el("div", "display:flex;gap:8px;align-items:center;margin:3px 0;");
  el("span", "width:120px;", label, row);
  const inp = el("input", "flex:1;", null, row);
  Object.assign(inp, { type: "range", min, max, step, value });
  const out = el("b", "width:110px;font-family:var(--font-monospace);font-size:13px;", null, row);
  const upd = () => (out.textContent = fmt(Number(inp.value)));
  inp.addEventListener("input", () => { upd(); stop(); draw(0); });
  upd();
  return inp;
}

// ---------- UI ----------
const presetRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const L = slider("⏱️ Latency", 0.2, 5, 0.1, clamp(start.latency, 0.2, 5), (v) => `${v.toFixed(1)} s`);
const R = slider("🚰 Throughput", 1, 20, 1, clamp(start.throughput, 1, 20), (v) => `${v} packets/s`);
const N = slider("📦 Size", 1, 40, 1, clamp(start.size, 1, 40), (v) => `${v} packet${v > 1 ? "s" : ""}`);
for (const [key, p] of Object.entries(PRESETS)) {
  const b = el("button", "", p.label, presetRow);
  b.onclick = () => { L.value = p.latency; R.value = p.throughput; N.value = p.size; [L, R, N].forEach((i) => i.dispatchEvent(new Event("input"))); };
}
const ctrl = el("div", "display:flex;gap:6px;margin:8px 0;");
const sendBtn = el("button", "", "▶ Send", ctrl);
const resetBtn = el("button", "", "↺ Reset", ctrl);
const svgWrap = el("div", "");
const live = el("div", "font-family:var(--font-monospace);font-size:13px;margin:6px 0;min-height:1.4em;");
const barWrap = el("div", "margin-top:6px;");
const note = el("div", "font-size:13px;color:var(--text-muted);margin-top:6px;");

// ---------- model ----------
// Packet i (0-based) is pushed into the pipe during [i/R, (i+1)/R], then travels for L seconds.
// It has fully arrived at (i+1)/R + L. The last packet arrives at N/R + L.
const vals = () => ({ l: Number(L.value), r: Number(R.value), n: Number(N.value) });

function draw(t) {
  const { l, r, n } = vals();
  const W = 600, H = 120, x0 = 90, x1 = 510, py = 60;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif" font-size="12">`;
  // pipe: its LENGTH = latency, its WIDTH = throughput
  const pipeH = 8 + r * 2;
  s += `<rect x="${x0}" y="${py - pipeH / 2}" width="${x1 - x0}" height="${pipeH}" rx="${pipeH / 2}" fill="var(--background-secondary)" stroke="var(--background-modifier-border)"/>`;
  s += `<rect x="10" y="${py - 22}" width="70" height="44" rx="6" fill="none" stroke="#e8590c" stroke-width="2"/><text x="45" y="${py + 4}" text-anchor="middle" fill="#e8590c" font-weight="bold">Sender</text>`;
  s += `<rect x="${x1 + 10}" y="${py - 22}" width="80" height="44" rx="6" fill="none" stroke="#2b8a3e" stroke-width="2"/><text x="${x1 + 50}" y="${py + 4}" text-anchor="middle" fill="#2b8a3e" font-weight="bold">Receiver</text>`;
  s += `<text x="${(x0 + x1) / 2}" y="${py - pipeH / 2 - 8}" text-anchor="middle" fill="gray">length = latency (${l.toFixed(1)} s) · width = throughput (${r}/s)</text>`;
  let arrived = 0, inFlight = 0, waiting = 0;
  for (let i = 0; i < n; i++) {
    const depart = (i + 1) / r;
    const arrive = depart + l;
    let x, fill;
    if (t >= arrive) { arrived++; continue; }
    if (t < i / r) { waiting++; continue; }
    if (t < depart) { x = x0; fill = "#e8590c"; inFlight++; }            // being pushed into the pipe
    else { x = x0 + ((t - depart) / l) * (x1 - x0); fill = "#3b82f6"; inFlight++; }
    s += `<circle cx="${x}" cy="${py}" r="5" fill="${fill}"/>`;
  }
  s += `<text x="45" y="${py + 38}" text-anchor="middle" fill="gray">${waiting} waiting</text>`;
  s += `<text x="${x1 + 50}" y="${py + 38}" text-anchor="middle" fill="gray">${arrived}/${n} arrived</text>`;
  s += `</svg>`;
  svgWrap.innerHTML = s;

  const total = l + n / r, first = l + 1 / r;
  live.innerHTML = t > 0
    ? `t = <b>${t.toFixed(2)} s</b> · in flight: <b>${inFlight}</b> · arrived: <b>${arrived}/${n}</b>${arrived === n ? " ✅ done" : ""}`
    : `Press ▶ Send. Predict first: the last packet arrives at latency + size ÷ throughput = ${l.toFixed(1)} + ${n}/${r} = <b>${total.toFixed(2)} s</b>`;

  const latPct = (l / total) * 100;
  barWrap.innerHTML =
    `<div style="font-size:12px;color:var(--text-muted);margin-bottom:2px;">Where the ${total.toFixed(2)} s goes:</div>` +
    `<div style="display:flex;height:22px;border-radius:5px;overflow:hidden;font-size:11px;color:white;font-weight:bold;">` +
    `<div style="width:${latPct}%;background:#9c36b5;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden;">latency ${l.toFixed(1)} s</div>` +
    `<div style="width:${100 - latPct}%;background:#3b82f6;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden;">size÷throughput ${(n / r).toFixed(2)} s</div></div>`;
  const bdp = r * l;
  note.innerHTML =
    `First packet arrives after <b>${first.toFixed(2)} s</b>. ` +
    (latPct > 60 ? "⏱️ <b>Latency-bound</b>: a wider pipe barely helps. Get closer (shorter pipe)." :
      latPct < 40 ? "🚰 <b>Throughput-bound</b>: a shorter pipe barely helps. Get a wider pipe." :
      "⚖️ Both matter about equally here.") +
    `<br>The pipe can hold ≈ throughput × latency = ${r} × ${l.toFixed(1)} ≈ <b>${bdp.toFixed(1)} packets</b> in flight at once.`;
}

let raf = null, t0 = 0;
function stop() { if (raf) cancelAnimationFrame(raf); raf = null; sendBtn.textContent = "▶ Send"; }
function frame(now) {
  if (!root.isConnected) return stop();
  const t = (now - t0) / 1000;
  const { l, r, n } = vals();
  draw(t);
  if (t < l + n / r + 0.3) raf = requestAnimationFrame(frame);
  else { raf = null; sendBtn.textContent = "▶ Send again"; }
}
sendBtn.onclick = () => { stop(); t0 = performance.now(); sendBtn.textContent = "⏳ Sending…"; raf = requestAnimationFrame(frame); };
resetBtn.onclick = () => { stop(); draw(0); };

draw(0);
