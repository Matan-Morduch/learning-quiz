// pulse-lab: the parts of a pulse train (amplitude, pulse width, period, frequency, duty cycle, edges).
// Sliders change the wave live, the focused component is highlighted and narrated with real numbers,
// an LED + cursor play the signal in real time (≤ 10 Hz). Data mode shows a non-periodic train.
// input: { focus?: "all"|"amplitude"|"width"|"period"|"frequency"|"duty"|"edges" = "all",
//          polarity?: "positive"|"negative" = "positive", mode?: "periodic"|"data" = "periodic",
//          f?: Hz 1–10 = 2, duty?: % 5–95 = 50, amplitude?: V 1–12 = 5 }

const opts = (typeof input === "object" && input) || {};
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));
const FOCI = ["all", "amplitude", "width", "period", "frequency", "duty", "edges"];
let focus = FOCI.includes(opts.focus) ? opts.focus : "all";
let polarity = opts.polarity === "negative" ? "negative" : "positive";
let mode = opts.mode === "data" ? "data" : "periodic";
let A = clamp(opts.amplitude ?? 5, 1, 12);
let T = 1000 / clamp(opts.f ?? 2, 1, 10);               // ms
let tw = T * clamp(opts.duty ?? 50, 5, 95) / 100;        // ms
let pair = focus === "width" || focus === "period" ? "time" : "freq";
let bits = [];
const WIN = 2000, PH = 250, BIT = 125;                    // window ms, first pulse starts at 250 ms, data bit time
const r1 = (x) => String(Math.round(x * 10) / 10);

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
function slider(label, min, max, step, unit) {
  const row = el("div", "display:flex;gap:8px;align-items:center;margin:3px 0;");
  el("span", "width:92px;flex-shrink:0;", label, row);
  const inp = el("input", "flex:1;min-width:80px;", null, row);
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step;
  const out = el("b", "width:70px;text-align:right;font-family:var(--font-monospace);", "", row);
  return { row, inp, out, unit };
}

// ---------- UI ----------
const btnRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const polBtn = el("button", "", "", btnRow);
const modeBtn = el("button", "", "", btnRow);
const pairBtn = el("button", "", "", btnRow);
const dataBtn = el("button", "", "🎲 New data", btnRow);
const aS = slider("Amplitude", 1, 12, 0.5, "V");
const fS = slider("Frequency", 1, 10, 0.5, "Hz");
const dS = slider("Duty cycle", 5, 95, 5, "%");
const TS = slider("Period T", 100, 1000, 50, "ms");
const wS = slider("Pulse width", 5, 950, 5, "ms");
const chips = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;font-family:var(--font-monospace);font-size:13px;");
const svgWrap = el("div", "");
const dutyBar = el("div", "display:flex;height:14px;border-radius:4px;overflow:hidden;margin:4px 0;font-size:10px;line-height:14px;color:#fff;text-align:center;");
const ledRow = el("div", "display:flex;align-items:center;gap:8px;margin-top:6px;");
const led = el("div", "width:18px;height:18px;border-radius:50%;border:2px solid var(--text-muted);", null, ledRow);
const ledText = el("span", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);", "", ledRow);
const note = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);min-height:1.4em;");

// ---------- model ----------
function newBits() {
  do { bits = Array.from({ length: WIN / BIT }, () => (Math.random() < 0.5 ? 1 : 0)); }
  while (bits.filter((b) => b).length < 5 || bits.filter((b) => !b).length < 5);
}
function intervals() {
  const out = [];
  if (mode === "data") {
    for (let i = 0; i < bits.length; i++) {
      if (!bits[i]) continue;
      let j = i; while (j < bits.length && bits[j]) j++;
      out.push([i * BIT, j * BIT]); i = j;
    }
  } else {
    for (let s = PH - Math.ceil(PH / T) * T; s < WIN; s += T) if (s + tw > 0) out.push([s, s + tw]);
  }
  return out;
}
const restV = () => (mode === "periodic" && polarity === "negative" ? A : 0);
const actV = () => (mode === "periodic" && polarity === "negative" ? 0 : A);

