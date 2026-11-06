// edge-zoom: zoom into a real (RC-limited) edge. Capacitance has to charge through resistance, so the voltage
// follows 1 − e^(−t/RC) instead of jumping. Shows the 10%/50%/90% lines, measures tr / tf / tw from the curve,
// and checks tr against the formula RC·ln 9 ≈ 2.2·RC. "Charge" animates the edge.
// input: { show?: "rise"|"fall"|"width" = "rise", rc?: RC time constant in ns 0.5–30 = 4,
//          tin?: ideal input pulse width in ns for show:"width" 5–80 = 40 }

const opts = (typeof input === "object" && input) || {};
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));
let show = ["rise", "fall", "width"].includes(opts.show) ? opts.show : "rise";
let tau = clamp(opts.rc ?? 4, 0.5, 30);
const TIN = clamp(opts.tin ?? 40, 5, 80);
const VA = 5, E = 5, PA = 10;                   // amplitude (V), edge time (ns), pulse start for "width"
let busy = false;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- UI ----------
const row1 = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;");
const showBtns = [["rise", "↗ Rise time"], ["fall", "↘ Fall time"], ["width", "⟷ Width at 50%"]].map(([k, t]) => {
  const b = el("button", "", t, row1); b.onclick = () => { if (!busy) { show = k; render(); } }; return [k, b];
});
const playBtn = el("button", "", "▶ Charge it", row1);
const row2 = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;");
el("span", "", "RC", row2);
const rcIn = el("input", "flex:1;min-width:120px;", null, row2);
rcIn.type = "range"; rcIn.min = 0.5; rcIn.max = 30; rcIn.step = 0.5;
const rcOut = el("b", "font-family:var(--font-monospace);", "", row2);
const svgWrap = el("div", "");
const live = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;");
const note = el("div", "margin-top:6px;padding:8px;border-radius:6px;background:var(--background-secondary);");

// ---------- model ----------
const win = () => (show === "width" ? 140 : 80);
function v(t) {                                // normalized 0..1
  if (show === "rise") return t < E ? 0 : 1 - Math.exp(-(t - E) / tau);
  if (show === "fall") return t < E ? 1 : Math.exp(-(t - E) / tau);
  const b = PA + TIN, v1 = 1 - Math.exp(-TIN / tau);
  return t < PA ? 0 : t < b ? 1 - Math.exp(-(t - PA) / tau) : v1 * Math.exp(-(t - b) / tau);
}
const ideal = (t) => (show === "rise" ? +(t >= E) : show === "fall" ? +(t < E) : +(t >= PA && t < PA + TIN));
function crossing(level, dir, from = 0) {       // first time v crosses level going up (dir=1) or down (-1), by sampling
  const dt = win() / 40000;
  let prev = v(from);
  for (let t = from + dt; t <= win(); t += dt) {
    const cur = v(t);
    if ((dir > 0 && prev < level && cur >= level) || (dir < 0 && prev > level && cur <= level)) return t - dt + ((level - prev) / (cur - prev)) * dt;
    prev = cur;
  }
  return null;
}

// ---------- drawing ----------
const W = 640, H = 222, X0 = 44, X1 = 630;
const X = (t) => X0 + (t / win()) * (X1 - X0);
const Y = (u) => 180 - u * 140;
const txt = (x, y, s, col, a = "middle") => `<text x="${x}" y="${y}" fill="${col}" text-anchor="${a}" font-size="11" font-weight="bold">${s}</text>`;
const vline = (t, col) => `<line x1="${X(t)}" y1="${Y(1) - 8}" x2="${X(t)}" y2="${Y(0)}" stroke="${col}" stroke-dasharray="3 3"/>`;
const bracket = (ta, tb, y, col, label) =>
  `<line x1="${X(ta)}" y1="${y}" x2="${X(tb)}" y2="${y}" stroke="${col}" stroke-width="2"/>` +
  `<line x1="${X(ta)}" y1="${y - 5}" x2="${X(ta)}" y2="${y + 5}" stroke="${col}" stroke-width="2"/>` +
  `<line x1="${X(tb)}" y1="${y - 5}" x2="${X(tb)}" y2="${y + 5}" stroke="${col}" stroke-width="2"/>` + txt((X(ta) + X(tb)) / 2, y - 6, label, col);

