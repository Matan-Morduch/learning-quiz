// phantom-array: flick your eyes past a PWM-dimmed LED in the dark and the light lands on a
// different spot of your retina for each ON pulse → a row of dots. A DC (steady) LED paints a
// continuous smear. Dots in one sweep ≈ frequency × sweep time.
// input: { hz?: PWM frequency (default 490), duty?: 1–100 % (default 25), sweep?: eye-sweep time in ms (default 40) }

const opts = (typeof input === "object" && input) || {};
const FREQS = [100, 490, 980, 5000];
let hz = Number(opts.hz) > 0 ? Number(opts.hz) : 490;
if (!FREQS.includes(hz)) { FREQS.push(hz); FREQS.sort((a, b) => a - b); }
let duty = Math.max(1, Math.min(100, Number(opts.duty ?? 25) || 25));
const SWEEP = Math.max(10, Math.min(200, Number(opts.sweep) || 40)); // ms
const SLOW = 25; // replay the sweep 25× slower so you can watch it

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
const sweepBtn = el("button", "", "👀 Flick eyes", controls);
const fBtns = FREQS.map((f) => {
  const b = el("button", "", f >= 1000 ? f / 1000 + " kHz" : f + " Hz", controls);
  b.onclick = () => { if (!busy) { hz = f; draw(1); } };
  return b;
});
const dRow = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;");
el("span", "width:80px;", "PWM duty", dRow);
const dS = el("input", "flex:1;min-width:160px;", null, dRow);
dS.type = "range"; dS.min = 1; dS.max = 100; dS.step = 1; dS.value = duty;
const dOut = el("b", "min-width:50px;font-family:var(--font-monospace);", "", dRow);
const svgWrap = el("div", "margin-top:8px;");
const note = el("div", "margin-top:6px;font-family:var(--font-monospace);font-size:13px;min-height:2.8em;");

const W = 600, X0 = 90, X1 = 590;
function trail(y, segs, prog, fill) {
  // segs: [start, end] as fractions of the sweep; draw only what's happened by `prog`
  let h = "";
  for (const [a, b] of segs) {
    if (a >= prog) break;
    const e = Math.min(b, prog);
    const x = X0 + a * (X1 - X0), w = Math.max(1.5, (e - a) * (X1 - X0));
    h += `<rect x="${x.toFixed(1)}" y="${y - 7}" width="${w.toFixed(1)}" height="14" rx="4" fill="${fill}" filter="url(#glow)"/>`;
  }
  return h;
}

let phase = 0.37; // where in its cycle the PWM was when the sweep started
function pwmSegs() {
  const n = (hz * SWEEP) / 1000, d = duty / 100, segs = [];
  for (let k = -1; k < n + 1; k++) {
    const a = (k + phase) / n, b = (k + phase + d) / n;
    if (b <= 0 || a >= 1) continue;
    segs.push([Math.max(0, a), Math.min(1, b)]);
  }
  return segs;
}

function draw(prog) {
  duty = Number(dS.value);
  dOut.textContent = duty + "%";
  fBtns.forEach((b, i) => (b.style.fontWeight = FREQS[i] === hz ? "bold" : "normal"));
  const segs = pwmSegs();
  const eyeX = X0 + prog * (X1 - X0);
  svgWrap.innerHTML = `<svg viewBox="0 0 ${W} 120" width="100%" style="background:#0b0b10;border-radius:8px;">` +
    `<defs><filter id="glow"><feGaussianBlur stdDeviation="1.6"/></filter></defs>` +
    `<text x="8" y="38" font-size="11" fill="#bbb">DC LED</text>` +
    `<text x="8" y="88" font-size="11" fill="#bbb">PWM LED</text>` +
    trail(35, [[0, 1]], prog, "rgba(255,212,59,0.55)") +
    trail(85, segs, prog, "rgb(255,212,59)") +
    (prog < 1 ? `<text x="${eyeX}" y="112" font-size="14" text-anchor="middle">👁️</text>` : "") +
    `</svg>`;
  const n = (hz * SWEEP) / 1000;
  const period = 1000 / hz;
  note.innerHTML = `eye sweep ${SWEEP} ms × ${hz} Hz ≈ <b>${n.toFixed(n < 10 ? 1 : 0)} dots</b> (one per ON pulse, every ${period < 1 ? period.toFixed(2) : period.toFixed(1)} ms)<br>` +
    `<span style="color:var(--text-muted)">${n > 100 ? "so many dots they blur into a smear: high-frequency PWM is hard to catch" : "each dot = one ON pulse; the gaps = OFF time"}</span>`;
}

let busy = false;
sweepBtn.onclick = () => {
  if (busy) return;
  busy = true;
  phase = Math.random();
  const t0 = performance.now(), dur = SWEEP * SLOW;
  const step = () => {
    if (!root.isConnected) return;
    const p = Math.min(1, (performance.now() - t0) / dur);
    draw(p);
    note.innerHTML = p < 1 ? `replaying the ${SWEEP} ms sweep ${SLOW}× slower… t = ${(p * SWEEP).toFixed(1)} ms` : note.innerHTML;
    if (p < 1) requestAnimationFrame(step);
    else { busy = false; draw(1); }
  };
  requestAnimationFrame(step);
};
dS.oninput = () => { if (!busy) draw(1); };
draw(1);
