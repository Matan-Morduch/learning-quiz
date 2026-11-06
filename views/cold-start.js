// cold-start: requests arrive at a serverless function over 10 simulated minutes.
// A request reuses a WARM idle instance if one exists; otherwise the platform starts a new one
// (COLD start: extra init time). Idle instances are shut down after the idle timeout.
// Provisioned concurrency = instances kept warm forever (you pay for them).
// input: { rate: 1 (req/s), init: 800 (ms), timeout: 60 (s), provisioned: 0, preset?: "busy"|"rare"|"spiky" }

const opts = (typeof input === "object" && input) || {};
const PRESETS = {
  busy: { rate: 10, label: "🔥 Busy API (10 req/s)" },
  rare: { rate: 0.01, label: "🐢 Rare (≈1 per 100 s)" },
  spiky: { rate: 0.3, label: "⚡ Quiet with bursts", bursts: true },
};
const DUR = 100, SIM = 600;
let st = {
  rate: 1, init: 800, timeout: 60, provisioned: 0, bursts: false,
  ...(PRESETS[opts.preset] || {}), ...opts,
};
let seed = 7;

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
const pre = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;");
for (const [k, p] of Object.entries(PRESETS)) {
  el("button", "", p.label, pre).onclick = () => { st.rate = p.rate; st.bursts = !!p.bursts; sync(); run(); };
}
function slider(label, key, min, max, step, fmt, log = false) {
  const row = el("div", "display:flex;gap:8px;align-items:center;margin:2px 0;");
  el("span", "width:170px;", label, row);
  const inp = el("input", "flex:1;", null, row);
  Object.assign(inp, { type: "range", min: log ? Math.log10(min) : min, max: log ? Math.log10(max) : max, step: log ? 0.01 : step });
  const out = el("b", "width:90px;font-family:var(--font-monospace);font-size:13px;", null, row);
  inp.oninput = () => { st[key] = log ? +(10 ** Number(inp.value)).toPrecision(2) : Number(inp.value); if (key === "rate") st.bursts = false; sync(); run(); };
  return { set: () => { inp.value = log ? Math.log10(st[key]) : st[key]; out.textContent = fmt(st[key]); } };
}
const sliders = [
  slider("📨 Requests per second", "rate", 0.005, 20, 0, (v) => `${v}/s`, true),
  slider("🥶 Cold-start init time", "init", 100, 3000, 50, (v) => `${v} ms`),
  slider("💤 Idle timeout", "timeout", 5, 300, 5, (v) => `${v} s`),
  slider("🔥 Provisioned (always warm)", "provisioned", 0, 5, 1, (v) => `${v}`),
];
function sync() { sliders.forEach((s) => s.set()); }
const again = el("button", "margin:6px 0;", "🎲 New random run");
const svgWrap = el("div", "");
const stats = el("div", "margin-top:6px;font-family:var(--font-monospace);font-size:13px;line-height:1.6;");
const note = el("div", "margin-top:4px;color:var(--text-muted);font-size:13px;");

function rng() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }

function run() {
  // arrival times (Poisson process; "bursts" adds 3 short bursts of 20 requests)
  const arrivals = [];
  let t = 0;
  while (true) { t += -Math.log(1 - rng()) / st.rate; if (t > SIM) break; arrivals.push(t); }
  if (st.bursts) for (const c of [120, 330, 480]) for (let i = 0; i < 20; i++) arrivals.push(c + rng() * 2);
  arrivals.sort((a, b) => a - b);

  // instances: { busyUntil, lastUsed, provisioned }
  let inst = Array.from({ length: st.provisioned }, () => ({ busyUntil: 0, lastUsed: 0, provisioned: true }));
  const reqs = [];
  let maxInst = inst.length;
  for (const a of arrivals) {
    inst = inst.filter((i) => i.provisioned || i.busyUntil > a || a - i.lastUsed <= st.timeout); // shut down idle ones
    const free = inst.find((i) => i.busyUntil <= a);
    let cold = false, target = free;
    if (!target) { target = { busyUntil: 0, lastUsed: 0, provisioned: false }; inst.push(target); cold = true; }
    const lat = DUR + (cold ? st.init : 0);
    target.busyUntil = a + lat / 1000;
    target.lastUsed = target.busyUntil;
    reqs.push({ t: a, lat, cold });
    maxInst = Math.max(maxInst, inst.length);
  }

  // chart: each request = a bar at its arrival time, height = latency
  const W = 600, H = 170, x0 = 40, x1 = 590, y0 = 150, y1 = 12;
  const maxLat = Math.max(DUR + st.init, 200) * 1.1;
  const X = (s) => x0 + (s / SIM) * (x1 - x0), Y = (ms) => y0 - (ms / maxLat) * (y0 - y1);
  let svg = `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" font-family="sans-serif" font-size="11">`;
  for (const r of reqs) svg += `<line x1="${X(r.t).toFixed(1)}" x2="${X(r.t).toFixed(1)}" y1="${y0}" y2="${Y(r.lat).toFixed(1)}" stroke="${r.cold ? "#e8590c" : "#3b82f6"}" stroke-width="${reqs.length > 800 ? 1 : 2}" stroke-opacity="${r.cold ? 1 : 0.6}"/>`;
  svg += `<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" stroke="gray"/>`;
  svg += `<text x="${x0 - 4}" y="${Y(DUR) + 4}" text-anchor="end" fill="gray">${DUR}ms</text><text x="${x0 - 4}" y="${Y(DUR + st.init) + 4}" text-anchor="end" fill="#e8590c">${DUR + st.init}ms</text>`;
  for (const m of [0, 2, 4, 6, 8, 10]) svg += `<text x="${X(m * 60)}" y="${y0 + 14}" text-anchor="middle" fill="gray">${m} min</text>`;
  svg += `</svg>`;
  svgWrap.innerHTML = reqs.length ? svg : `<p style="color:var(--text-muted)">No requests in these 10 minutes: the function cost $0 and nothing ran.</p>`;

  const lats = reqs.map((r) => r.lat).sort((a, b) => a - b);
  const pct = (p) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor((p / 100) * lats.length))] : 0);
  const colds = reqs.filter((r) => r.cold).length;
  stats.innerHTML =
    `requests: <b>${reqs.length}</b> · <span style="color:#e8590c">cold starts: <b>${colds}</b> (${reqs.length ? ((colds / reqs.length) * 100).toFixed(1) : 0}%)</span> · max instances: <b>${maxInst}</b><br>` +
    `latency p50: <b>${pct(50)} ms</b> · p99: <b style="color:${pct(99) > DUR ? "#e8590c" : "inherit"}">${pct(99)} ms</b> · slowest: <b>${lats.length ? lats[lats.length - 1] : 0} ms</b>`;
  note.innerHTML = `<span style="color:#3b82f6">▮ warm</span> = ${DUR} ms · <span style="color:#e8590c">▮ cold</span> = ${DUR} + ${st.init} ms init. ` +
    (st.rate < 1 / st.timeout ? "Requests are rarer than the idle timeout, so almost every one starts cold. " : "") +
    (st.provisioned ? `${st.provisioned} instance(s) are kept warm all the time (you pay for them even at 0 traffic).` : "Tip: try provisioned concurrency = 1–2.");
}

again.onclick = () => { seed = Math.floor(Math.random() * 1e9); run(); };
sync();
run();