function curve(tEnd) {
  let d = "";
  const n = 600;
  for (let i = 0; i <= n; i++) { const t = (i / n) * tEnd; d += `${i ? "L" : "M"}${X(t).toFixed(1)} ${Y(v(t)).toFixed(1)} `; }
  return d;
}
function draw(tEnd, markers) {
  let s = "", idl = "";
  for (const [p, lab] of [[0.1, "10%"], [0.5, "50%"], [0.9, "90%"]])
    s += `<line x1="${X0}" y1="${Y(p)}" x2="${X1}" y2="${Y(p)}" stroke="var(--text-faint)" stroke-dasharray="2 4"/>` +
      `<text x="${X0 - 4}" y="${Y(p) + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${lab}</text>`;
  for (let i = 0; i <= 400; i++) { const t = (i / 400) * win(); idl += `${i ? "L" : "M"}${X(t).toFixed(1)} ${Y(ideal(t)).toFixed(1)} `; }
  let ticks = "";
  for (let t = 0; t <= win(); t += win() / 4) ticks += `<text x="${X(t)}" y="214" font-size="10" text-anchor="middle" fill="var(--text-muted)">${t} ns</text>`;
  if (markers) {
    if (show === "rise" || show === "fall") {
      const dir = show === "rise" ? 1 : -1;
      const a = crossing(dir > 0 ? 0.1 : 0.9, dir), b = crossing(dir > 0 ? 0.9 : 0.1, dir);
      const col = dir > 0 ? "#e8590c" : "#9c36b5";
      s += vline(a, col) + vline(b, col) + bracket(a, b, 22, col, `${dir > 0 ? "tr" : "tf"} = ${f2(b - a)} ns`);
    } else {
      const a = crossing(0.5, 1), b = a == null ? null : crossing(0.5, -1, a);
      if (a != null && b != null) s += vline(a, "#2b8a3e") + vline(b, "#2b8a3e") + bracket(a, b, 22, "#2b8a3e", `tw = ${f2(b - a)} ns`);
      s += txt(X(PA + TIN / 2), Y(1) + 14, `input pulse ${TIN} ns`, "var(--text-muted)");
    }
  }
  const tDot = Math.min(tEnd, win());
  svgWrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif">` + s + ticks +
    `<text x="${X0 - 4}" y="${Y(1) - 8}" text-anchor="end" font-size="10" fill="var(--text-muted)">${VA} V</text>` +
    `<path d="${idl}" fill="none" stroke="var(--text-faint)" stroke-width="1.5" stroke-dasharray="5 4"/>` +
    `<path d="${curve(tEnd)}" fill="none" stroke="#3b82f6" stroke-width="3"/>` +
    (markers ? "" : `<circle cx="${X(tDot)}" cy="${Y(v(tDot))}" r="5" fill="#3b82f6"/>`) + `</svg>`;
}

function render() {
  rcIn.value = tau;
  rcOut.textContent = `${tau} ns`;
  showBtns.forEach(([k, b]) => { b.style.background = k === show ? "var(--interactive-accent)" : ""; b.style.color = k === show ? "var(--text-on-accent)" : ""; });
  draw(win(), true);
  live.textContent = `RC = ${tau} ns, e.g. 50 Ω × ${+(tau * 20).toFixed(1)} pF (dashed = ideal edge, blue = real edge)`;
  const formula = `formula RC·ln 9 ≈ 2.2 × ${tau} = <b>${f2(tau * Math.log(9))} ns</b>`;
  if (show === "rise") {
    const a = crossing(0.1, 1), b = crossing(0.9, 1);
    note.innerHTML = `Measured on the curve: tr = t90% − t10% = ${f2(b - E)} − ${f2(a - E)} = <b>${f2(b - a)} ns</b> · ${formula} ✅<br>` +
      `It hits 99% after 4.6·RC = ${f2(4.6 * tau)} ns but <b>never exactly 100%</b>, so "start" and "end" are fuzzy. 10% and 90% are sharp points.`;
  } else if (show === "fall") {
    const a = crossing(0.9, -1), b = crossing(0.1, -1);
    note.innerHTML = `Measured: tf = t10% − t90% = ${f2(b - E)} − ${f2(a - E)} = <b>${f2(b - a)} ns</b> · ${formula} ✅<br>Discharging the capacitance is just as slow as charging it.`;
  } else {
    const a = crossing(0.5, 1), b = a == null ? null : crossing(0.5, -1, a);
    const peak = 1 - Math.exp(-TIN / tau);
    note.innerHTML = a == null || b == null
      ? `The output only reaches <b>${(peak * 100).toFixed(0)}%</b> before the input drops. It never crosses 50%, so the receiver misses the pulse entirely ❌`
      : `tw at 50% = ${f2(b)} − ${f2(a)} = <b>${f2(b - a)} ns</b> (input pulse: ${TIN} ns). ` + (Math.abs(b - a - TIN) < 0.5
        ? `The rise and the fall are both delayed by the same RC·ln 2 = ${f2(tau * Math.log(2))} ns, so the delays cancel and tw = the input width.`
        : `The output only reached ${(peak * 100).toFixed(0)}% before the input dropped, so the fall crosses 50% early and the pulse looks shorter.`);
  }
}

async function charge() {
  if (busy) return;
  busy = true;
  const tMax = show === "width" ? win() : Math.min(win(), E + 5 * tau);
  const steps = 70;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * tMax;
    draw(t, false);
    const start = show === "width" ? PA : E, k = Math.max(0, (t - start) / tau);
    live.textContent = `t = ${f2(t)} ns (${k.toFixed(1)} RC after the edge) · v = ${f2(v(t) * VA)} V = ${(v(t) * 100).toFixed(0)}%`;
    await sleep(30);
    if (!root.isConnected) return;
  }
  busy = false;
  render();
}

rcIn.oninput = () => { if (!busy) { tau = Number(rcIn.value); render(); } };
playBtn.onclick = charge;
render();
