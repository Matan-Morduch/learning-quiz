// analogwrite-counter: how analogWrite(pin, value) turns a number 0–255 into a duty cycle.
// An 8-bit timer counts 0 → 255 → 0 over and over; the pin is HIGH while the counter is below `value`.
// So the pin is HIGH for value/255 of the time. (This is "phase-correct PWM", used on most Uno PWM pins.)
// input: { value: 0–255 (default 64), vhigh: 5 }

const opts = (typeof input === "object" && input) || {};
const VHIGH = opts.vhigh ?? 5;
let value = Math.max(0, Math.min(255, Math.round(opts.value ?? 64)));

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

// ---------- controls ----------
const top = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;");
el("code", "", "analogWrite(9,", top);
const num = el("input", "width:64px;", null, top);
Object.assign(num, { type: "number", min: 0, max: 255, value });
el("code", "", ")", top);
const slider = el("input", "flex:1;min-width:140px;", null, top);
Object.assign(slider, { type: "range", min: 0, max: 255, step: 1, value });

const presets = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;");
el("span", "color:var(--text-muted);font-size:13px;align-self:center;", "I want:", presets);
for (const pct of [0, 25, 50, 75, 100]) {
  const b = el("button", "", `${pct}%`, presets);
  b.onclick = () => { explainTarget(pct); set(Math.round((pct / 100) * 255)); };
}

const bitsRow = el("div", "display:flex;gap:3px;align-items:center;margin:4px 0 8px;flex-wrap:wrap;");
const svgWrap = el("div", "");
const live = el("div", "font-family:var(--font-monospace);font-size:13px;min-height:1.4em;margin-top:4px;");
const math = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);line-height:1.6;");
let targetNote = "";

function explainTarget(pct) {
  const exact = (pct / 100) * 255;
  const rounded = Math.round(exact);
  targetNote = pct === 0 || pct === 100
    ? `Want ${pct}% → ${pct / 100} × 255 = <b>${rounded}</b> (exact, no rounding needed).`
    : `Want ${pct}% → ${pct / 100} × 255 = ${exact.toFixed(2)} → round to a whole number → <b>${rounded}</b>, ` +
      `which really gives ${rounded}/255 = ${((rounded / 255) * 100).toFixed(1)}%. Close enough: that's why answers say "≈".`;
}

function set(v) {
  value = Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
  num.value = value;
  slider.value = value;
  draw();
}
num.addEventListener("input", () => { targetNote = ""; set(num.value); });
slider.addEventListener("input", () => { targetNote = ""; set(slider.value); });

// ---------- drawing ----------
// Counter over one PWM period: phase 0 → 0.5 goes 0 → 255, phase 0.5 → 1 goes 255 → 0.
const counterAt = (phase) => (phase < 0.5 ? phase * 2 * 255 : (1 - phase) * 2 * 255);
const CYCLES = 2, W = 600, H = 250;
const cTop = 20, cBot = 130, oTop = 170, oBot = 225, x0 = 50, x1 = 590;
const yC = (c) => cBot - (c / 255) * (cBot - cTop);
let playPhase = 0; // 0..CYCLES, animated

