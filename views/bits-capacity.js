// bits-capacity: n bits → 2^n patterns, range 0 … 2^n − 1. Every extra bit doubles the patterns.
// Lists every pattern for small n, and answers "how many bits do I need for X?".
// input: { bits?: 1–32 (default 4), need?: a number to fit, e.g. 1000 (default none; when set, bits starts at the answer) }

const opts = (typeof input === "object" && input) || {};
const bitsFor = (x) => { let k = 1; while (2 ** k <= x) k++; return k; }; // smallest k with 2^k > x
let need = Number.isFinite(Number(opts.need)) && opts.need != null ? Math.max(0, Math.floor(Number(opts.need))) : null;
let bits = Math.max(1, Math.min(32, Math.floor(Number(opts.bits)) || (need != null ? bitsFor(need) : 4)));
if (need != null && opts.bits == null) bits = Math.min(32, bitsFor(need));

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
const fmt = (x) => x.toLocaleString("en-US");
const NAMES = { 1: "bit", 4: "nibble", 8: "byte", 16: "2 bytes", 32: "4 bytes" };

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;");
const minus = el("button", "", "− bit", controls);
const plus = el("button", "", "+ bit", controls);
const slider = el("input", "flex:1;min-width:120px;", null, controls);
slider.type = "range"; slider.min = "1"; slider.max = "32"; slider.step = "1";

const headline = el("div", "font-size:18px;font-weight:bold;margin-bottom:4px;");
const detail = el("div", "font-family:var(--font-monospace);font-size:13px;color:var(--text-muted);margin-bottom:8px;");
const grid = el("div", "display:flex;gap:3px;flex-wrap:wrap;max-height:220px;overflow-y:auto;");

const needBox = el("div", "margin-top:12px;padding:8px;border-radius:6px;background:var(--background-secondary);");
const needRow = el("div", "display:flex;gap:6px;align-items:center;flex-wrap:wrap;", null, needBox);
el("span", "font-weight:bold;", "Bits needed to store", needRow);
const needInp = el("input", "width:110px;", null, needRow);
needInp.placeholder = "e.g. 1000";
const needOut = el("div", "font-family:var(--font-monospace);font-size:13px;margin-top:6px;min-height:1.4em;", null, needBox);
const note = el("div", "margin-top:8px;font-size:13px;min-height:1.4em;");

let lastMsg = "";

function render() {
  slider.value = String(bits);
  const patterns = 2 ** bits, maxV = patterns - 1;
  headline.innerHTML = `${bits} bit${bits > 1 ? "s" : ""}${NAMES[bits] ? ` (${NAMES[bits]})` : ""} → <span style="color:#3b82f6">${fmt(patterns)} patterns</span>, range <span style="color:#2b8a3e">0 … ${fmt(maxV)}</span>`;
  detail.textContent = `2^${bits} = ${fmt(patterns)} · biggest = 2^${bits} − 1 = ${fmt(maxV)} (one pattern is spent on 0)`;

  if (bits <= 6) {
    let h = "";
    for (let v = 0; v < patterns; v++) {
      const hl = v === maxV ? "#2b8a3e" : v === 0 ? "#9c36b5" : null;
      h += `<div style="font-family:var(--font-monospace);font-size:12px;padding:2px 5px;border-radius:4px;
        border:1px solid ${hl || "var(--background-modifier-border)"};${hl ? `color:${hl};font-weight:bold;` : ""}"
        title="${v}">${v.toString(2).padStart(bits, "0")}<span style="color:var(--text-faint);font-weight:normal;"> =${v}</span></div>`;
    }
    grid.innerHTML = h;
  } else {
    grid.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${fmt(patterns)} patterns, too many to list: from <code>${"0".repeat(bits)}</code> to <code>${"1".repeat(bits)}</code></div>`;
  }

  if (need != null) {
    const k = bitsFor(need);
    needOut.innerHTML = need === 0
      ? "0 fits in 1 bit"
      : (k > 1 ? `2^${k - 1} = ${fmt(2 ** (k - 1))} ≤ ${fmt(need)} → too small (max ${fmt(2 ** (k - 1) - 1)})<br>` : "") +
        `2^${k} = ${fmt(2 ** k)} > ${fmt(need)} → fits (max ${fmt(2 ** k - 1)}) → <b style="color:#2b8a3e">${k} bits</b>` +
        (bits === k ? " ✅ (shown above)" : ` <button data-k="${k}">show ${k} bits</button>`);
    const b = needOut.querySelector && needOut.querySelector("button");
    if (b) b.onclick = () => { bits = k; lastMsg = ""; render(); };
  } else needOut.textContent = "type a number to see how many bits it needs";
  note.textContent = lastMsg;
}

function setBits(b, why) {
  const old = bits;
  bits = Math.max(1, Math.min(32, b));
  lastMsg = bits === old + 1 ? `+1 bit doubles the patterns: ${fmt(2 ** old)} × 2 = ${fmt(2 ** bits)}`
    : bits === old - 1 ? `−1 bit halves the patterns: ${fmt(2 ** old)} ÷ 2 = ${fmt(2 ** bits)}` : (why || "");
  render();
}
plus.onclick = () => setBits(bits + 1);
minus.onclick = () => setBits(bits - 1);
slider.oninput = () => setBits(Math.floor(Number(slider.value)) || bits);
function setNeed() {
  const v = Math.floor(Number(needInp.value));
  if (!Number.isFinite(v) || v < 0 || v > 4294967295) { needOut.textContent = "type a whole number from 0 to 4,294,967,295"; return; }
  need = v;
  render();
}
needInp.onchange = setNeed;
needInp.onkeydown = (e) => { if (e.key === "Enter") setNeed(); };
if (need != null) needInp.value = String(need);
render();