// ---------- drawing ----------
const W = 640, H = 232, X0 = 50, X1 = 630;
const X = (t) => X0 + (t / WIN) * (X1 - X0);
const Y = (v) => 170 - (v / 12) * 120;
const C = { amp: "#d6336c", width: "#e8590c", period: "#2b8a3e", freq: "#3b82f6", lead: "#9c36b5", trail: "#d6336c" };
const txt = (x, y, s, col, anchor = "middle", extra = "") =>
  `<text x="${x}" y="${y}" fill="${col}" text-anchor="${anchor}" font-size="11" font-weight="bold" ${extra}>${s}</text>`;
const bracket = (xa, xb, y, col) =>
  `<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" stroke="${col}" stroke-width="2"/>` +
  `<line x1="${xa}" y1="${y - 5}" x2="${xa}" y2="${y + 5}" stroke="${col}" stroke-width="2"/>` +
  `<line x1="${xb}" y1="${y - 5}" x2="${xb}" y2="${y + 5}" stroke="${col}" stroke-width="2"/>`;
const on = (k) => focus === k || (focus === "all" && k !== "frequency" && k !== "duty");

function draw() {
  const iv = intervals(), rest = restV(), act = actV();
  let d = `M${X0} ${Y(iv.length && iv[0][0] <= 0 ? act : rest)}`;
  for (const [a, b] of iv) {
    if (a > 0) d += ` H${X(a)} V${Y(act)}`;
    d += b < WIN ? ` H${X(b)} V${Y(rest)}` : ` H${X1}`;
  }
  d += ` H${X1}`;
  let s = "";
  const f = 1000 / T, top = Y(Math.max(rest, act));
  if (mode === "periodic") {
    const s1 = PH, e1 = PH + tw, s2 = PH + T;
    if (focus === "frequency") {
      s += `<rect x="${X(s1)}" y="28" width="${X(s1 + 1000) - X(s1)}" height="${Y(0) - 28}" fill="${C.freq}" opacity="0.12"/>`;
      s += txt((X(s1) + X(s1 + 1000)) / 2, 22, `1 second → ${r1(f)} cycles`, C.freq);
      for (let k = 0; (k + 1) * T <= 1000 + 1e-6; k++) s += txt(X(s1 + (k + 0.5) * T), Y(0) + 14, k + 1, C.freq);
    }
    if (focus === "duty") {
      s += `<rect x="${X(s1)}" y="${top}" width="${X(e1) - X(s1)}" height="${Y(0) - top}" fill="${C.width}" opacity="0.22"/>`;
      s += `<rect x="${X(e1)}" y="${top}" width="${X(s2) - X(e1)}" height="${Y(0) - top}" fill="gray" opacity="0.15"/>`;
      s += txt((X(s1) + X(e1)) / 2, top - 8, `pulse ${r1(tw)}`, C.width) + txt((X(e1) + X(s2)) / 2, top - 8, `rest ${r1(T - tw)}`, "gray");
    }
    if (on("width")) s += bracket(X(s1), X(e1), top - 10, C.width) + txt((X(s1) + X(e1)) / 2, top - 16, `tw = ${r1(tw)} ms`, C.width);
    if (on("period")) {
      s += `<line x1="${X(s2)}" y1="${Y(act)}" x2="${X(s2)}" y2="192" stroke="gray" stroke-dasharray="3 3"/>` +
           `<line x1="${X(s1)}" y1="${Y(act)}" x2="${X(s1)}" y2="192" stroke="gray" stroke-dasharray="3 3"/>`;
      s += bracket(X(s1), X(s2), 188, C.period) + txt((X(s1) + X(s2)) / 2, 204, `T = ${r1(T)} ms`, C.period);
    }
    if (on("amplitude")) {
      const ax = focus === "amplitude" ? X(s1 + tw / 2) : X1 - 8;
      s += `<line x1="${ax}" y1="${Y(A) + 2}" x2="${ax}" y2="${Y(0) - 2}" stroke="${C.amp}" stroke-width="2" marker-start="url(#pa)" marker-end="url(#pa)"/>`;
      s += txt(ax + 6, (Y(A) + Y(0)) / 2 + 4, `A = ${r1(A)} V`, C.amp, focus === "amplitude" ? "start" : "end", focus === "amplitude" ? "" : `dx="-10"`);
    }
    if (on("edges")) {
      const lead = polarity === "positive" ? "rising ↑" : "falling ↓", trail = polarity === "positive" ? "falling ↓" : "rising ↑";
      s += `<line x1="${X(s1)}" y1="${Y(0)}" x2="${X(s1)}" y2="${Y(A)}" stroke="${C.lead}" stroke-width="4"/>`;
      s += `<line x1="${X(e1)}" y1="${Y(0)}" x2="${X(e1)}" y2="${Y(A)}" stroke="${C.trail}" stroke-width="4"/>`;
      const my = (Y(0) + Y(A)) / 2;
      s += txt(X(s1) - 5, my - 2, "leading", C.lead, "end") + txt(X(s1) - 5, my + 11, "= " + lead, C.lead, "end");
      s += txt(X(e1) + 5, my - 2, "trailing", C.trail, "start") + txt(X(e1) + 5, my + 11, "= " + trail, C.trail, "start");
    }
  } else {
    bits.forEach((b, i) => { s += `<text x="${X((i + 0.5) * BIT)}" y="${Y(A) - 8}" font-size="11" text-anchor="middle" fill="var(--text-muted)">${b}</text>`; });
    if (focus === "width" || focus === "all") iv.forEach(([a, b]) => { s += txt((X(a) + X(b)) / 2, Y(0) + 14, b - a, C.width); });
  }
  let ticks = "";
  for (let t = 0; t <= WIN; t += 500) ticks += `<text x="${X(t)}" y="226" font-size="10" text-anchor="middle" fill="var(--text-muted)">${t} ms</text>`;
  svgWrap.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="sans-serif">` +
    `<defs><marker id="pa" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.amp}"/></marker></defs>` +
    `<line x1="${X0}" y1="${Y(0)}" x2="${X1}" y2="${Y(0)}" stroke="var(--background-modifier-border)"/>` +
    `<line x1="${X0}" y1="${Y(A)}" x2="${X1}" y2="${Y(A)}" stroke="var(--background-modifier-border)" stroke-dasharray="2 4"/>` +
    `<text x="${X0 - 6}" y="${Y(0) + 4}" font-size="10" text-anchor="end" fill="var(--text-muted)">0 V</text>` +
    `<text x="${X0 - 6}" y="${Y(A) + 4}" font-size="10" text-anchor="end" fill="var(--text-muted)">${r1(A)} V</text>` +
    `<path d="${d}" fill="none" stroke="var(--interactive-accent)" stroke-width="3"/>` + s + ticks +
    `<line class="cur" x1="${X0}" y1="26" x2="${X0}" y2="${Y(0)}" stroke="var(--text-faint)" stroke-width="1"/></svg>`;
  cursor = svgWrap.querySelector(".cur");
}

