// stream-sim: a buffer between a producer (network download) and a consumer (video playback at 1×).
// Shows underflow (stalls), backpressure when full, and the size-vs-delay trade-off.
// Opens with 30 s already simulated so the chart answers the question before you press anything.
// input: { speed?: download speed as × playback (0–3, default 1.5),
//          size?: buffer size in seconds of video (1–20, default 6),
//          mode?: "steady" | "bursty" | "flaky" (default "steady") }

const opts = (typeof input === "object" && input) || {};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SPEED0 = clamp(Number(opts.speed ?? 1.5), 0, 3);
const SIZE0 = clamp(Math.round(Number(opts.size ?? 6)), 1, 20);
const MODE0 = ["steady", "bursty", "flaky"].includes(opts.mode) ? opts.mode : "steady";
const DT = 0.1;          // seconds of simulated time per tick
const WINDOW = 300;      // ticks kept in the chart (30 s)
const PREBUFFER = 2;     // seconds needed before playback (re)starts

// ---------- tiny DOM helpers ----------
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
  const row = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:3px 0;");
  el("span", "width:120px;", label, row);
  const inp = el("input", "flex:1;min-width:120px;", null, row);
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  const out = el("b", "width:110px;", null, row);
  const upd = () => { out.textContent = fmt(Number(inp.value)); };
  inp.addEventListener("input", upd);
  upd();
  return inp;
}

// ---------- UI ----------
const pipe = el("div", "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:13px;");
const prodEl = el("span", "padding:4px 8px;border:2px solid #e8590c;border-radius:6px;", null, pipe);
el("span", "color:var(--text-muted);", "→", pipe);
el("span", "padding:4px 8px;border:2px solid var(--interactive-accent);border-radius:6px;", "🪣 buffer", pipe);
el("span", "color:var(--text-muted);", "→", pipe);
el("span", "padding:4px 8px;border:2px solid #2b8a3e;border-radius:6px;", "📺 consumer: playback 1.0×", pipe);

const speed = slider("Download speed", 0, 3, 0.1, SPEED0, (v) => `${v.toFixed(1)}× playback`);
const size = slider("Buffer size", 1, 20, 1, SIZE0, (v) => `${v} s of video`);
const modeRow = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:3px 0;");
el("span", "width:120px;", "Wi-Fi mode", modeRow);
const mode = el("select", "", null, modeRow);
for (const [v, t] of [["steady", "Steady"], ["bursty", "Bursty (on/off)"], ["flaky", "Terrible (random drops)"]]) {
  const o = el("option", "", t, mode); o.value = v;
}
mode.value = MODE0;

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;");
const startBtn = el("button", "", "▶ Play live", controls);
const ffBtn = el("button", "", "⏩ Simulate 30 s", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const slots = el("div", "display:flex;gap:3px;margin:6px 0;min-height:30px;");
const status = el("div", "font-weight:bold;margin:6px 0;min-height:1.4em;");
const chart = el("div", "margin:4px 0;");
const stats = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);line-height:1.5;");

