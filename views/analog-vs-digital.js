// analog-vs-digital: why digital uses only a few (ideally 2) levels. Add noise to an analog wave and to a
// multi-level "digital" signal; the receiver snaps each symbol to the nearest allowed level. With 2 levels the
// noise has to be huge to flip a bit; with many levels (or analog) small noise already corrupts the value.
// input: { noise?: peak noise as a fraction of the 5 V swing, 0–1 = 0.2, levels?: 2–16 = 2,
//          ttl?: false (with 2 levels: use TTL input thresholds, ≤0.8 V = 0, ≥2.0 V = 1, between = "?") }

const opts = (typeof input === "object" && input) || {};
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));
let noise = clamp(opts.noise ?? 0.2, 0, 1);
let levels = Math.round(clamp(opts.levels ?? 2, 2, 16));
let ttl = !!opts.ttl;
let seed = 7;
const VMAX = 5, N = 16, SUB = 12;                    // 16 symbols, 12 samples drawn per symbol

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
const row1 = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;");
el("span", "", "Noise", row1);
const nIn = el("input", "flex:1;min-width:120px;", null, row1);
nIn.type = "range"; nIn.min = 0; nIn.max = 1; nIn.step = 0.05;
const nOut = el("b", "font-family:var(--font-monospace);width:70px;", "", row1);
const reroll = el("button", "", "🎲 New noise", row1);
const row2 = el("div", "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;");
el("span", "", "Levels:", row2);
const LV = [...new Set([2, 4, 10, levels])].sort((a, b) => a - b);
const lvBtns = LV.map((k) => { const b = el("button", "", String(k), row2); b.onclick = () => { levels = k; render(); }; return b; });
const ttlBtn = el("button", "", "", row2);
const aTitle = el("div", "font-weight:bold;", "〰️ Analog: every voltage is a valid value");
const aSvg = el("div", "");
const aStat = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);");
const dTitle = el("div", "font-weight:bold;margin-top:10px;", "");
const dSvg = el("div", "");
const decoded = el("div", "display:flex;gap:2px;flex-wrap:wrap;margin:4px 0;font-family:var(--font-monospace);font-size:12px;");
const note = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);");

