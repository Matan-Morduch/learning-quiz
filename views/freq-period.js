// freq-period: f ⟷ T converter with real units (Hz/kHz/MHz/GHz ⟷ s/ms/µs/ns), plus duty cycle ⟷ pulse width.
// Type in any field and the others update, with the worked formula shown in powers of ten and the
// "kilo ↔ milli, mega ↔ micro, giga ↔ nano" unit pair highlighted.
// input: { f?: frequency in Hz = 1000, T?: period in seconds (overrides f), duty?: % = 50,
//          tw?: pulse width in seconds (overrides duty) }

const opts = (typeof input === "object" && input) || {};
const pos = (x) => typeof x === "number" && isFinite(x) && x > 0;
let T = pos(opts.T) ? opts.T : 1 / (pos(opts.f) ? opts.f : 1000);   // seconds
let D = pos(opts.tw) ? Math.min(100, (opts.tw / T) * 100) : Math.min(100, pos(opts.duty) ? opts.duty : 50);
const FU = [["GHz", 1e9], ["MHz", 1e6], ["kHz", 1e3], ["Hz", 1]];
const TU = [["s", 1], ["ms", 1e-3], ["µs", 1e-6], ["ns", 1e-9], ["ps", 1e-12]];
const PAIRS = [["Hz", "s"], ["kHz", "ms"], ["MHz", "µs"], ["GHz", "ns"]];
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

const num = (x) => String(Number(x.toPrecision(4)));
const best = (x, units) => units.find(([, m]) => x / m >= 0.9999) || units[units.length - 1];
const fmt = (x, units) => { const [u, m] = best(x, units); return `${num(x / m)} ${u}`; };
function sci(x) {
  const [m, e] = x.toExponential(3).split("e");
  const ex = String(Number(e)).split("").map((c) => SUP[c]).join("");
  return Number(e) === 0 ? num(Number(m)) : `${num(Number(m))} × 10${ex}`;
}

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
function field(label, units) {
  const row = el("div", "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:3px 0;");
  el("span", "width:92px;", label, row);
  const inp = el("input", "width:100px;font-family:var(--font-monospace);", null, row);
  inp.type = "number"; inp.step = "any"; inp.min = "0";
  let sel = null;
  if (units) { sel = el("select", "", null, row); for (const [u] of units) { const o = el("option", "", u, sel); o.value = u; } }
  return { row, inp, sel };
}

// ---------- UI ----------
const presets = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
for (const [label, f] of [["1 Hz", 1], ["1 kHz", 1e3], ["1 MHz", 1e6], ["1 GHz", 1e9], ["3 GHz CPU", 3e9]]) {
  const b = el("button", "", label, presets); b.onclick = () => { T = 1 / f; sync(); };
}
const fF = field("Frequency f", FU);
const tF = field("Period T", TU);
const dF = field("Duty cycle %", null);
const wF = field("Pulse width tw", TU);
const pairRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;font-family:var(--font-monospace);font-size:12px;");
const work = el("div", "font-family:var(--font-monospace);font-size:13px;padding:8px;border-radius:6px;background:var(--background-secondary);line-height:1.6;");
const svgWrap = el("div", "margin-top:6px;");

