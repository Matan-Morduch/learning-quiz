// serverless-scaling: one simulated day of traffic, handled by a fixed fleet of servers vs serverless functions.
// Servers: fixed capacity, fixed cost → idle waste at night, dropped requests during spikes.
// Serverless: instances = requests/s × duration (Little's Law), scales to zero, pay per request.
// input: { pattern: "steady"|"office"|"spiky"|"viral" (default "office"), servers: 3 }

const opts = (typeof input === "object" && input) || {};
const PATTERNS = {
  steady: { label: "📈 Steady", f: () => 150 },
  office: { label: "🏢 Office hours", f: (h) => (h >= 8 && h <= 18 ? 10 + 290 * Math.sin((Math.PI * (h - 8)) / 10) : 10) },
  spiky: { label: "⚡ Spiky", f: (h) => 40 + [3, 9.5, 13, 20].reduce((s, c) => s + 400 * Math.exp(-((h - c) ** 2) / (2 * 0.3 ** 2)), 0) },
  viral: { label: "🚀 Goes viral at 3 pm", f: (h) => 30 + 2500 * Math.exp(-((h - 15) ** 2) / (2 * 0.7 ** 2)) },
};
// Illustrative prices (roughly AWS-like): a small server ≈ $0.05/hour and handles ~100 req/s.
// A function call of 100 ms at 128 MB ≈ $0.20/million requests + 0.0125 GB-s × $0.0000166667 ≈ $0.41 per million.
const SERVER_CAP = 100, SERVER_PER_HOUR = 0.05, PER_MILLION = 0.41, DURATION = 0.1, CONCURRENCY_LIMIT = 1000;

let pattern = PATTERNS[opts.pattern] ? opts.pattern : "office";
let servers = Math.max(1, Math.min(10, opts.servers ?? 3));
let playH = null, raf = null;

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
const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
const patBtns = {};
for (const [k, p] of Object.entries(PATTERNS)) {
  patBtns[k] = el("button", "", p.label, top);
  patBtns[k].onclick = () => { pattern = k; stop(); draw(); };
}
const row = el("div", "display:flex;gap:8px;align-items:center;margin:8px 0;");
el("span", "", "🖥️ Fixed servers:", row);
const sl = el("input", "flex:1;", null, row);
Object.assign(sl, { type: "range", min: 1, max: 10, step: 1, value: servers });
const slOut = el("b", "width:170px;font-family:var(--font-monospace);font-size:13px;", null, row);
sl.oninput = () => { servers = Number(sl.value); stop(); draw(); };
const playBtn = el("button", "", "▶ Play the day");
const svgWrap = el("div", "margin-top:6px;");
const live = el("div", "font-family:var(--font-monospace);font-size:13px;min-height:1.4em;");
const table = el("div", "margin-top:8px;");
const verdict = el("div", "margin-top:6px;");

function simulate() {
  const f = PATTERNS[pattern].f, cap = servers * SERVER_CAP;
  let total = 0, dropped = 0, throttled = 0, used = 0, peak = 0;
  const pts = [];
  for (let i = 0; i <= 288; i++) {           // every 5 minutes
    const h = i / 12, rate = f(h);
    pts.push([h, rate]);
    if (i === 288) break;
    const n = rate * 300;
    total += n;
    dropped += Math.max(0, rate - cap) * 300;
    used += Math.min(rate, cap) * 300;
    const inst = rate * DURATION;
    peak = Math.max(peak, inst);
    throttled += Math.max(0, inst - CONCURRENCY_LIMIT) / DURATION * 300;
  }
  const idlePct = 100 - (used / (cap * 86400)) * 100;
  return {
    pts, cap, total, dropped, idlePct, peak, throttled,
    serverCost: servers * SERVER_PER_HOUR * 24,
    fnCost: (total / 1e6) * PER_MILLION,
  };
}

