// place-value: the same number broken into place values in base 10 and in base 2.
// Each column shows its power (10² / 2³), its weight, the digit, and digit × weight; the sum rebuilds the number.
// Optional "digits" mode shows the trap: the SAME digit string (e.g. "10") read in base 10 vs base 2.
// input: { n?: number 0–4095 (default 345), base?: 10 | 2 = which panel comes first (default 10),
//          digits?: string of 0/1 digits, e.g. "10" (default none → number mode) }

const opts = (typeof input === "object" && input) || {};
let n = Math.max(0, Math.min(4095, Math.floor(Number(opts.n ?? 345)) || 0));
const FIRST = opts.base === 2 ? 2 : 10;
let digits = typeof opts.digits === "string" && /^[01]{1,12}$/.test(opts.digits) ? opts.digits : null;

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
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (k) => String(k).split("").map((c) => SUP[c]).join("");

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;");
const modeBtn = el("button", "", "", controls);
const inp = el("input", "width:110px;", null, controls);
const minus = el("button", "", "−1", controls);
const plus = el("button", "", "+1", controls);
const panels = el("div", "");
const note = el("div", "margin-top:8px;padding:6px 8px;border-radius:6px;background:var(--background-secondary);font-size:13px;min-height:1.4em;");

function panel(base, digitStr, color, title) {
  const box = el("div", "margin-bottom:10px;", null, panels);
  el("div", `font-weight:bold;color:${color};margin-bottom:4px;`, title, box);
  const row = el("div", "display:flex;gap:4px;flex-wrap:wrap;", null, box);
  const L = digitStr.length;
  const parts = [];
  let total = 0;
  for (let p = 0; p < L; p++) {
    const k = L - 1 - p, w = base ** k, d = Number(digitStr[p]);
    total += d * w;
    if (d) parts.push(d === 1 && base === 2 ? String(w) : `${d}×${w}`);
    const col = el("div", `text-align:center;min-width:44px;flex:0 0 auto;opacity:${d ? 1 : 0.55};`, null, row);
    el("div", "font-size:11px;color:var(--text-faint);", `${base}${sup(k)}`, col);
    el("div", "font-size:12px;color:#e8590c;font-weight:bold;", String(w), col);
    el("div", `height:38px;line-height:36px;border-radius:6px;font-size:20px;font-weight:bold;
      border:2px solid ${d ? color : "var(--background-modifier-border)"};
      background:${d ? color : "transparent"};color:${d ? "#fff" : "var(--text-muted)"};`, String(d), col);
    el("div", "font-size:11px;font-family:var(--font-monospace);color:var(--text-muted);margin-top:2px;", `${d}×${w}`, col);
    el("div", "font-size:12px;font-family:var(--font-monospace);font-weight:bold;", `=${d * w}`, col);
  }
  el("div", "font-family:var(--font-monospace);margin-top:4px;",
    `${digitStr}${base === 2 ? "₂" : "₁₀"} = ${parts.length && parts.join(" + ") !== String(total) ? parts.join(" + ") + " = " : ""}${total}`, box);
  el("div", "font-size:12px;color:var(--text-muted);",
    `each place is worth ${base}× the one to its right · digits used: ${base === 2 ? "0, 1" : "0–9"}`, box);
  return total;
}

function render() {
  panels.innerHTML = "";
  modeBtn.textContent = digits ? "mode: same digits, two bases" : "mode: same number, two bases";
  inp.value = digits ?? String(n);
  inp.placeholder = digits ? "0s and 1s" : "0–4095";
  const bases = FIRST === 2 ? [2, 10] : [10, 2];
  if (digits) {
    const vals = {};
    for (const b of bases) vals[b] = panel(b, digits, b === 2 ? "#3b82f6" : "#2b8a3e", `"${digits}" read in base ${b}`);
    note.innerHTML = `Same digits, different value: <b>${digits}₁₀ = ${vals[10]}</b> but <b>${digits}₂ = ${vals[2]}</b>. ` +
      `A "1" in the 2nd place means "one ${2}" in binary, "one ten" in decimal.`;
  } else {
    const s2 = n.toString(2), s10 = String(n);
    for (const b of bases) panel(b, b === 2 ? s2 : s10, b === 2 ? "#3b82f6" : "#2b8a3e", `${n} in base ${b}: ${b === 2 ? s2.length + " bits" : s10.length + " digit(s)"}`);
    note.innerHTML = `Same value <b>${n}</b>, two spellings: <b>${s10}₁₀</b> = <b>${s2}₂</b>. Binary needs more places because each place only multiplies by 2.`;
  }
}

function setFromInput() {
  const t = String(inp.value || "").trim();
  if (digits) {
    if (/^[01]{1,12}$/.test(t)) digits = t;
    else note.textContent = "type only 0s and 1s (up to 12)";
  } else {
    const v = Math.floor(Number(t));
    if (Number.isFinite(v) && v >= 0 && v <= 4095) n = v;
    else { note.textContent = "type a number from 0 to 4095"; return; }
  }
  render();
}
inp.onchange = setFromInput;
inp.onkeydown = (e) => { if (e.key === "Enter") setFromInput(); };
modeBtn.onclick = () => { digits = digits ? null : "10"; render(); };
function bump(d) {
  if (digits) {
    const v = Math.max(0, Math.min(4095, parseInt(digits, 2) + d));
    digits = v.toString(2);
  } else n = Math.max(0, Math.min(4095, n + d));
  render();
}
plus.onclick = () => bump(1);
minus.onclick = () => bump(-1);
render();
