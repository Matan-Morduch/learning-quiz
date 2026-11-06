// servo-pwm: a hobby servo reads the pulse WIDTH of a 50 Hz signal (one frame = 20 ms).
// Typical: about 1 ms → 0°, 1.5 ms → 90°, 2 ms → 180° (exact limits vary by servo).
// input: { pw?: pulse width in ms, 1–2 (default 1.5) }

const opts = (typeof input === "object" && input) || {};
const clampPw = (x) => Math.max(1, Math.min(2, Number(x) || 1.5));
let pw = clampPw(opts.pw ?? 1.5);
const FRAME = 20; // ms

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
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;");
const presets = [1, 1.5, 2].map((v) => el("button", "", `${v} ms`, controls));
const s = el("input", "flex:1;min-width:160px;", null, controls);
s.type = "range"; s.min = 1; s.max = 2; s.step = 0.01; s.value = pw;
const wave = el("div", "margin:4px 0;");
const row = el("div", "display:flex;gap:14px;align-items:center;flex-wrap:wrap;");
const servoWrap = el("div", "width:170px;flex-shrink:0;", null, row);
const note = el("div", "flex:1;min-width:200px;font-family:var(--font-monospace);font-size:13px;line-height:1.6;", null, row);

const target = () => (clampPw(s.value) - 1) * 180;
let shown = target();

function drawServo(angle) {
  // angle 0° points left, 90° up, 180° right
  const a = Math.PI - (angle * Math.PI) / 180, cx = 85, cy = 90, L = 60;
  const x = cx + L * Math.cos(a), y = cy - L * Math.sin(a);
  let ticks = "";
  for (const t of [0, 45, 90, 135, 180]) {
    const r = Math.PI - (t * Math.PI) / 180;
    ticks += `<text x="${cx + 76 * Math.cos(r)}" y="${cy - 76 * Math.sin(r) + 4}" font-size="10" text-anchor="middle" fill="var(--text-muted)">${t}°</text>`;
  }
  servoWrap.innerHTML = `<svg viewBox="0 0 170 110" width="100%">` +
    `<path d="M${cx - 66} ${cy} A66 66 0 0 1 ${cx + 66} ${cy}" fill="none" stroke="var(--background-modifier-border)" stroke-width="2"/>${ticks}` +
    `<rect x="${cx - 30}" y="${cy - 8}" width="60" height="22" rx="4" fill="#3b82f6" opacity=".85"/>` +
    `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e8590c" stroke-width="8" stroke-linecap="round"/>` +
    `<circle cx="${cx}" cy="${cy}" r="7" fill="var(--text-normal)"/></svg>`;
}

function draw() {
  pw = clampPw(s.value);
  presets.forEach((b, i) => (b.style.fontWeight = Math.abs([1, 1.5, 2][i] - pw) < 0.005 ? "bold" : "normal"));
  const W = 600, H = 80, top = 12, bot = 58, frames = 2, P = W / frames, px = (ms) => (ms / FRAME) * P;
  let p = `M0 ${bot}`;
  for (let k = 0; k < frames; k++) p += ` H${k * P} V${top} H${k * P + px(pw)} V${bot}`;
  p += ` H${W}`;
  wave.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">` +
    `<path d="${p}" fill="none" stroke="#3b82f6" stroke-width="3"/>` +
    `<line x1="${px(pw) + 4}" x2="${P - 4}" y1="${bot + 10}" y2="${bot + 10}" stroke="var(--text-faint)"/>` +
    `<text x="${P / 2 + 10}" y="${bot + 22}" font-size="10" text-anchor="middle" fill="var(--text-muted)">rest of the 20 ms frame (LOW)</text>` +
    `<text x="${px(pw) + 6}" y="${top + 10}" font-size="11" fill="#e8590c">${pw.toFixed(2)} ms</text>` +
    `<text x="${W - 2}" y="${top + 10}" font-size="10" text-anchor="end" fill="var(--text-muted)">50 frames/s</text></svg>`;
  const ang = target();
  note.innerHTML = `pulse <b>${pw.toFixed(2)} ms</b> every ${FRAME} ms (50 Hz)<br>` +
    `duty = ${pw.toFixed(2)} / ${FRAME} = ${((pw / FRAME) * 100).toFixed(1)}%<br>` +
    `angle ≈ (${pw.toFixed(2)} − 1) × 180° = <b>about ${ang.toFixed(0)}°</b><br>` +
    `<span style="color:var(--text-muted)">the servo times the pulse <i>width</i>; it doesn't average it</span>`;
}

let moving = false;
function animate() {
  if (!root.isConnected) { moving = false; return; }
  const t = target(), diff = t - shown;
  shown = Math.abs(diff) < 0.5 ? t : shown + Math.sign(diff) * Math.min(Math.abs(diff), 4); // ~240°/s
  drawServo(shown);
  if (shown !== t) requestAnimationFrame(animate); else moving = false;
}
s.oninput = () => { draw(); if (!moving) { moving = true; requestAnimationFrame(animate); } };
presets.forEach((b, i) => (b.onclick = () => { s.value = [1, 1.5, 2][i]; s.oninput(); }));

draw();
drawServo(shown);
