// pwm-lab: PWM = fast ON/OFF with a variable duty cycle. Shows the waveform, its average line,
// the analogWrite value, what a DC multimeter reads, and an LED. At ≤10 Hz the LED really blinks
// (slow motion); at higher frequencies the screen shows the averaged glow your eye would see.
// input: { duty?: 0–100 % (default 25), value?: 0–255 analogWrite value (overrides duty),
//          speed?: "slow" (2 Hz, default) | "real" (490 Hz), hz?: any frequency in Hz (overrides speed),
//          vhigh?: HIGH voltage (default 5) }

const opts = (typeof input === "object" && input) || {};
const VH = Number(opts.vhigh) > 0 ? Number(opts.vhigh) : 5;
let value = opts.value != null ? Math.round(Number(opts.value)) : Math.round((Number(opts.duty ?? 25) / 100) * 255);
value = Math.max(0, Math.min(255, isFinite(value) ? value : 64));
const FREQS = [1, 2, 5, 10, 20, 50, 100, 490, 980, 1000];
let startHz = opts.hz != null ? Number(opts.hz) : opts.speed === "real" ? 490 : 2;
if (!(startHz > 0)) startHz = 2;
if (!FREQS.includes(startHz)) { FREQS.push(startHz); FREQS.sort((a, b) => a - b); }
const BLINK_MAX = 10;   // above this the screen can't honestly show the blinking
const FUSION = 60;      // rough flicker-fusion threshold (60–90 Hz)

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
function slider(label, min, max, v) {
  const row = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0;");
  el("span", "width:120px;", label, row);
  const s = el("input", "flex:1;min-width:140px;", null, row);
  s.type = "range"; s.min = min; s.max = max; s.step = 1; s.value = v;
  const out = el("b", "min-width:150px;font-family:var(--font-monospace);font-size:13px;", "", row);
  return { s, out };
}
const fmtMs = (ms) => (ms === 0 ? "0" : ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2)) + " ms";
const fmtHz = (f) => (f >= 1000 ? f / 1000 + " kHz" : f + " Hz");
// screen shows a light level y (0–1 of full power) as the matching sRGB brightness
const srgb = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
// CIE L*: how bright a light level feels (0–100)
const feels = (y) => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);

// ---------- UI ----------
const dutyS = slider("analogWrite", 0, 255, value);
const freqS = slider("Frequency", 0, FREQS.length - 1, FREQS.indexOf(startHz));
const svgWrap = el("div", "margin:6px 0;");
const row = el("div", "display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:6px;");
const ledBox = el("div", "width:54px;height:54px;border-radius:50%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;", null, row);
const led = el("div", "width:38px;height:38px;border-radius:50%;border:2px solid #555;", null, ledBox);
const meter = el("div", "font-family:var(--font-monospace);padding:6px 10px;border-radius:6px;background:#1f2a1f;color:#8ce99a;min-width:120px;text-align:center;", null, row);
const readout = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);flex:1;min-width:200px;", null, row);
const note = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);min-height:1.4em;");

const D = () => Number(dutyS.s.value) / 255;
const F = () => FREQS[Number(freqS.s.value)] || startHz;

