// binary-lab: click bits to flip them and watch the decimal value; +1 / −1 / ×2 / ÷2, auto count,
// overflow and underflow, odd/even from the LSB, MSB/LSB labels, nibble grouping.
// input: { bits?: 4 | 8 (default 8), value?: starting value (default 0, clamped to 0…2^bits−1) }

const opts = (typeof input === "object" && input) || {};
let BITS = opts.bits === 4 ? 4 : 8;
const START = Math.max(0, Math.min(2 ** BITS - 1, Math.floor(Number(opts.value) || 0)));

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

const bitsRow = el("div", "display:flex;gap:4px;justify-content:center;flex-wrap:nowrap;");
const nibbleRow = el("div", "display:flex;gap:4px;justify-content:center;margin-top:2px;min-height:1.2em;");
const endsRow = el("div", "display:flex;justify-content:space-between;font-size:12px;font-weight:bold;color:#9c36b5;margin:4px auto 0;max-width:520px;");
el("span", "", "← MSB (biggest value)", endsRow);
el("span", "", "LSB (worth 1) →", endsRow);
const big = el("div", "margin:12px 0 2px;font-size:24px;font-weight:bold;text-align:center;font-family:var(--font-monospace);");
const sum = el("div", "text-align:center;font-family:var(--font-monospace);color:var(--text-muted);min-height:1.4em;");
const facts = el("div", "text-align:center;margin-top:4px;font-size:13px;min-height:1.4em;");
const note = el("div", "text-align:center;margin-top:6px;padding:6px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;min-height:1.4em;");

const controls = el("div", "display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px;");
const plus = el("button", "", "+1", controls);
const minus = el("button", "", "−1", controls);
const dbl = el("button", "", "×2 (add 0 on right)", controls);
const half = el("button", "", "÷2 (drop LSB)", controls);
const auto = el("button", "", "▶ Auto count", controls);
const sizeBtn = el("button", "", "", controls);
const reset = el("button", "", "↺ Reset", controls);

let value = START, msg = "", timer = null, flash = {};
const max = () => 2 ** BITS - 1;
const binStr = (v) => v.toString(2).padStart(BITS, "0");

function draw() {
  bitsRow.innerHTML = "";
  for (let i = BITS - 1; i >= 0; i--) {
    const cell = el("div", `text-align:center;flex:1;max-width:60px;min-width:32px;${i === 3 && BITS === 8 ? "margin-left:10px;" : ""}`, null, bitsRow);
    el("div", "font-size:10px;color:var(--text-faint);", `2^${i}`, cell);
    el("div", "font-size:12px;color:#e8590c;font-weight:bold;", String(2 ** i), cell);
    const on = (value >> i) & 1;
    const b = el("button", `width:100%;height:44px;padding:0;font-size:20px;font-weight:bold;border-radius:8px;cursor:pointer;
      background:${flash[i] || (on ? "var(--interactive-accent)" : "var(--background-secondary)")};
      color:${on ? "var(--text-on-accent)" : "var(--text-muted)"};`, String(on), cell);
    b.onclick = () => {
      const before = value;
      value ^= 1 << i;
      msg = `flipped bit ${i} (worth ${2 ** i}): ${before} ${value > before ? "+" : "−"} ${2 ** i} = ${value}`;
      flash = { [i]: "#e8590c" };
      draw();
    };
  }
  nibbleRow.innerHTML = BITS === 8
    ? `<span style="flex:1;max-width:252px;text-align:center;font-size:11px;color:var(--text-muted);border-top:2px solid #3b82f6;">high nibble (4 bits)</span>
       <span style="width:10px"></span>
       <span style="flex:1;max-width:252px;text-align:center;font-size:11px;color:var(--text-muted);border-top:2px solid #2b8a3e;">low nibble (4 bits)</span>`
    : `<span style="flex:1;max-width:252px;text-align:center;font-size:11px;color:var(--text-muted);border-top:2px solid #2b8a3e;">1 nibble = 4 bits · range 0–15</span>`;
  big.innerHTML = `${binStr(value)}<sub>2</sub> = ${value}<sub>10</sub>`;
  const parts = [];
  for (let i = BITS - 1; i >= 0; i--) if ((value >> i) & 1) parts.push(2 ** i);
  sum.textContent = parts.length ? `${parts.join(" + ")} = ${value}` : "all bits off = 0";
  let f = value % 2 ? "odd (LSB = 1)" : "even (LSB = 0)";
  if (value > 0 && (value & (value - 1)) === 0) f += " · power of 2 (one bit on)";
  if (value > 0 && ((value + 1) & value) === 0) f += ` · all ones = 2^${Math.log2(value + 1)} − 1 = ${value}`;
  f += ` · ${BITS} bits hold 0–${max()}`;
  facts.textContent = f;
  note.textContent = msg || "click a bit, or use the buttons";
  sizeBtn.textContent = BITS === 8 ? "use 4 bits" : "use 8 bits";
  flash = {};
}

function step(delta) {
  const next = value + delta;
  if (next > max()) msg = `💥 overflow: ${value} + 1 = ${next} needs ${BITS + 1} bits (1${"0".repeat(BITS)}₂). The top 1 falls off → ${binStr(0)} = 0`;
  else if (next < 0) msg = `💥 underflow: 0 − 1 wraps around to ${max()} (${binStr(max())})`;
  else {
    // which bits flipped?
    const changed = value ^ next;
    const flips = [];
    for (let i = 0; i < BITS; i++) if ((changed >> i) & 1) flips.push(i);
    msg = `${value} ${delta > 0 ? "+" : "−"} 1 = ${next}: ${flips.length} bit(s) flipped (${flips.map((i) => "bit " + i).join(", ")})`;
    for (const i of flips) flash[i] = "#e8590c";
  }
  value = (next + max() + 1) % (max() + 1);
  draw();
}

function stopAuto() { if (timer) clearInterval(timer); timer = null; auto.textContent = "▶ Auto count"; }
auto.onclick = () => {
  if (timer) return stopAuto();
  auto.textContent = "⏸ Stop";
  timer = setInterval(() => {
    if (!root.isConnected) return stopAuto();
    step(1);
  }, 400);
};
plus.onclick = () => step(1);
minus.onclick = () => step(-1);
dbl.onclick = () => {
  const before = value, raw = value * 2;
  value = raw & max();
  msg = raw > max()
    ? `💥 ${binStr(before)} → shift left: the MSB fell off. ${before} × 2 = ${raw} doesn't fit, you get ${value}`
    : `${binStr(before)} → ${binStr(value)}: every bit slid one place left, ${before} × 2 = ${value}`;
  draw();
};
half.onclick = () => {
  const before = value;
  value = value >> 1;
  msg = `${binStr(before)} → ${binStr(value)}: shift right, ${before} ÷ 2 = ${value}${before % 2 ? " (the LSB 1 is lost, remainder 1)" : ""}`;
  draw();
};
sizeBtn.onclick = () => {
  stopAuto();
  BITS = BITS === 8 ? 4 : 8;
  value = value & max();
  msg = `now ${BITS} bits: 2^${BITS} = ${max() + 1} values, 0–${max()}`;
  draw();
};
reset.onclick = () => { stopAuto(); value = START; msg = ""; draw(); };
draw();
