// led-iv: why you can't dim an LED smoothly by lowering its voltage. Current (and brightness)
// is ~zero below the forward voltage, then shoots up exponentially: a 0.1 V change multiplies it.
// Simple exponential model: 1 mA at Vknee, 20 mA at Vf (typical small 5 mm LED).
// input: { color?: "red" (default) | "white", v?: starting voltage in volts }

const opts = (typeof input === "object" && input) || {};
const LEDS = {
  red:   { name: "red",   v1: 1.80, vf: 2.00, vmax: 2.40, rgb: [255, 60, 50] },
  white: { name: "white", v1: 2.75, vf: 3.10, vmax: 3.60, rgb: [235, 240, 255] },
};
let color = opts.color === "white" ? "white" : "red";
const IMAX = 40; // mA shown on the chart; above ≈30 mA a small LED is being abused

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

// I(V) in mA: I = 1 mA · 20^((V − Vknee)/(Vf − Vknee)) → exactly 1 mA at Vknee and 20 mA at Vf
const cur = (L, v) => Math.pow(20, (v - L.v1) / (L.vf - L.v1));

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;");
const redBtn = el("button", "", "🔴 Red LED", controls);
const whiteBtn = el("button", "", "⚪ White LED", controls);
const sRow = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;");
el("span", "width:110px;", "Voltage across", sRow);
const vS = el("input", "flex:1;min-width:160px;", null, sRow);
vS.type = "range"; vS.min = 0; vS.step = 0.01;
const vOut = el("b", "min-width:70px;font-family:var(--font-monospace);", "", sRow);
const svgWrap = el("div", "margin:6px 0;");
const row = el("div", "display:flex;gap:14px;align-items:center;flex-wrap:wrap;");
const ledBox = el("div", "width:54px;height:54px;border-radius:50%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;", null, row);
const led = el("div", "width:36px;height:36px;border-radius:50%;border:2px solid #555;", null, ledBox);
const note = el("div", "flex:1;min-width:200px;font-family:var(--font-monospace);font-size:13px;", null, row);

function setColor(c) {
  color = c;
  const L = LEDS[c];
  vS.max = L.vmax;
  vS.value = opts.v != null && c === (opts.color === "white" ? "white" : "red") ? Math.min(L.vmax, Math.max(0, Number(opts.v) || 0)) : L.vf;
  redBtn.style.fontWeight = c === "red" ? "bold" : "normal";
  whiteBtn.style.fontWeight = c === "white" ? "bold" : "normal";
  draw();
}

function draw() {
  const L = LEDS[color];
  const v = Number(vS.value);
  const i = v <= 0 ? 0 : cur(L, v);
  vOut.textContent = v.toFixed(2) + " V";

  const W = 600, H = 200, x0 = 40, y0 = 170, pw = W - x0 - 10, ph = 150;
  const X = (vv) => x0 + (vv / L.vmax) * pw;
  const Y = (ii) => y0 - (Math.min(ii, IMAX) / IMAX) * ph;
  let path = "";
  for (let k = 0; k <= 300; k++) {
    const vv = (k / 300) * L.vmax, ii = cur(L, vv);
    path += (k ? " L" : "M") + X(vv).toFixed(1) + " " + Y(ii).toFixed(1);
    if (ii > IMAX) break;
  }
  let grid = "";
  for (let vv = 0; vv <= L.vmax + 1e-9; vv += 0.5)
    grid += `<line x1="${X(vv)}" x2="${X(vv)}" y1="${y0}" y2="${y0 + 4}" stroke="var(--text-faint)"/><text x="${X(vv)}" y="${y0 + 16}" font-size="10" text-anchor="middle" fill="var(--text-muted)">${vv.toFixed(1)}</text>`;
  for (const ii of [0, 10, 20, 30, 40])
    grid += `<line x1="${x0}" x2="${W - 10}" y1="${Y(ii)}" y2="${Y(ii)}" stroke="var(--background-modifier-border)"/><text x="${x0 - 4}" y="${Y(ii) + 3}" font-size="10" text-anchor="end" fill="var(--text-muted)">${ii}</text>`;
  svgWrap.innerHTML =
    `<svg viewBox="0 0 ${W} ${H + 12}" width="100%">${grid}` +
    `<text x="${x0 - 4}" y="12" font-size="10" text-anchor="end" fill="var(--text-muted)">mA</text>` +
    `<text x="${W - 10}" y="${y0 + 28}" font-size="10" text-anchor="end" fill="var(--text-muted)">volts across the LED</text>` +
    `<rect x="${X(L.v1)}" y="${y0 - ph}" width="${X(L.vf + 0.1) - X(L.v1)}" height="${ph}" fill="#e8590c" opacity="0.08"/>` +
    `<text x="${X(L.v1) - 4}" y="${y0 - ph + 12}" font-size="10" text-anchor="end" fill="#e8590c">the cliff →</text>` +
    `<line x1="${X(L.vf)}" x2="${X(L.vf)}" y1="${y0}" y2="${y0 - ph}" stroke="#9c36b5" stroke-dasharray="4 3"/>` +
    `<text x="${X(L.vf) + 3}" y="${y0 - ph + 24}" font-size="10" fill="#9c36b5">Vf ≈ ${L.vf.toFixed(1)} V</text>` +
    `<path d="${path}" fill="none" stroke="#3b82f6" stroke-width="3"/>` +
    `<circle cx="${X(v)}" cy="${Y(i)}" r="6" fill="${i > 30 ? "var(--text-error)" : "#e8590c"}"/></svg>`;

  const b = Math.min(1, i / 20);
  const k = b <= 0.0031308 ? 12.92 * b : 1.055 * Math.pow(b, 1 / 2.4) - 0.055;
  const [r, g, bl] = L.rgb;
  led.style.background = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(bl * k)})`;
  led.style.boxShadow = b > 0.02 ? `0 0 ${6 + 20 * k}px rgba(${r},${g},${bl},${(0.8 * k).toFixed(2)})` : "none";

  const up = cur(L, v + 0.1);
  let msg = `${v.toFixed(2)} V → <b>${i < 0.1 ? i.toFixed(3) : i.toFixed(1)} mA</b>`;
  if (i < 0.5) msg += ` · basically <b>off</b> (below the ${L.name} LED's forward voltage)`;
  else if (i > 30) msg += ` · 🔥 too much current: this LED burns out`;
  else msg += ` · +0.1 V would give ${up > 99 ? up.toFixed(0) : up.toFixed(1)} mA (×${(up / i).toFixed(1)})`;
  note.innerHTML = msg + `<br><span style="color:var(--text-muted)">A digital pin can only give 0 V or 5 V anyway. PWM keeps the current fixed and varies <i>time on</i> instead.</span>`;
}

redBtn.onclick = () => setColor("red");
whiteBtn.onclick = () => setColor("white");
vS.oninput = draw;
setColor(color);
