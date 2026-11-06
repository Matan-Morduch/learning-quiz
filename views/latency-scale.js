// latency-scale: latency numbers worth knowing, on a log scale and stretched to human time
// ("if 1 ns were 1 second"), plus a speed-of-light floor calculator for any distance.
// input: { highlight: "l1"|"ram"|"ssd"|"disk"|"net" (default "ram"), km: 5570, medium: "fiber"|"vacuum" (default "fiber"),
//          focus: "table"|"light"|"both" (default "both") }

const opts = (typeof input === "object" && input) || {};
const ROWS = [
  { key: "l1", name: "L1 cache read", s: 1e-9, show: "≈ 1 ns" },
  { key: "ram", name: "RAM read", s: 100e-9, show: "≈ 100 ns" },
  { key: "ssd", name: "SSD random read", s: 100e-6, show: "≈ 100 µs" },
  { key: "disk", name: "Hard disk seek", s: 10e-3, show: "≈ 10 ms" },
  { key: "net", name: "Round trip USA ↔ Europe", s: 150e-3, show: "≈ 150 ms" },
];
const SPEED = { fiber: 200000, vacuum: 300000 }; // km/s
const PRESETS = [
  { label: "🗽→🇬🇧 NY → London", km: 5570, medium: "fiber" },
  { label: "🛰️ Geostationary (up + down)", km: 72000, medium: "vacuum" },
  { label: "🛰️ Starlink (up + down)", km: 1100, medium: "vacuum" },
];
let hl = ROWS.some((r) => r.key === opts.highlight) ? opts.highlight : "ram";
const focus = ["table", "light", "both"].includes(opts.focus) ? opts.focus : "both";
const nice = (x) => (x >= 100 ? Math.round(x).toLocaleString("en-US") : String(+x.toPrecision(3)));
function humanTime(sec) {
  const u = [["years", 365.25 * 86400], ["months", 30.44 * 86400], ["days", 86400], ["hours", 3600], ["min", 60]];
  for (const [n, v] of u) if (sec >= v * 1.1 || (n === "years" && sec >= v)) return `≈ ${nice(sec / v)} ${n}`;
  return `${nice(sec)} s`;
}
const ms = (sec) => `${nice(sec * 1000)} ms`;

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

// ---------- section A: the ladder ----------
const tableBox = el("div", "");
el("div", "font-weight:bold;margin-bottom:4px;", "🔢 Latency ladder (log scale: each grid step = 10× slower). Click a row.", tableBox);
const bars = el("div", "", null, tableBox);
const tableNote = el("div", "font-family:var(--font-monospace);font-size:12px;margin-top:6px;min-height:2.8em;", null, tableBox);

function drawTable() {
  const minLog = -9, maxLog = 0; // 1 ns … 1 s
  bars.innerHTML = "";
  for (const r of ROWS) {
    const row = el("div", `display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:2px 0;cursor:pointer;padding:2px 4px;border-radius:5px;${r.key === hl ? "background:var(--background-secondary);outline:2px solid #e8590c;" : ""}`, null, bars);
    el("span", "width:150px;font-size:12px;flex-shrink:0;", r.name, row);
    const track = el("div", "flex:1;height:14px;background:var(--background-modifier-border);border-radius:4px;position:relative;min-width:80px;", null, row);
    const pct = ((Math.log10(r.s) - minLog) / (maxLog - minLog)) * 100;
    el("div", `height:100%;width:${Math.max(2, pct)}%;background:${r.key === hl ? "#e8590c" : "#3b82f6"};border-radius:4px;`, null, track);
    el("span", "width:70px;font-family:var(--font-monospace);font-size:12px;flex-shrink:0;", r.show, row);
    el("span", "width:90px;font-size:12px;color:var(--text-muted);flex-shrink:0;", humanTime(r.s * 1e9), row);
    row.onclick = () => { hl = r.key; drawTable(); };
  }
  const r = ROWS.find((x) => x.key === hl), l1 = ROWS[0];
  tableNote.innerHTML =
    `${r.name}: ${r.show} = <b>${nice(r.s / l1.s)}×</b> an L1 read.<br>` +
    `Stretch 1 ns → 1 s: ${nice(r.s * 1e9)} s = <b>${humanTime(r.s * 1e9)}</b>.`;
}