// ---------- model ----------
function rng(s) { return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const W = 640, H = 150, X0 = 34, X1 = 632;
const Y = (v) => 130 - (clamp(v, -0.8, 5.8) / VMAX) * 110;
const X = (i) => X0 + (i / (N * SUB)) * (X1 - X0);
const lvV = (k) => (k * VMAX) / (levels - 1);
const f2 = (x) => x.toFixed(2);

function decode(v) {
  if (levels === 2 && ttl) return v >= 2.0 ? 1 : v <= 0.8 ? 0 : "?";
  return Math.round(clamp(v / (VMAX / (levels - 1)), 0, levels - 1));
}

function render() {
  nIn.value = noise;
  const peak = noise * VMAX;
  nOut.textContent = `±${f2(peak)} V`;
  lvBtns.forEach((b, i) => { const on = LV[i] === levels; b.style.background = on ? "var(--interactive-accent)" : ""; b.style.color = on ? "var(--text-on-accent)" : ""; });
  ttlBtn.style.display = levels === 2 ? "" : "none";
  ttlBtn.textContent = ttl ? "TTL thresholds: on" : "TTL thresholds: off";
  const R = rng(seed), symR = rng(seed + 99);
  const nz = () => (R() * 2 - 1) * peak;   // uniform in ±peak

  // analog: a smooth wave + the same kind of noise
  let pa = "", pn = "", errSum = 0;
  for (let i = 0; i <= N * SUB; i++) {
    const v = 2.5 + 2 * Math.sin((i / (N * SUB)) * Math.PI * 4);
    const e = nz(); errSum += Math.abs(e);
    pa += `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
    pn += `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v + e).toFixed(1)} `;
  }
  aSvg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif" font-size="10">` + axis() +
    `<path d="${pa}" fill="none" stroke="var(--text-faint)" stroke-width="2" stroke-dasharray="4 3"/>` +
    `<path d="${pn}" fill="none" stroke="#e8590c" stroke-width="1.5"/></svg>`;
  aStat.textContent = `sent (dashed) vs received (orange): average error ${f2(errSum / (N * SUB + 1))} V. Nothing tells the receiver which value was right.`;

  // digital: N symbols, each one of `levels` voltages
  const sym = Array.from({ length: N }, () => Math.floor(symR() * levels));
  const spacing = VMAX / (levels - 1);
  let lines = "", sent = "", recv = "", dots = "", wrong = 0, unsure = 0;
  for (let k = 0; k < levels; k++) lines += `<line x1="${X0}" y1="${Y(lvV(k))}" x2="${X1}" y2="${Y(lvV(k))}" stroke="var(--background-modifier-border)"/>`;
  if (levels === 2 && ttl) {
    lines += `<rect x="${X0}" y="${Y(2.0)}" width="${X1 - X0}" height="${Y(0.8) - Y(2.0)}" fill="#e8590c" opacity="0.13"/>` +
      `<text x="${X1 - 4}" y="${Y(1.4) + 3}" text-anchor="end" fill="#e8590c">no-man's land 0.8–2.0 V</text>`;
  } else {
    for (let k = 0; k < levels - 1; k++) lines += `<line x1="${X0}" y1="${Y(lvV(k) + spacing / 2)}" x2="${X1}" y2="${Y(lvV(k) + spacing / 2)}" stroke="var(--text-faint)" stroke-dasharray="3 4"/>`;
  }
  decoded.innerHTML = "";
  for (let s = 0; s < N; s++) {
    const v0 = lvV(sym[s]);
    for (let j = 0; j < SUB; j++) {
      const i = s * SUB + j, e = nz();
      sent += `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v0).toFixed(1)} L${X(i + 1).toFixed(1)} ${Y(v0).toFixed(1)} `;
      recv += `${i ? "L" : "M"}${X(i + 0.5).toFixed(1)} ${Y(v0 + e).toFixed(1)} `;
      if (j === SUB / 2) {
        const got = decode(v0 + e), ok = got === sym[s];
        if (got === "?") unsure++; else if (!ok) wrong++;
        dots += `<circle cx="${X(i + 0.5)}" cy="${Y(v0 + e)}" r="3.5" fill="${ok ? "#2b8a3e" : got === "?" ? "#e8590c" : "var(--text-error)"}"/>`;
        el("span", `width:32px;text-align:center;border-radius:4px;padding:1px 0;color:#fff;background:${ok ? "#2b8a3e" : got === "?" ? "#e8590c" : "var(--text-error)"};`,
          ok ? `${got}` : `${sym[s]}→${got}`, decoded);
      }
    }
  }
  dTitle.textContent = levels === 2 ? "⚡ Digital: only 2 levels (0 V = 0, 5 V = 1)" : `🪜 ${levels} levels, ${f2(spacing)} V apart`;
  dSvg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif" font-size="10">` + axis() + lines +
    `<path d="${sent}" fill="none" stroke="var(--text-faint)" stroke-width="2" stroke-dasharray="4 3"/>` +
    `<path d="${recv}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>` + dots + `</svg>`;

  const margin = spacing / 2;
  const verdict = wrong + unsure === 0 ? `all ${N} symbols read correctly ✅` : `${wrong} wrong${unsure ? `, ${unsure} unreadable (?)` : ""} out of ${N} ❌`;
  const tol = levels === 2 && ttl ? `TTL: a 0 survives noise up to <b>+0.80 V</b>, a 1 down to <b>−3.00 V</b>` : `Levels ${f2(spacing)} V apart → the reader tolerates about <b>±${f2(margin)} V</b> of noise`;
  note.innerHTML = `${tol}. Noise: up to <b>±${f2(peak)} V</b> → ${verdict}.` +
    (levels === 2 ? " Two far-apart levels = lots of room for noise." : " More levels = less room between them, so the same noise corrupts values.");
}
function axis() {
  return `<text x="${X0 - 4}" y="${Y(0) + 3}" text-anchor="end" fill="var(--text-muted)">0 V</text>` +
    `<text x="${X0 - 4}" y="${Y(VMAX) + 3}" text-anchor="end" fill="var(--text-muted)">5 V</text>`;
}

nIn.oninput = () => { noise = Number(nIn.value); render(); };
reroll.onclick = () => { seed = (seed * 31 + 17) % 100000; render(); };
ttlBtn.onclick = () => { ttl = !ttl; render(); };
render();