let startT = performance.now();
function draw() {
  const v = Number(dutyS.s.value), d = D(), f = F(), T = 1000 / f;
  dutyS.out.textContent = `${v} → ${(d * 100).toFixed(1)}% duty`;
  freqS.out.textContent = f <= BLINK_MAX ? `${fmtHz(f)} (slow-mo)` : f === 490 ? "490 Hz (Uno)" : f === 980 ? "980 Hz (Uno pins 5, 6)" : fmtHz(f);
  meter.innerHTML = `<div style="font-size:10px;opacity:.8">DC multimeter</div><b style="font-size:18px">${(d * VH).toFixed(2)} V</b>`;
  readout.innerHTML =
    `analogWrite(pin, <b>${v}</b>) · D = ${v}/255 = <b>${(d * 100).toFixed(1)}%</b><br>` +
    `T = 1/${fmtHz(f)} = <b>${fmtMs(T)}</b> · on-time = <b>${fmtMs(d * T)}</b><br>` +
    `V_avg = ${(d * 100).toFixed(1)}% × ${VH} V = <b>${(d * VH).toFixed(2)} V</b>`;

  const W = 600, H = 120, top = 18, bot = 88, cycles = 4, P = W / cycles;
  let p = `M0 ${d >= 1 ? top : bot}`;
  for (let k = 0; k < cycles; k++) {
    if (d > 0 && d < 1) p += ` H${k * P} V${top} H${k * P + d * P} V${bot}`;
  }
  p += ` H${W}`;
  const avgY = bot - d * (bot - top);
  let ticks = "";
  for (let k = 0; k <= cycles; k++) ticks += `<line x1="${k * P}" x2="${k * P}" y1="${bot}" y2="${bot + 5}" stroke="var(--text-faint)"/>` +
    `<text x="${Math.min(W - 2, Math.max(2, k * P))}" y="${bot + 17}" font-size="10" text-anchor="${k === 0 ? "start" : k === cycles ? "end" : "middle"}" fill="var(--text-muted)">${fmtMs(k * T)}</text>`;
  svgWrap.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%">` +
    `<text x="2" y="${top - 5}" font-size="10" fill="var(--text-muted)">${VH} V</text>` +
    `<path d="${p}" fill="none" stroke="#3b82f6" stroke-width="3"/>` +
    `<line x1="0" x2="${W}" y1="${avgY}" y2="${avgY}" stroke="#2b8a3e" stroke-width="2" stroke-dasharray="6 4"/>` +
    `<text x="${W - 4}" y="${Math.max(avgY - 5, 12)}" text-anchor="end" font-size="11" fill="#2b8a3e">average ${(d * VH).toFixed(2)} V</text>` +
    ticks + `<line id="ph" x1="0" x2="0" y1="${top - 6}" y2="${bot}" stroke="#e8590c" stroke-width="2" opacity="0"/></svg>`;
}

function setLed(level, blink) {
  const k = srgb(level);
  led.style.background = `rgb(${Math.round(255 * k)},${Math.round(212 * k)},${Math.round(59 * k)})`;
  led.style.boxShadow = level > 0 ? `0 0 ${6 + 22 * k}px rgba(255,212,59,${(0.8 * k).toFixed(2)})` : "none";
  led.style.borderColor = blink ? "#888" : "#555";
}

let lastNote = "";
function tick() {
  if (!root.isConnected) return;
  const d = D(), f = F();
  const ph = svgWrap.querySelector && svgWrap.querySelector("#ph");
  let text;
  if (f <= BLINK_MAX) {
    const cyc = ((performance.now() - startT) / 1000) * f;
    const on = cyc % 1 < d;
    setLed(on ? 1 : 0, true);
    if (ph && ph.setAttribute) { ph.setAttribute("x1", ((cyc % 4) / 4) * 600); ph.setAttribute("x2", ((cyc % 4) / 4) * 600); ph.setAttribute("opacity", "1"); }
    text = `🐢 ${fmtHz(f)}: slow enough to see every pulse. The LED is <b>${on ? "fully ON 💡" : "fully OFF ⚫"}</b>, never in between. Drag the frequency up past ~60–90 Hz.`;
  } else {
    setLed(d, false);
    if (ph && ph.setAttribute) ph.setAttribute("opacity", "0");
    const per = Math.round(feels(d));
    text = f < FUSION
      ? `⚠️ ${fmtHz(f)} is below flicker fusion (~60–90 Hz): a real LED would visibly <b>flicker</b>. Fix: raise the frequency, not the duty.`
      : `👁️ Blinking ${f}×/s: too fast to see, your eye averages it → <b>${(d * 100).toFixed(1)}%</b> power, which <i>feels</i> about <b>${per}%</b> bright.`;
  }
  if (text !== lastNote) { note.innerHTML = text; lastNote = text; }
  requestAnimationFrame(tick);
}

dutyS.s.oninput = draw;
freqS.s.oninput = () => { startT = performance.now(); draw(); };
draw();
tick();