function draw() {
  for (const [k, b] of Object.entries(patBtns)) b.style.outline = k === pattern ? "2px solid var(--interactive-accent)" : "none";
  sl.value = servers;
  slOut.textContent = `${servers} × ${SERVER_CAP} = ${servers * SERVER_CAP} req/s`;
  const s = simulate();
  const W = 600, H = 200, x0 = 40, x1 = 590, y0 = 180, y1 = 15;
  const maxY = Math.max(s.cap, ...s.pts.map((p) => p[1])) * 1.1;
  const X = (h) => x0 + (h / 24) * (x1 - x0), Y = (v) => y0 - (v / maxY) * (y0 - y1);
  let area = `M${X(0)} ${y0}`, line = "";
  for (const [h, v] of s.pts) { area += ` L${X(h).toFixed(1)} ${Y(v).toFixed(1)}`; line += `${line ? "L" : "M"}${X(h).toFixed(1)} ${Y(v).toFixed(1)} `; }
  area += ` L${X(24)} ${y0} Z`;
  let svg = `<svg viewBox="0 0 ${W} ${H + 20}" width="100%" font-family="sans-serif" font-size="11">`;
  svg += `<defs><clipPath id="above"><rect x="0" y="0" width="${W}" height="${Y(s.cap)}"/></clipPath><clipPath id="below"><rect x="0" y="${Y(s.cap)}" width="${W}" height="${H}"/></clipPath></defs>`;
  // idle capacity (gray) = between traffic and the capacity line
  svg += `<rect x="${x0}" y="${Y(s.cap)}" width="${x1 - x0}" height="${y0 - Y(s.cap)}" fill="gray" fill-opacity="0.15"/>`;
  svg += `<path d="${area}" fill="#3b82f6" fill-opacity="0.35" clip-path="url(#below)"/>`;
  svg += `<path d="${area}" fill="#d6336c" fill-opacity="0.45" clip-path="url(#above)"/>`;
  svg += `<path d="${line}" fill="none" stroke="#3b82f6" stroke-width="2"/>`;
  svg += `<line x1="${x0}" x2="${x1}" y1="${Y(s.cap)}" y2="${Y(s.cap)}" stroke="#e8590c" stroke-width="2" stroke-dasharray="6 4"/>`;
  svg += `<text x="${x1}" y="${Y(s.cap) - 4}" text-anchor="end" fill="#e8590c" font-weight="bold">server capacity ${s.cap} req/s</text>`;
  for (const h of [0, 6, 12, 18, 24]) svg += `<text x="${X(h)}" y="${y0 + 14}" text-anchor="middle" fill="gray">${String(h).padStart(2, "0")}:00</text>`;
  svg += `<text x="${x0 - 4}" y="${y1 + 4}" text-anchor="end" fill="gray">${Math.round(maxY)}</text><text x="${x0 - 4}" y="${y0}" text-anchor="end" fill="gray">0</text>`;
  if (playH != null) {
    const v = PATTERNS[pattern].f(playH);
    svg += `<line x1="${X(playH)}" x2="${X(playH)}" y1="${y1}" y2="${y0}" stroke="var(--text-muted)"/><circle cx="${X(playH)}" cy="${Y(v)}" r="5" fill="#3b82f6"/>`;
    const inst = v * DURATION;
    live.innerHTML = `${String(Math.floor(playH)).padStart(2, "0")}:${String(Math.floor((playH % 1) * 60)).padStart(2, "0")} · traffic <b>${Math.round(v)} req/s</b> · ` +
      `servers: ${v > s.cap ? `<b style="color:#d6336c">dropping ${Math.round(v - s.cap)} req/s</b>` : `${Math.round((1 - v / s.cap) * 100)}% idle`} · ` +
      `serverless: <b>${inst.toFixed(1)}</b> instances running (= ${Math.round(v)} × ${DURATION} s)`;
  } else live.innerHTML = `<span style="color:var(--text-muted)">🟦 served · <span style="color:#d6336c">🟥 dropped by servers</span> · ⬜ server capacity paid for but idle</span>`;
  svg += `</svg>`;
  svgWrap.innerHTML = svg;

  const m = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : Math.round(n));
  table.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr><th style="text-align:left"></th><th style="text-align:left">🖥️ ${servers} fixed server(s)</th><th style="text-align:left">⚡ Serverless</th></tr>
    <tr><td>Requests today</td><td colspan="2">${m(s.total)}</td></tr>
    <tr><td>Dropped / throttled</td><td style="color:${s.dropped ? "#d6336c" : "inherit"}">${m(s.dropped)} (${((s.dropped / s.total) * 100).toFixed(1)}%)</td><td style="color:${s.throttled ? "#d6336c" : "inherit"}">${m(s.throttled)}${s.throttled ? " (hit the 1000-instance limit)" : ""}</td></tr>
    <tr><td>Capacity paid for but idle</td><td>${s.idlePct.toFixed(0)}%</td><td>0% (scales to zero)</td></tr>
    <tr><td>Peak instances</td><td>${servers} (always on)</td><td>${s.peak.toFixed(0)}</td></tr>
    <tr><td>Cost for the day</td><td><b>$${s.serverCost.toFixed(2)}</b></td><td><b>$${s.fnCost.toFixed(2)}</b></td></tr></table>`;
  const cheaper = s.fnCost < s.serverCost ? "serverless" : "servers";
  verdict.innerHTML = `💡 ${cheaper === "serverless" ? "Serverless is cheaper here" : "Fixed servers are cheaper here"}` +
    (s.dropped > 0 ? `, and the servers <b>dropped ${((s.dropped / s.total) * 100).toFixed(1)}%</b> of requests.` : ".") +
    ` <span style="color:var(--text-muted);font-size:12px">(Illustrative prices: $${SERVER_PER_HOUR}/server-hour vs $${PER_MILLION} per million 100 ms calls.)</span>`;
}

function stop() { if (raf) cancelAnimationFrame(raf); raf = null; playH = null; playBtn.textContent = "▶ Play the day"; }
let t0 = 0;
function frame(now) {
  if (!root.isConnected) return stop();
  playH = ((now - t0) / 10000) * 24;              // one day in 10 s
  if (playH >= 24) { stop(); draw(); return; }
  draw();
  raf = requestAnimationFrame(frame);
}
playBtn.onclick = () => { if (raf) { stop(); draw(); return; } t0 = performance.now(); playBtn.textContent = "⏹ Stop"; raf = requestAnimationFrame(frame); };
draw();
