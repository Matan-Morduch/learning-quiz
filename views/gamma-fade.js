// gamma-fade: 50% duty doesn't LOOK half as bright. Two LEDs fade side by side: one with a
// straight-line duty ramp (jumps bright fast, then barely changes), one gamma-corrected (looks even).
// Plus the perceived-brightness curve (CIE L*): 50% duty feels ≈76%, ≈18% duty feels 50%.
// The screen shows each light level as the sRGB value that emits that much light, so what you
// see is what a real LED would look like.
// input: { duty?: 0–100 probe position on the curve (default 50), secs?: fade length (default 3) }

const opts = (typeof input === "object" && input) || {};
let probe = Math.max(0, Math.min(100, Number(opts.duty ?? 50)));
const SECS = Math.max(1, Math.min(10, Number(opts.secs) || 3));

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
const feels = (y) => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 100;      // 0–1
const dutyFor = (l) => { const L = l * 100; return L > 8 ? Math.pow((L + 16) / 116, 3) : L / 903.3; };
const srgb = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
const light = (y) => { const k = srgb(Math.max(0, Math.min(1, y))); return `rgb(${Math.round(255 * k)},${Math.round(212 * k)},${Math.round(59 * k)})`; };

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const playBtn = el("button", "", "▶ Fade 0 → 100%", controls);
const pRow = el("div", "display:flex;gap:8px;align-items:center;flex:1;min-width:220px;", null, controls);
el("span", "", "probe duty", pRow);
const pS = el("input", "flex:1;", null, pRow);
pS.type = "range"; pS.min = 0; pS.max = 100; pS.step = 0.5; pS.value = probe;

function stripRow(label) {
  const r = el("div", "display:flex;align-items:center;gap:8px;margin:4px 0;flex-wrap:wrap;");
  el("span", "width:130px;font-size:12px;", label, r);
  const strip = el("div", "display:flex;gap:2px;flex:1;min-width:200px;background:#111;padding:3px;border-radius:5px;", null, r);
  const ledBox = el("div", "width:34px;height:34px;border-radius:50%;background:#111;display:flex;align-items:center;justify-content:center;", null, r);
  const led = el("div", "width:24px;height:24px;border-radius:50%;", null, ledBox);
  return { strip, led };
}
const linRow = stripRow("Linear duty steps");
const gamRow = stripRow("Gamma-corrected");
const svgWrap = el("div", "margin-top:6px;");
const note = el("div", "margin-top:6px;font-family:var(--font-monospace);font-size:13px;min-height:2.8em;");

function strips() {
  let a = "", b = "";
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    a += `<div title="duty ${Math.round(t * 100)}%" style="flex:1;height:24px;border-radius:3px;background:${light(t)};"></div>`;
    b += `<div title="duty ${(dutyFor(t) * 100).toFixed(1)}%" style="flex:1;height:24px;border-radius:3px;background:${light(dutyFor(t))};"></div>`;
  }
  linRow.strip.innerHTML = a;
  gamRow.strip.innerHTML = b;
}

function draw(t) {
  probe = Number(pS.value);
  const d = probe / 100;
  const W = 600, H = 190, x0 = 40, y0 = 160, pw = W - x0 - 10, ph = 140;
  const X = (u) => x0 + u * pw, Y = (u) => y0 - u * ph;
  let curve = "", line = `M${X(0)} ${Y(0)} L${X(1)} ${Y(1)}`;
  for (let k = 0; k <= 200; k++) curve += (k ? " L" : "M") + X(k / 200).toFixed(1) + " " + Y(feels(k / 200)).toFixed(1);
  let grid = "";
  for (let k = 0; k <= 4; k++) {
    grid += `<line x1="${X(0)}" x2="${X(1)}" y1="${Y(k / 4)}" y2="${Y(k / 4)}" stroke="var(--background-modifier-border)"/>` +
      `<text x="${x0 - 4}" y="${Y(k / 4) + 3}" font-size="10" text-anchor="end" fill="var(--text-muted)">${k * 25}%</text>` +
      `<text x="${X(k / 4)}" y="${y0 + 14}" font-size="10" text-anchor="middle" fill="var(--text-muted)">${k * 25}%</text>`;
  }
  const f = feels(d);
  svgWrap.innerHTML = `<svg viewBox="0 0 ${W} ${H + 8}" width="100%">${grid}` +
    `<text x="${X(1)}" y="${y0 + 26}" font-size="10" text-anchor="end" fill="var(--text-muted)">duty cycle (real power) →</text>` +
    `<text x="${x0 + 4}" y="12" font-size="10" fill="var(--text-muted)">how bright it feels ↑</text>` +
    `<path d="${line}" stroke="var(--text-faint)" stroke-dasharray="5 4" fill="none"/>` +
    `<path d="${curve}" stroke="#e8590c" stroke-width="3" fill="none"/>` +
    `<line x1="${X(d)}" x2="${X(d)}" y1="${y0}" y2="${Y(f)}" stroke="#3b82f6" stroke-dasharray="3 3"/>` +
    `<line x1="${X(0)}" x2="${X(d)}" y1="${Y(f)}" y2="${Y(f)}" stroke="#3b82f6" stroke-dasharray="3 3"/>` +
    `<circle cx="${X(d)}" cy="${Y(f)}" r="5" fill="#3b82f6"/>` +
    (t != null ? `<line x1="${X(t)}" x2="${X(t)}" y1="${y0}" y2="${Y(1)}" stroke="#9c36b5" stroke-width="2" opacity=".6"/>` : "") +
    `</svg>`;
  const half = dutyFor(0.5) * 100;
  note.innerHTML = t != null
    ? `t = ${(t * SECS).toFixed(1)} s · linear: duty ${(t * 100).toFixed(0)}% feels ${(feels(t) * 100).toFixed(0)}% · gamma: duty ${(dutyFor(t) * 100).toFixed(1)}% feels ${(t * 100).toFixed(0)}%`
    : `duty <b>${probe.toFixed(1)}%</b> (analogWrite ${Math.round(d * 255)}) feels <b>${(f * 100).toFixed(0)}%</b> bright<br>` +
      `<span style="color:var(--text-muted)">to <i>feel</i> 50% you need only ≈${half.toFixed(1)}% duty (analogWrite ${Math.round(half * 2.55)})</span>`;
}

let busy = false;
playBtn.onclick = () => {
  if (busy) return;
  busy = true;
  const t0 = performance.now();
  const step = () => {
    if (!root.isConnected) return;
    const t = Math.min(1, (performance.now() - t0) / (SECS * 1000));
    linRow.led.style.background = light(t);
    linRow.led.style.boxShadow = `0 0 ${4 + 16 * srgb(t)}px ${light(t)}`;
    gamRow.led.style.background = light(dutyFor(t));
    gamRow.led.style.boxShadow = `0 0 ${4 + 16 * t}px ${light(dutyFor(t))}`;
    draw(t);
    if (t < 1) requestAnimationFrame(step);
    else { busy = false; draw(); }
  };
  requestAnimationFrame(step);
};
pS.oninput = () => { if (!busy) draw(); };

strips();
linRow.led.style.background = light(d0());
gamRow.led.style.background = light(dutyFor(d0()));
function d0() { return probe / 100; }
draw();
