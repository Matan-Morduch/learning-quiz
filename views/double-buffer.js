// double-buffer: why games draw into a hidden back buffer and swap.
// Left: single buffer. The game draws the next frame row by row straight into the screen's memory,
//       so every refresh in between shows a half-old, half-new (torn) picture.
// Right: double buffer. The game draws into the hidden back buffer; the screen shows the finished
//        front buffer; when the frame is done they swap. You only ever see complete frames.
// Opens mid-draw so the difference is visible immediately.
// input: { rows?: rows drawn per frame (4–10, default 6) }

const opts = (typeof input === "object" && input) || {};
const ROWS = Math.max(4, Math.min(10, Math.round(Number(opts.rows ?? 6)) || 6));
const COLS = 10;
const COLORS = ["#3b82f6", "#e8590c", "#2b8a3e", "#9c36b5", "#d6336c"];
const STEP_MS = 300;

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
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const playBtn = el("button", "", "▶ Play", controls);
const stepBtn = el("button", "", "➡ Draw one row", controls);
const resetBtn = el("button", "", "↺ Reset", controls);
const panes = el("div", "display:flex;gap:12px;flex-wrap:wrap;");
const left = el("div", "flex:1;min-width:150px;", null, panes);
const right = el("div", "flex:1;min-width:150px;", null, panes);
const narr = el("div", "margin-top:8px;font-family:var(--font-monospace);font-size:12px;min-height:1.4em;");
const score = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
// a frame k = background color COLORS[k % 5] + a white pole at column (2k mod COLS)
let frame, row, single, back, front, torn, shown, playing, timer;
const blank = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
function drawRow(buf, k, r) { for (let c = 0; c < COLS; c++) buf[r][c] = { k, pole: c === (2 * k) % COLS }; }
function fullFrame(k) { const b = blank(); for (let r = 0; r < ROWS; r++) drawRow(b, k, r); return b; }

function reset() {
  stop();
  frame = 1; row = 0; torn = 0; shown = 0;
  single = fullFrame(0); front = fullFrame(0); back = fullFrame(0);
  const half = Math.floor(ROWS / 2);
  for (let i = 0; i < half; i++) advance(true);   // open mid-draw
  narr.textContent = `drawing frame ${frame}: ${row}/${ROWS} rows done. Left shows it half-drawn, right still shows frame ${frame - 1}.`;
  render();
}

function framesIn(buf) { return new Set(buf.flat().map((p) => p.k)); }

// one step: the game draws one row of the current frame; the screen refreshes once
function advance(silent = false) {
  drawRow(single, frame, row);   // straight into what the screen shows
  drawRow(back, frame, row);     // into the hidden buffer
  row++;
  let msg = `frame ${frame}: drew row ${row}/${ROWS}`;
  if (row === ROWS) {
    const t = front; front = back; back = t;   // swap: pointer flip, no copying
    msg += ` → frame done: SWAP front ⇄ back`;
    frame++; row = 0;
  }
  shown++;
  if (framesIn(single).size > 1) { torn++; msg += ` · left refresh shows 2 frames at once (torn)`; }
  if (!silent) narr.textContent = msg;
}

function grid(buf, title, border) {
  const W = COLS * 12, H = ROWS * 12;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:260px;display:block;border:3px solid ${border};border-radius:6px;">`;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const p = buf[r][c];
    s += `<rect x="${c * 12}" y="${r * 12}" width="12" height="12" fill="${p.pole ? "#ffffff" : COLORS[p.k % COLORS.length]}"/>`;
  }
  return `<div style="font-size:12px;margin:4px 0;">${title}</div>` + s + "</svg>";
}
function render() {
  const fl = [...framesIn(single)].sort((a, b) => a - b);
  left.innerHTML = `<b>1️⃣ Single buffer</b>` +
    grid(single, `🖥 screen = the buffer being drawn · shows frame ${fl.join(" + ")}`, fl.length > 1 ? "var(--text-error)" : "#2b8a3e");
  right.innerHTML = `<b>2️⃣ Double buffer</b>` +
    grid(front, `🖥 screen = front buffer · shows frame ${[...framesIn(front)].join("")}`, "#2b8a3e") +
    `<div style="opacity:0.55;max-width:130px;">` + grid(back, `🙈 back buffer (hidden): ${row}/${ROWS} rows`, "var(--background-modifier-border)") + `</div>`;
  score.innerHTML = `screen refreshes so far: <b>${shown}</b> · half-drawn (torn) frames seen: <b style="color:var(--text-error)">left ${torn}</b> vs <b style="color:#2b8a3e">right 0</b>`;
}

function tick() {
  timer = null;
  if (!root.isConnected || !playing) return;
  advance(); render();
  timer = setTimeout(tick, STEP_MS);
}
function stop() { playing = false; if (timer) clearTimeout(timer); timer = null; playBtn.textContent = "▶ Play"; }

playBtn.onclick = () => {
  if (playing) { stop(); return; }
  playing = true; playBtn.textContent = "⏸ Pause";
  timer = setTimeout(tick, STEP_MS);
};
stepBtn.onclick = () => { if (!playing) { advance(); render(); } };
resetBtn.onclick = reset;

playing = false; timer = null;
reset();
