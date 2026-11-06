// binary-counter: count up in binary and draw each bit's history as a pulse train.
// The LSB flips every count, bit 1 every 2, bit 2 every 4… each bit is a square wave at half the
// frequency of the one below it, so a counter is a frequency divider.
// input: { bits?: 2–6 (default 4), rate?: counts per second 1–5 (default 2) }

const opts = (typeof input === "object" && input) || {};
const BITS = Math.max(2, Math.min(6, Math.floor(Number(opts.bits)) || 4));
let rate = Math.max(1, Math.min(5, Math.floor(Number(opts.rate)) || 2));
const MOD = 2 ** BITS;
const W = Math.min(MOD, 32); // counts visible in the history window
const COLORS = ["#3b82f6", "#2b8a3e", "#e8590c", "#9c36b5", "#d6336c", "#3b82f6"];

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

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;");
const stepBtn = el("button", "", "+1 count", controls);
const playBtn = el("button", "", "", controls);
const rateBtn = el("button", "", "", controls);
const resetBtn = el("button", "", "↺ Clear", controls);

const leds = el("div", "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;");
const svgBox = el("div", "");
const note = el("div", "margin-top:6px;padding:6px 8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;min-height:1.4em;");
const freq = el("div", "margin-top:6px;font-size:12px;color:var(--text-muted);");

// start with one full cycle already drawn, so the pattern is visible immediately
let history = [], count = 0, timer = null, msg = "";
for (let v = 0; v < W; v++) history.push(v);
count = W - 1;

function draw() {
  let h = `<b style="margin-right:4px;">count ${count}</b>`;
  for (let k = BITS - 1; k >= 0; k--) {
    const on = (count >> k) & 1;
    h += `<div style="text-align:center;"><div style="width:26px;height:26px;border-radius:50%;margin:auto;
      background:${on ? COLORS[k] : "transparent"};border:2px solid ${COLORS[k]};box-shadow:${on ? `0 0 8px ${COLORS[k]}` : "none"};"></div>
      <div style="font-size:10px;color:var(--text-muted);">bit ${k}</div></div>`;
  }
  h += `<span style="font-family:var(--font-monospace);font-size:16px;margin-left:6px;">${count.toString(2).padStart(BITS, "0")}₂</span>`;
  leds.innerHTML = h;

  const X0 = 78, X1 = 712, cw = (X1 - X0) / W, rowH = 40, top = 22, amp = 26;
  const H = top + BITS * rowH + 8;
  let s = `<svg viewBox="0 0 720 ${H}" width="100%" style="max-width:720px;display:block;" font-family="sans-serif" font-size="11">`;
  const n = history.length;
  for (let j = 0; j < n; j++) {
    const x = X0 + j * cw;
    if (j === n - 1) s += `<rect x="${x}" y="${top - 2}" width="${cw}" height="${BITS * rowH}" fill="#e8590c" fill-opacity="0.15"/>`;
    if (W <= 16 || j % 2 === 0) s += `<text x="${x + cw / 2}" y="14" text-anchor="middle" fill="gray">${history[j]}</text>`;
  }
  for (let k = 0; k < BITS; k++) {
    const yBase = top + k * rowH + rowH - 6, yHigh = yBase - amp;
    s += `<text x="4" y="${yBase - 8}" font-weight="bold" fill="${COLORS[k]}">bit ${k} (${2 ** k})</text>`;
    s += `<line x1="${X0}" y1="${yBase}" x2="${X1}" y2="${yBase}" stroke="gray" stroke-opacity="0.25"/>`;
    if (!n) continue;
    const lvl = (v) => ((v >> k) & 1 ? yHigh : yBase);
    let d = `M${X0} ${lvl(history[0])}`;
    for (let j = 1; j < n; j++) {
      const x = X0 + j * cw, y0 = lvl(history[j - 1]), y1 = lvl(history[j]);
      if (y0 !== y1) d += ` H${x.toFixed(1)} V${y1}`;
    }
    d += ` H${(X0 + n * cw).toFixed(1)}`;
    s += `<path d="${d}" fill="none" stroke="${COLORS[k]}" stroke-width="2.5"/>`;
  }
  s += `</svg>`;
  svgBox.innerHTML = s;

  note.textContent = msg || `each bit flips half as often as the one below it · press Play`;
  playBtn.textContent = timer ? "⏸ Pause" : "▶ Play";
  rateBtn.textContent = `speed: ${rate}/s`;
  let f = `If the count ticks at 1 kHz: `;
  for (let k = 0; k < BITS; k++) f += `bit ${k} = ${fmtHz(1000 / 2 ** (k + 1))}${k < BITS - 1 ? ", " : ""}`;
  freq.textContent = f + ` (bit k flips every 2^k counts, so its period is 2^(k+1) counts).`;
}
function fmtHz(hz) { return hz >= 1 ? `${+hz.toFixed(2)} Hz` : `${+(hz).toFixed(3)} Hz`; }

function tick() {
  const prev = count;
  count = (count + 1) % MOD;
  history.push(count);
  if (history.length > W) history.shift();
  const changed = prev ^ count, flips = [];
  for (let k = 0; k < BITS; k++) if ((changed >> k) & 1) flips.push(k);
  msg = count === 0
    ? `${prev} + 1 = ${MOD} needs ${BITS + 1} bits → wraps to 0 · flipped: ${flips.map((k) => "bit " + k).join(", ")}`
    : `${prev} → ${count}: flipped ${flips.map((k) => "bit " + k).join(", ")}` +
      (flips.length > 1 ? ` (the carry rippled through ${flips.length} bits)` : "");
  draw();
}
function stop() { if (timer) clearInterval(timer); timer = null; draw(); }
function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); timer = null; return; }
    tick();
  }, 1000 / rate);
  draw();
}
stepBtn.onclick = () => { if (!timer) tick(); };
playBtn.onclick = () => (timer ? stop() : start());
rateBtn.onclick = () => { rate = rate === 1 ? 2 : rate === 2 ? 5 : 1; if (timer) start(); else draw(); };
resetBtn.onclick = () => { stop(); history = [0]; count = 0; msg = "cleared: counting from 0"; draw(); };
draw();