// ---------- readouts ----------
function render() {
  const f = 1000 / T, D = (tw / T) * 100, data = mode === "data";
  polBtn.textContent = polarity === "positive" ? "⬆️ Positive-going (rests LOW)" : "⬇️ Negative-going (rests HIGH)";
  polBtn.style.display = data ? "none" : "";
  modeBtn.textContent = data ? "📨 Data (non-periodic)" : "🫀 Clock (periodic)";
  pairBtn.textContent = pair === "freq" ? "⇄ set T & tw instead" : "⇄ set f & duty instead";
  pairBtn.style.display = data ? "none" : "";
  dataBtn.style.display = data ? "" : "none";
  fS.row.style.display = dS.row.style.display = !data && pair === "freq" ? "flex" : "none";
  TS.row.style.display = wS.row.style.display = !data && pair === "time" ? "flex" : "none";
  aS.inp.value = A; fS.inp.value = f; dS.inp.value = D; TS.inp.value = T; wS.inp.value = tw;
  aS.out.textContent = r1(A) + " V"; fS.out.textContent = r1(f) + " Hz"; dS.out.textContent = r1(D) + " %";
  TS.out.textContent = r1(T) + " ms"; wS.out.textContent = r1(tw) + " ms";

  const items = [["amplitude", `A = ${r1(A)} V`], ["width", `tw = ${data ? "varies" : r1(tw) + " ms"}`], ["period", `T = ${data ? "—" : r1(T) + " ms"}`],
    ["frequency", `f = ${data ? "—" : r1(f) + " Hz"}`], ["duty", `D = ${data ? "—" : r1(D) + "%"}`], ["edges", "edges"]];
  chips.innerHTML = "";
  for (const [k, label] of items) {
    const c = el("button", `padding:2px 8px;border-radius:12px;font-family:var(--font-monospace);font-size:12px;` +
      (focus === k ? "background:var(--interactive-accent);color:var(--text-on-accent);" : ""), label, chips);
    c.onclick = () => { focus = focus === k ? "all" : k; if (k === "width" || k === "period") pair = "time"; if (k === "frequency" || k === "duty") pair = "freq"; render(); };
  }
  dutyBar.style.display = !data && focus === "duty" ? "flex" : "none";
  dutyBar.innerHTML = `<div style="width:${D}%;background:${C.width};">${r1(D)}%</div><div style="width:${100 - D}%;background:gray;">${r1(100 - D)}%</div>`;
  draw();

  let n;
  if (data) {
    const widths = intervals().map(([a, b]) => b - a);
    n = `📨 Data bits <b>${bits.join("")}</b>: pulse widths ${widths.join(", ")} ms, gaps vary too. No repeating pattern → <b>no period T, no frequency f, no single duty cycle</b>.`;
  } else {
    const neg = polarity === "negative";
    n = {
      amplitude: `A = HIGH − LOW = ${r1(A)} V − 0 V = <b>${r1(A)} V</b>. Changing A never changes the timing (T, f, tw stay put).`,
      width: `tw = <b>${r1(tw)} ms</b>: from the leading edge to the trailing edge${neg ? " (here the pulse is the LOW dip)" : ""}.`,
      period: `T = on + off = ${r1(tw)} + ${r1(T - tw)} = <b>${r1(T)} ms</b>, from one leading edge to the next.`,
      frequency: `f = 1 / T = 1 / ${+(T / 1000).toPrecision(3)} s = <b>${r1(f)} Hz</b> → ${r1(f)} cycles fit in the shaded second.`,
      duty: `D = tw / T × 100% = ${r1(tw)} / ${r1(T)} = <b>${r1(D)}%</b>${Math.abs(D - 50) < 0.05 ? " → a <b>square wave</b> ⬜⬛" : ""}. Pulses per second still = f = ${r1(f)}.`,
      edges: neg ? `Negative-going: <b>leading edge = falling ↓</b>, trailing = rising ↑. Leading/trailing = time order, rising/falling = direction.`
                 : `Positive-going: <b>leading edge = rising ↑</b>, trailing = falling ↓. Flip the polarity to see them swap.`,
      all: `T = ${r1(T)} ms · f = 1/T = ${r1(f)} Hz · tw = ${r1(tw)} ms · D = ${r1(D)}% · A = ${r1(A)} V. Click a chip to zoom in on one.`,
    }[focus];
  }
  note.innerHTML = n;
}