// ---------- section B: speed-of-light floor ----------
const lightBox = el("div", focus === "both" ? "margin-top:14px;padding-top:10px;border-top:1px solid var(--background-modifier-border);" : "");
el("div", "font-weight:bold;margin-bottom:4px;", "💡 Speed-of-light floor: no amount of bandwidth beats this", lightBox);
const pRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;", null, lightBox);
const kRow = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;", null, lightBox);
el("span", "", "Distance", kRow);
const kmIn = el("input", "width:90px;", null, kRow);
Object.assign(kmIn, { type: "number", min: 1, step: "any", value: Number(opts.km) > 0 ? Number(opts.km) : 5570 });
el("span", "", "km through", kRow);
const medSel = el("select", "", null, kRow);
for (const [k, v] of Object.entries(SPEED)) { const o = el("option", "", `${k === "fiber" ? "glass fiber" : "air / space"} (${nice(v)} km/s)`, medSel); o.value = k; }
medSel.value = SPEED[opts.medium] ? opts.medium : "fiber";
const lightOut = el("div", "font-family:var(--font-monospace);font-size:13px;margin-top:6px;line-height:1.6;", null, lightBox);
const trip = el("div", "margin-top:4px;", null, lightBox);
for (const p of PRESETS) {
  const b = el("button", "", p.label, pRow);
  b.onclick = () => { kmIn.value = p.km; medSel.value = p.medium; drawLight(); };
}

let raf = null, busy = false;
function drawLight() {
  const km = Number(kmIn.value) > 0 ? Number(kmIn.value) : 5570;
  const v = SPEED[medSel.value] || SPEED.fiber;
  const one = km / v, rtt = 2 * one;
  const feel = rtt < 0.1 ? "under 100 ms: still feels instant" : rtt < 1 ? "over 100 ms: you notice the lag" : "over 1 s: painful";
  lightOut.innerHTML =
    `one-way ≥ ${nice(km)} km ÷ ${nice(v)} km/s = <b style="color:#9c36b5">${ms(one)}</b><br>` +
    `round trip (RTT) ≥ 2 × ${ms(one)} = <b style="color:#9c36b5">${ms(rtt)}</b> · ${feel}`;
  animate(one);
}
// a light pulse crossing the distance: slowed so the one-way trip lasts 1.5 s on screen
function animate(one) {
  if (raf) cancelAnimationFrame(raf);
  busy = true;
  const t0 = performance.now(), dur = 1500;
  const frame = (now) => {
    if (!root.isConnected) { busy = false; return; }
    const f = Math.min(1, (now - t0) / dur);
    trip.innerHTML = `<svg viewBox="0 0 400 30" width="100%"><line x1="10" y1="15" x2="390" y2="15" stroke="var(--background-modifier-border)" stroke-width="4"/>` +
      `<circle cx="${10 + f * 380}" cy="15" r="7" fill="#9c36b5"/><text x="10" y="29" font-size="10" fill="gray">A</text>` +
      `<text x="390" y="29" font-size="10" fill="gray" text-anchor="end">B · t = ${ms(f * one)}</text></svg>`;
    if (f < 1) raf = requestAnimationFrame(frame); else { raf = null; busy = false; }
  };
  raf = requestAnimationFrame(frame);
}
kmIn.addEventListener("input", drawLight);
medSel.addEventListener("change", drawLight);

if (focus === "light") tableBox.style.display = "none";
if (focus === "table") lightBox.style.display = "none";
drawTable();
drawLight();