// ---------- sync ----------
function put(fieldObj, x, units) { const [u, m] = best(x, units); fieldObj.inp.value = num(x / m); fieldObj.sel.value = u; }
function sync(except) {
  const f = 1 / T, tw = (D / 100) * T;
  if (except !== "f") put(fF, f, FU);
  if (except !== "T") put(tF, T, TU);
  if (except !== "D") dF.inp.value = num(D);
  if (except !== "tw") put(wF, tw, TU);
  render();
}
const mult = (units, u) => (units.find(([n]) => n === u) || units[0])[1];
function readF() { const x = Number(fF.inp.value) * mult(FU, fF.sel.value); if (pos(x)) { T = 1 / x; sync("f"); } }
function readT() { const x = Number(tF.inp.value) * mult(TU, tF.sel.value); if (pos(x)) { T = x; sync("T"); } }
function readD() { const x = Number(dF.inp.value); if (x >= 0 && x <= 100) { D = x; sync("D"); } }
function readW() { const x = Number(wF.inp.value) * mult(TU, wF.sel.value); if (x >= 0) { D = Math.min(100, (x / T) * 100); sync("tw"); if (x > T) work.innerHTML += `<br><span style="color:var(--text-error)">tw can't be longer than T: clamped to 100%.</span>`; } }
fF.inp.oninput = fF.sel.onchange = readF;
tF.inp.oninput = tF.sel.onchange = readT;
dF.inp.oninput = readD;
wF.inp.oninput = wF.sel.onchange = readW;

// ---------- render ----------
function render() {
  const f = 1 / T, tw = (D / 100) * T;
  const fu = best(f, FU)[0], tu = best(T, TU)[0];
  pairRow.innerHTML = "";
  for (const [a, b] of PAIRS) {
    const hit = a === fu && b === tu;
    el("span", `padding:2px 8px;border-radius:12px;border:1px solid var(--background-modifier-border);` +
      (hit ? "background:var(--interactive-accent);color:var(--text-on-accent);" : ""), `1 ${a} ⟷ 1 ${b}`, pairRow);
  }
  work.innerHTML =
    `T = 1 / f = 1 / (${sci(f)} Hz) = ${sci(T)} s = <b>${fmt(T, TU)}</b><br>` +
    `f = 1 / T = 1 / (${sci(T)} s) = <b>${fmt(f, FU)}</b><br>` +
    `tw = D × T = ${num(D)}% × ${fmt(T, TU)} = <b>${fmt(tw || 0, TU).replace(/^0 ps$/, "0 s")}</b> · off = ${fmt(Math.max(T - tw, 0) || 0, TU).replace(/^0 ps$/, "0 s")}` +
    (Math.abs(D - 50) < 1e-9 ? " · 50% = <b>square wave</b>" : "") +
    (f >= 1e9 ? `<br>In one period light travels only ${num(3e8 * T * 100)} cm.` : "");

  // three periods of the wave
  const Wd = 640, Hd = 108, x0 = 20, x1 = 620, P = (x1 - x0) / 3, hi = 22, lo = 70, pw = (D / 100) * P;
  let d = `M${x0} ${lo}`;
  for (let k = 0; k < 3; k++) { const a = x0 + k * P; d += ` H${a} V${hi} H${a + pw} V${lo}`; }
  d += ` H${x1}`;
  const br = (a, b, y, c, s) => `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" stroke="${c}" stroke-width="2"/><line x1="${a}" y1="${y - 4}" x2="${a}" y2="${y + 4}" stroke="${c}" stroke-width="2"/><line x1="${b}" y1="${y - 4}" x2="${b}" y2="${y + 4}" stroke="${c}" stroke-width="2"/>` +
    `<text x="${(a + b) / 2}" y="${y - 5}" text-anchor="middle" font-size="11" font-weight="bold" fill="${c}">${s}</text>`;
  svgWrap.innerHTML = `<svg viewBox="0 0 ${Wd} ${Hd}" width="100%" font-family="sans-serif">` +
    `<path d="${d}" fill="none" stroke="var(--interactive-accent)" stroke-width="3"/>` +
    br(x0 + P, x0 + P + pw, hi - 6, "#e8590c", "tw = " + fmt(tw || 0, TU).replace(/^0 ps$/, "0 s")) + br(x0 + P, x0 + 2 * P, lo + 16, "#2b8a3e", "") +
    `<text x="${x0 + 1.5 * P}" y="${lo + 25}" text-anchor="middle" font-size="11" font-weight="bold" fill="#2b8a3e" dy="4">T = ${fmt(T, TU)}</text></svg>`;
}

sync();