// ---------- controls ----------
aS.inp.oninput = () => { A = Number(aS.inp.value); render(); };
fS.inp.oninput = () => { const D = tw / T; T = 1000 / Number(fS.inp.value); tw = D * T; render(); };
dS.inp.oninput = () => { tw = (Number(dS.inp.value) / 100) * T; render(); };
TS.inp.oninput = () => { T = Number(TS.inp.value); tw = Math.min(tw, 0.95 * T); render(); };
wS.inp.oninput = () => { tw = Math.min(Number(wS.inp.value), 0.95 * T); render(); };
polBtn.onclick = () => { polarity = polarity === "positive" ? "negative" : "positive"; render(); };
modeBtn.onclick = () => { mode = mode === "data" ? "periodic" : "data"; if (mode === "data" && !bits.length) newBits(); render(); };
pairBtn.onclick = () => { pair = pair === "freq" ? "time" : "freq"; render(); };
dataBtn.onclick = () => { newBits(); render(); };

// ---------- live playback: LED + cursor at real speed ----------
let cursor = null;
const t0 = performance.now();
const timer = setInterval(() => {
  if (!root.isConnected) return clearInterval(timer);
  const t = (performance.now() - t0) % WIN;
  const active = intervals().some(([a, b]) => t >= a && t < b);
  const v = active ? actV() : restV();
  led.style.background = v > 0 ? "#ffd43b" : "transparent";
  led.style.boxShadow = v > 0 ? "0 0 10px #ffd43b" : "none";
  ledText.textContent = `LED on the wire: ${v > 0 ? "HIGH (1)" : "LOW (0)"} · ${r1(v)} V`;
  if (cursor) { cursor.setAttribute("x1", X(t)); cursor.setAttribute("x2", X(t)); }
}, 20);

if (mode === "data") newBits();
render();
