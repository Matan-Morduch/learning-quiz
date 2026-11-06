// nonideal-pulse: what a real pulse looks like on an oscilloscope. Toggle overshoot, ringing, droop and
// undershoot on a 5 V pulse; each one is labeled on the trace and measured in volts.
// input: { effects?: "all" or a list like ["droop"] of effects switched on at start = "all", ideal?: show dashed ideal pulse = true }

const opts = (typeof input === "object" && input) || {};
const NAMES = ["overshoot", "ringing", "droop", "undershoot"];
const startOn = Array.isArray(opts.effects) ? opts.effects : typeof opts.effects === "string" && opts.effects !== "all" ? [opts.effects] : NAMES;
const on = Object.fromEntries(NAMES.map((k) => [k, startOn.includes(k)]));
let showIdeal = opts.ideal !== false;
const COL = { overshoot: "#d6336c", ringing: "#e8590c", droop: "#2b8a3e", undershoot: "#9c36b5" };
const HINT = {
  overshoot: "the edge flies past the HIGH level, then settles",
  ringing: "wobbles up and down after an edge, dying out (like a plucked guitar string)",
  droop: "the HIGH level sags while the pulse is on",
  undershoot: "after the falling edge it dips below the LOW level",
};
const VA = 5, T1 = 15, T2 = 65, R = 2, TEND = 100;
const f2 = (x) => x.toFixed(2);

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

// ---------- UI ----------
const row = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const btns = NAMES.map((k) => { const b = el("button", "", k, row); b.onclick = () => { on[k] = !on[k]; render(); }; return [k, b]; });
const idealBtn = el("button", "", "", row);
const svgWrap = el("div", "");
const list = el("div", "margin-top:6px;font-size:13px;");

// ---------- model (volts vs time in ns) ----------
function high(t) {                               // level while the pulse is on, t ≥ T1 + R
  const x = t - T1 - R;
  let v = VA;
  if (on.droop) v -= 0.15 * VA * (x / (T2 - T1 - R));
  if (on.overshoot) v += 0.25 * VA * Math.exp(-x / 3);
  if (on.ringing) v += 0.18 * VA * Math.exp(-x / 6) * Math.sin((2 * Math.PI * x) / 5);
  return v;
}
function v(t) {
  if (t < T1) return 0;
  if (t < T1 + R) return (VA * (t - T1)) / R;
  if (t < T2) return high(t);
  const vEnd = high(T2);
  if (t < T2 + R) return vEnd * (1 - (t - T2) / R);
  const x = t - T2 - R;
  let u = 0;
  if (on.undershoot) u -= 0.14 * VA * Math.exp(-x / 4);
  if (on.ringing) u -= 0.18 * VA * Math.exp(-x / 6) * Math.sin((2 * Math.PI * x) / 5);
  return u;
}
const idealV = (t) => (t >= T1 && t < T2 ? VA : 0);

// ---------- drawing ----------
const W = 640, H = 220, X0 = 40, X1 = 630;
const X = (t) => X0 + (t / TEND) * (X1 - X0);
const Y = (u) => 170 - (u / VA) * 120;
const path = (fn) => { let d = ""; for (let i = 0; i <= 800; i++) { const t = (i / 800) * TEND; d += `${i ? "L" : "M"}${X(t).toFixed(1)} ${Y(fn(t)).toFixed(1)} `; } return d; };
const lab = (x, y, s, c, a = "start") => `<text x="${x}" y="${y}" fill="${c}" font-size="12" font-weight="bold" text-anchor="${a}">${s}</text>`;

function render() {
  btns.forEach(([k, b]) => { b.style.background = on[k] ? COL[k] : ""; b.style.color = on[k] ? "#fff" : ""; b.textContent = (on[k] ? "✓ " : "") + k; });
  idealBtn.textContent = showIdeal ? "hide ideal" : "show ideal";

  // measure on the sampled trace
  let peak = -1e9, tPeak = 0, low = 1e9, tLow = 0;
  for (let t = T1 + R; t < T2; t += 0.01) { const u = v(t); if (u > peak) { peak = u; tPeak = t; } }
  for (let t = T2 + R; t < TEND; t += 0.01) { const u = v(t); if (u < low) { low = u; tLow = t; } }
  const endLevel = v(T2 - 0.01);

  let s = "";
  s += `<line x1="${X0}" y1="${Y(VA)}" x2="${X1}" y2="${Y(VA)}" stroke="var(--text-faint)" stroke-dasharray="2 4"/>`;
  s += `<line x1="${X0}" y1="${Y(0)}" x2="${X1}" y2="${Y(0)}" stroke="var(--text-faint)" stroke-dasharray="2 4"/>`;
  s += `<text x="${X0 - 4}" y="${Y(VA) + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">5 V</text>`;
  s += `<text x="${X0 - 4}" y="${Y(0) + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">0 V</text>`;
  if (showIdeal) s += `<path d="${path(idealV)}" fill="none" stroke="var(--text-faint)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  s += `<path d="${path(v)}" fill="none" stroke="#3b82f6" stroke-width="3"/>`;
  if (on.overshoot) s += `<circle cx="${X(tPeak)}" cy="${Y(peak)}" r="4" fill="${COL.overshoot}"/>` + lab(X(tPeak) - 6, Y(peak) - 8, "overshoot", COL.overshoot, "end");
  if (on.ringing) s += lab(X(T1 + 12), Y(VA) - 22, "ringing", COL.ringing);
  if (on.droop) s += `<line x1="${X(T2 - 12)}" y1="${Y(VA) - 2}" x2="${X(T2 - 12)}" y2="${Y(endLevel) + 2}" stroke="${COL.droop}" stroke-width="2"/>` +
    lab(X(T2 - 14), Y(VA) - 10, "droop ↘", COL.droop, "end");
  if (on.undershoot) s += `<circle cx="${X(tLow)}" cy="${Y(low)}" r="4" fill="${COL.undershoot}"/>` + lab(X(tLow) + 8, Y(low) + 16, "undershoot", COL.undershoot);
  svgWrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif">${s}</svg>`;

  const facts = {
    overshoot: `peaks at <b>${f2(peak)} V</b>, ${f2(peak - VA)} V (${(((peak - VA) / VA) * 100).toFixed(0)}%) above 5 V`,
    ringing: `swings ±${f2(0.18 * VA)} V at first, fading to ±${f2(0.18 * VA * Math.exp(-15 / 6))} V after 15 ns`,
    droop: `sags from 5.00 V to <b>${f2(endLevel)} V</b> by the end of the pulse`,
    undershoot: `dips to <b>${f2(low)} V</b>, below the 0 V LOW level`,
  };
  const active = NAMES.filter((k) => on[k]);
  list.innerHTML = active.length
    ? active.map((k) => `<div><b style="color:${COL[k]}">${k}</b>: ${HINT[k]} → ${facts[k]}</div>`).join("")
    : `<div style="color:var(--text-muted)">All effects off: this is the (nearly) ideal pulse. Switch one on.</div>`;
}

idealBtn.onclick = () => { showIdeal = !showIdeal; render(); };
render();