function draw() {
  // 8-bit binary of the value (it's an 8-bit number!)
  const bin = value.toString(2).padStart(8, "0");
  bitsRow.innerHTML = `<span style="font-size:12px;color:var(--text-muted);margin-right:6px;">${value} in binary (8 bits):</span>` +
    [...bin].map((b, i) => `<span title="${2 ** (7 - i)}" style="display:inline-block;width:20px;text-align:center;border-radius:4px;font-family:var(--font-monospace);font-weight:bold;
      background:${b === "1" ? "var(--interactive-accent)" : "var(--background-secondary)"};color:${b === "1" ? "var(--text-on-accent)" : "var(--text-faint)"};">${b}</span>`).join("") +
    `<span style="font-size:12px;color:var(--text-muted);margin-left:6px;">max 11111111 = 255</span>`;

  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif" font-size="11">`;
  // high/low shading on the counter plot
  let counterPath = "", outPath = "", prevHigh = null;
  const steps = 600;
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * CYCLES, phase = t % 1 || (k === steps ? 1 : 0);
    const c = counterAt(phase);
    const x = x0 + (k / steps) * (x1 - x0);
    counterPath += `${k ? "L" : "M"}${x.toFixed(1)} ${yC(c).toFixed(1)} `;
    const high = value >= 255 ? true : c < value;
    const y = high ? oTop : oBot;
    if (prevHigh === null) outPath = `M${x} ${y}`;
    else if (high !== prevHigh) outPath += ` L${x} ${prevHigh ? oTop : oBot} L${x} ${y}`;
    prevHigh = high;
    if (k === steps) outPath += ` L${x} ${y}`;
  }
  // axes + labels
  s += `<text x="4" y="${cTop + 4}" fill="gray">255</text><text x="4" y="${cBot + 4}" fill="gray">0</text>`;
  s += `<text x="4" y="${(cTop + cBot) / 2}" fill="gray">counter</text>`;
  s += `<line x1="${x0}" y1="${cBot}" x2="${x1}" y2="${cBot}" stroke="var(--background-modifier-border)"/>`;
  // threshold = your value
  s += `<line x1="${x0}" y1="${yC(value)}" x2="${x1}" y2="${yC(value)}" stroke="#e8590c" stroke-width="2" stroke-dasharray="6 4"/>`;
  s += `<text x="${x1}" y="${yC(value) - 5}" text-anchor="end" fill="#e8590c" font-weight="bold">your value = ${value}</text>`;
  s += `<path d="${counterPath}" fill="none" stroke="#3b82f6" stroke-width="2"/>`;
  // output
  s += `<text x="4" y="${oTop + 4}" fill="gray">${VHIGH} V</text><text x="4" y="${oBot + 4}" fill="gray">0 V</text>`;
  s += `<text x="4" y="${(oTop + oBot) / 2 + 4}" fill="gray">pin</text>`;
  s += `<path d="${outPath}" fill="none" stroke="#2b8a3e" stroke-width="3"/>`;
  // playhead
  const px = x0 + (playPhase / CYCLES) * (x1 - x0);
  const pc = counterAt(playPhase % 1);
  const pHigh = value >= 255 ? true : pc < value;
  s += `<line x1="${px}" y1="${cTop - 6}" x2="${px}" y2="${oBot + 6}" stroke="var(--text-muted)" stroke-width="1"/>`;
  s += `<circle cx="${px}" cy="${yC(pc)}" r="5" fill="#3b82f6"/>`;
  s += `<circle cx="${px}" cy="${pHigh ? oTop : oBot}" r="5" fill="#2b8a3e"/>`;
  s += `<text x="${(x0 + x1) / 2}" y="${H - 4}" text-anchor="middle" fill="gray">${CYCLES} PWM periods (≈ ${(CYCLES * 2.04).toFixed(1)} ms at 490 Hz), slowed way down</text>`;
  s += `</svg>`;
  svgWrap.innerHTML = s;

  live.innerHTML = `counter = <b>${Math.round(pc)}</b> ${pHigh ? "&lt;" : "≥"} ${value} → pin <b style="color:${pHigh ? "#2b8a3e" : "var(--text-muted)"}">${pHigh ? "HIGH (5 V)" : "LOW (0 V)"}</b>`;

  const duty = value / 255;
  math.innerHTML =
    (targetNote ? `🎯 ${targetNote}<br>` : "") +
    `The pin is HIGH while the counter is below <b>${value}</b>, which is <b>${value} of every 255</b> steps.<br>` +
    `duty = value ÷ 255 = ${value} ÷ 255 = <b>${(duty * 100).toFixed(1)}%</b> · ` +
    `average = ${(duty * 100).toFixed(1)}% × ${VHIGH} V = <b>${(duty * VHIGH).toFixed(2)} V</b>` +
    (value === 0 ? "<br>0 → the counter is never below 0 → always LOW (0%)." : "") +
    (value === 255 ? "<br>255 → always HIGH (100%). (Arduino treats 255 as a plain digitalWrite HIGH.)" : "");
}

// ---------- animation: playhead crawls across 2 periods in ~8 s ----------
let last = null;
function frame(now) {
  if (!root.isConnected) return;
  if (last != null) playPhase = (playPhase + ((now - last) / 1000) * (CYCLES / 8)) % CYCLES;
  last = now;
  draw();
  requestAnimationFrame(frame);
}

draw();
requestAnimationFrame(frame);
