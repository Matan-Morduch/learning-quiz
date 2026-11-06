// bitmask: why i & (cap − 1) == i % cap when cap is a power of 2, bit by bit.
// cap − 1 is then all ones in the low bits, so AND keeps exactly the remainder.
// For other sizes (10, 12…) the mask has holes and the answer is wrong.
// input: { i?: 0–63 (default 13), cap?: 2–32 (default 8) }

const opts = (typeof input === "object" && input) || {};
let I = Math.max(0, Math.min(63, Math.round(Number.isFinite(Number(opts.i)) && opts.i !== "" && opts.i != null ? Number(opts.i) : 13)));
let CAP = Math.max(2, Math.min(32, Math.round(Number(opts.cap) || 8)));

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- UI ----------
const row1 = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;");
const iLabel = el("span", "font-family:var(--font-monospace);min-width:4.5em;", "", row1);
const slider = el("input", "flex:1;min-width:140px;", null, row1);
slider.type = "range"; slider.min = "0"; slider.max = "63"; slider.value = String(I);
const row2 = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;");
el("span", "color:var(--text-muted);font-size:13px;", "cap:", row2);
const capBtns = [4, 8, 10, 12, 16, 32].concat([4, 8, 10, 12, 16, 32].includes(CAP) ? [] : [CAP]).map((c) => {
  const b = el("button", "", String(c), row2);
  b.onclick = () => { if (busy) return; CAP = c; revealed = 99; render(); };
  return [c, b];
});
const animBtn = el("button", "", "▶ AND bit by bit", row2);

const grid = el("div", "margin-top:10px;overflow-x:auto;");
const verdict = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;line-height:1.6;");

// ---------- state ----------
let busy = false, revealed = 99; // how many result bits (from the right) are shown
const isPow2 = (n) => (n & (n - 1)) === 0;
const width = () => Math.max(4, (Math.max(I, CAP - 1) || 1).toString(2).length);
const bitsOf = (n, w) => n.toString(2).padStart(w, "0").split("");

function render() {
  iLabel.textContent = `i = ${I}`;
  for (const [c, b] of capBtns) b.style.outline = c === CAP ? "2px solid var(--interactive-accent)" : "none";
  const w = width(), m = CAP - 1, and = I & m, mod = I % CAP, ok = and === mod;
  const cell = (bit, bg, color, bold) =>
    `<div style="width:28px;height:28px;line-height:28px;text-align:center;border-radius:4px;font-family:var(--font-monospace);font-weight:${bold ? "bold" : "normal"};background:${bg};color:${color};border:1px solid var(--background-modifier-border);box-sizing:border-box;">${bit}</div>`;
  const line = (label, n, colorFor, dec, hidden) => {
    const b = bitsOf(n, w);
    let h = `<div style="display:flex;gap:3px;align-items:center;margin:3px 0;"><div style="width:92px;font-size:12px;color:var(--text-muted);font-family:var(--font-monospace);">${label}</div>`;
    b.forEach((bit, k) => {
      const fromRight = w - 1 - k;
      if (hidden && fromRight >= revealed) h += cell("?", "transparent", "var(--text-faint)", false);
      else h += cell(bit, ...colorFor(bit, fromRight));
    });
    return h + `<div style="margin-left:8px;font-family:var(--font-monospace);font-weight:bold;">= ${hidden && revealed < w ? "…" : dec}</div></div>`;
  };
  const maskBits = bitsOf(m, w);
  const inMask = (fromRight) => maskBits[w - 1 - fromRight] === "1";
  let h = `<div style="display:flex;gap:3px;margin-left:95px;">` +
    bitsOf(0, w).map((_, k) => `<div style="width:28px;text-align:center;font-size:10px;color:var(--text-muted);">${2 ** (w - 1 - k)}</div>`).join("") + `</div>`;
  h += line("i", I, (bit, fr) => [inMask(fr) ? "var(--background-secondary)" : "transparent", bit === "1" ? "var(--text-normal)" : "var(--text-faint)", bit === "1"], I, false);
  h += line("cap − 1", m, (bit) => [bit === "1" ? "#3b82f6" : "transparent", bit === "1" ? "#fff" : "var(--text-faint)", true], m, false);
  h += `<div style="margin-left:95px;border-top:2px solid var(--text-muted);width:${w * 31}px;margin-top:2px;"></div>`;
  h += line("i & (cap−1)", and, (bit, fr) => [bit === "1" ? (ok ? "#2b8a3e" : "#d6336c") : "transparent", bit === "1" ? "#fff" : "var(--text-faint)", true], and, true);
  h += line("i % cap", mod, (bit) => [bit === "1" ? "#9c36b5" : "transparent", bit === "1" ? "#fff" : "var(--text-faint)", true], mod, false);
  grid.innerHTML = h;

  const q = Math.floor(I / CAP);
  const mStr = m.toString(2).padStart(w, "0");
  if (revealed < w) { verdict.innerHTML = `AND: a result bit is 1 only where both i and cap − 1 have a 1…`; return; }
  verdict.innerHTML = `${I} = ${q} × ${CAP} + <b>${mod}</b>, so ${I} % ${CAP} = <b>${mod}</b> · ${I} & ${m} = <b>${and}</b> ` +
    (ok ? "✅ match" : "❌ different") + "<br>" +
    (isPow2(CAP)
      ? `cap = ${CAP} is a power of 2 → cap − 1 = ${mStr} is all ones in the low ${Math.log2(CAP)} bits. AND keeps them (the remainder) and drops the rest (the multiples of ${CAP}). Always works.`
      : `cap = ${CAP} is NOT a power of 2 → cap − 1 = ${mStr} has 0-bit holes, so the AND is not the remainder` + (ok ? ` (this i matches by luck: try others)` : "") + `. Use % for this size.`);
}

async function animate() {
  if (busy) return;
  busy = true;
  const w = width();
  revealed = 0; render();
  await sleep(400);
  if (!root.isConnected) return;
  for (let k = 0; k < w; k++) {
    revealed = k + 1;
    render();
    const ib = (I >> k) & 1, mb = ((CAP - 1) >> k) & 1;
    verdict.innerHTML = `bit worth ${2 ** k}: i has ${ib}, mask has ${mb} → ${ib} AND ${mb} = <b>${ib & mb}</b>`;
    await sleep(700);
    if (!root.isConnected) return;
  }
  revealed = 99;
  render();
  busy = false;
}

slider.oninput = () => { if (busy) { slider.value = String(I); return; } I = Number(slider.value); revealed = 99; render(); };
animBtn.onclick = animate;

render();