// ---------- simulation ----------
let seed, buffer, playing, watched, stalls, stalledTime, burstOn, burstTimer, netNow, full, hist, t;
let running = false, timer = null;
function rand() { // mulberry32: deterministic, so "Simulate 30 s" is repeatable
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
function reset() {
  seed = 12345; buffer = 0; playing = false; watched = 0; stalls = 0; stalledTime = 0;
  burstOn = true; burstTimer = 1.5; netNow = 0; full = false; hist = []; t = 0;
}

function step() {
  const cap = Number(size.value), base = Number(speed.value);
  burstTimer -= DT;
  if (burstTimer <= 0) { burstOn = !burstOn; burstTimer = 0.5 + rand() * 2.5; }
  if (mode.value === "steady") netNow = base;
  else if (mode.value === "bursty") netNow = burstOn ? base * 2 : 0;
  else netNow = rand() < 0.35 ? 0 : base * (0.3 + rand() * 1.7);

  if (buffer > cap) buffer = cap;
  full = buffer >= cap - 1e-9;
  if (!full) buffer = Math.min(cap, buffer + netNow * DT);   // backpressure: stop downloading when full

  let stalledNow = false;
  if (playing) {
    if (buffer >= DT - 1e-9) { buffer -= DT; watched += DT; }
    else { playing = false; stalls++; stalledNow = true; }   // underflow
  } else {
    if (watched > 0) { stalledTime += DT; stalledNow = true; }
    if (buffer >= Math.min(PREBUFFER, cap) - 1e-9) playing = true;
  }
  t += DT;
  hist.push({ b: buffer, s: stalledNow, f: full });
  if (hist.length > WINDOW) hist.shift();
}

function render() {
  const cap = Number(size.value);
  prodEl.textContent = `📡 producer: download ${netNow.toFixed(1)}×`;
  let h = "";
  for (let i = 0; i < cap; i++) {
    const frac = clamp(buffer - i, 0, 1);
    h += `<div style="flex:1;height:30px;border:1px solid var(--background-modifier-border);border-radius:4px;overflow:hidden;background:var(--background-secondary);">` +
      `<div style="height:100%;width:${(frac * 100).toFixed(0)}%;background:var(--interactive-accent);"></div></div>`;
  }
  slots.innerHTML = h;

  const last = hist[hist.length - 1];
  if (!hist.length) status.textContent = "Press ▶ Play live, or ⏩ to simulate 30 s instantly.";
  else if (!playing && watched === 0) status.textContent = "⏳ Loading… filling the buffer before playback starts";
  else if (!playing) status.innerHTML = `⏳ Buffering… <span style="color:var(--text-error)">UNDERFLOW: the buffer ran empty</span>`;
  else if (last && last.f) status.textContent = "▶ Playing · download paused: buffer full (backpressure)";
  else status.textContent = "▶ Playing";

  // chart: buffer level over the last 30 s, stalls shaded red
  const W = 300, H = 70;
  let svg = `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" style="max-width:640px" font-family="sans-serif" font-size="8">`;
  svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--background-secondary)"/>`;
  hist.forEach((p, i) => { if (p.s) svg += `<rect x="${i}" y="0" width="1.2" height="${H}" fill="#d6336c" opacity="0.35"/>`; });
  if (hist.length > 1) {
    const pts = hist.map((p, i) => `${i},${(H - (p.b / cap) * (H - 4) - 2).toFixed(1)}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>`;
  }
  svg += `<text x="2" y="${H + 10}" fill="var(--text-muted)">buffer level over the last 30 s (top = full ${cap} s)</text>`;
  svg += `<text x="${W - 2}" y="${H + 10}" text-anchor="end" fill="#d6336c">■ stalled</text></svg>`;
  chart.innerHTML = svg;

  const avg = mode.value === "bursty" ? Number(speed.value) : mode.value === "flaky" ? Number(speed.value) * 0.65 * 1.15 : Number(speed.value);
  stats.innerHTML =
    `time ${t.toFixed(1)} s · buffer <b>${buffer.toFixed(1)} s</b> ahead = <b>${buffer.toFixed(1)} s of delay</b><br>` +
    `watched <b>${watched.toFixed(1)} s</b> · stalls <b>${stalls}</b> · time stalled <b>${stalledTime.toFixed(1)} s</b><br>` +
    `average download ≈ ${avg.toFixed(2)}× vs playback 1.0× → ` +
    (avg < 1 - 1e-9 ? `<span style="color:var(--text-error)">slower on average: stalls will never stop, a bigger buffer only delays them</span>`
      : `enough on average: the buffer only has to cover the gaps`);
}

function tick() {
  if (!root.isConnected) { clearInterval(timer); timer = null; return; }
  step();
  render();
}
function stop() { running = false; if (timer) clearInterval(timer); timer = null; startBtn.textContent = "▶ Play live"; }

startBtn.onclick = () => {
  if (running) { stop(); render(); return; }
  running = true; startBtn.textContent = "⏸ Pause";
  timer = setInterval(tick, DT * 1000);
};
ffBtn.onclick = () => { for (let i = 0; i < WINDOW; i++) step(); render(); };
resetBtn.onclick = () => { stop(); reset(); render(); };
size.addEventListener("input", () => render());

reset();
for (let i = 0; i < WINDOW; i++) step();   // open with 30 s already simulated
render();
