// dimming-efficiency: linear dimming (a rheostat in series) vs PWM (a switch that is fully ON or OFF).
// Lamp/heater mode: 12 V, 12 Ω load. The rheostat burns the voltage it drops as heat; an ideal
// PWM switch wastes ~0. LED mode: a small LED always needs its current-limiting resistor, so the
// resistor's share of the power is about the same either way (PWM's big win is for bigger loads).
// input: { load?: "lamp" (default) | "led", level?: 0–100 % of full power/brightness (default 50) }

const opts = (typeof input === "object" && input) || {};
let load = opts.load === "led" ? "led" : "lamp";
let level = Math.max(1, Math.min(100, Number(opts.level ?? 50) || 50));

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
const w = (p) => (p >= 1 ? p.toFixed(2) + " W" : (p * 1000).toFixed(0) + " mW");

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;");
const lampBtn = el("button", "", "💡 12 V lamp/heater (12 Ω)", controls);
const ledBtn = el("button", "", "🔴 small LED (5 V, 150 Ω)", controls);
const sRow = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;");
el("span", "width:110px;", "Dim to", sRow);
const s = el("input", "flex:1;min-width:160px;", null, sRow);
s.type = "range"; s.min = 1; s.max = 100; s.step = 1; s.value = level;
const sOut = el("b", "min-width:120px;font-family:var(--font-monospace);", "", sRow);
const cols = el("div", "display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;");
const linBox = el("div", "flex:1;min-width:250px;padding:8px;border-radius:6px;background:var(--background-secondary);", null, cols);
const pwmBox = el("div", "flex:1;min-width:250px;padding:8px;border-radius:6px;background:var(--background-secondary);", null, cols);
const note = el("div", "margin-top:8px;font-size:13px;color:var(--text-muted);");

function bar(useful, waste, max) {
  const u = (useful / max) * 100, h = (waste / max) * 100;
  return `<div style="display:flex;height:18px;border-radius:4px;overflow:hidden;background:var(--background-primary);border:1px solid var(--background-modifier-border);margin:6px 0;">` +
    `<div style="width:${u}%;background:#2b8a3e"></div><div style="width:${h}%;background:#e8590c"></div></div>`;
}
function box(title, lines, useful, waste, max) {
  const eff = useful + waste > 0 ? (100 * useful) / (useful + waste) : 0;
  return `<div style="font-weight:bold">${title}</div>` + bar(useful, waste, max) +
    `<div style="font-family:var(--font-monospace);font-size:12px;line-height:1.5">` +
    `<span style="color:#2b8a3e">■</span> load gets <b>${w(useful)}</b><br>` +
    `<span style="color:#e8590c">■</span> heat wasted <b>${w(waste)}</b><br>${lines}<br>` +
    `efficiency <b>${eff.toFixed(0)}%</b></div>`;
}

function draw() {
  level = Number(s.value);
  const p = level / 100;
  lampBtn.style.fontWeight = load === "lamp" ? "bold" : "normal";
  ledBtn.style.fontWeight = load === "led" ? "bold" : "normal";
  if (load === "lamp") {
    const V = 12, R = 12, Pfull = (V * V) / R;           // 12 W at full
    const P = p * Pfull;                                 // wanted load power
    const I = Math.sqrt(P / R), Vl = I * R, Vr = V - Vl; // rheostat drops the rest
    const Rr = I > 0 ? Vr / I : 0;
    sOut.textContent = `${level}% → ${w(P)}`;
    linBox.innerHTML = box("🎚️ Rheostat (linear)",
      `rheostat ${Rr.toFixed(2)} Ω drops ${Vr.toFixed(2)} V × ${I.toFixed(3)} A`, P, Vr * I, Pfull);
    pwmBox.innerHTML = box("⚡ PWM switch",
      `${level}% duty: ON = 12 V × 1 A, OFF = 0 A → switch drop ≈ 0 V`, P, 0, Pfull);
    note.innerHTML = `The rheostat must <b>drop the extra voltage</b> (V × I = heat). The PWM switch is either fully ON (≈0 V across it) or fully OFF (0 A): heat ≈ 0. ` +
      `A real MOSFET with ~0.05 Ω ON-resistance would waste only ~${w(p * 1 * 1 * 0.05)}.`;
  } else {
    const V = 5, Rfix = 150, Vf20 = 2.0;                   // PWM keeps 150 Ω → 20 mA when ON
    const Ion = (V - Vf20) / Rfix;                         // 0.020 A
    const Iw = p * Ion;                                    // linear: same average light ≈ same current
    const Vf = 1.8 + 0.0668 * Math.log(Math.max(Iw * 1000, 1e-3)); // LED voltage drops a bit at low current
    const Rtot = Iw > 0 ? (V - Vf) / Iw : 0;
    sOut.textContent = `${level}% → ${(Iw * 1000).toFixed(1)} mA avg`;
    linBox.innerHTML = box("🎚️ Bigger resistor (linear)",
      `R = ${Rtot.toFixed(0)} Ω drops ${(V - Vf).toFixed(2)} V × ${(Iw * 1000).toFixed(1)} mA`, Vf * Iw, (V - Vf) * Iw, V * Ion);
    pwmBox.innerHTML = box("⚡ PWM + fixed 150 Ω",
      `${level}% duty × (3.0 V × 20 mA in the resistor)`, p * Vf20 * Ion, p * (V - Vf20) * Ion, V * Ion);
    note.innerHTML = `Honest caveat: a small LED <b>always</b> needs a series resistor, so ~60% of the power heats it <b>either way</b>. ` +
      `PWM's big efficiency win is vs linear control of bigger loads (lamps, motors, heaters). For LEDs it mostly wins on smooth, predictable dimming.`;
  }
}

lampBtn.onclick = () => { load = "lamp"; draw(); };
ledBtn.onclick = () => { load = "led"; draw(); };
s.oninput = draw;
draw();
