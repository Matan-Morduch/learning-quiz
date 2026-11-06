// mod-clock: modulo as a clock face. Stepping forward with (i + 1) % cap wraps cap−1 → 0.
// Stepping backward: the naive (i − 1) % cap gives −1 at i = 0 in C/C++/Java/JS (not a valid
// index!), while Python gives cap − 1. The safe form (i − 1 + cap) % cap works everywhere.
// input: { cap?: 2–16 positions (default 8), start?: starting index (default 0) }

const opts = (typeof input === "object" && input) || {};
const CAP = Math.max(2, Math.min(16, Math.round(Number(opts.cap) || 8)));
const START = ((Math.round(Number(opts.start) || 0) % CAP) + CAP) % CAP;

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
const langRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
el("span", "color:var(--text-muted);font-size:13px;", "% behaves like:", langRow);
const cBtn = el("button", "", "C / Java / JS", langRow);
const pyBtn = el("button", "", "Python", langRow);
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const naiveBtn = el("button", "", "◀ (i − 1) % cap", controls);
const safeBtn = el("button", "", "◀ (i − 1 + cap) % cap", controls);
const fwdBtn = el("button", "", "(i + 1) % cap ▶", controls);
const lapBtn = el("button", "", "⏩ one lap", controls);
const resetBtn = el("button", "", "↺", controls);

const face = el("div", "text-align:center;margin-top:6px;");
const note = el("div", "margin-top:6px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;min-height:2.5em;line-height:1.6;");

// ---------- state ----------
let i, lang = "c", bad = null, busy = false, trail = [];
// JS % truncates toward zero (same as C/C++/Java); Python's % floors (sign of the divisor)
const modC = (a, m) => a % m;
const modPy = (a, m) => ((a % m) + m) % m;

function reset() { i = START; bad = null; trail = []; note.innerHTML = `i = ${i}, cap = ${CAP}. Valid indexes are 0 … ${CAP - 1}.`; render(); }

function render() {
  cBtn.style.fontWeight = lang === "c" ? "bold" : "normal";
  pyBtn.style.fontWeight = lang === "py" ? "bold" : "normal";
  cBtn.style.outline = lang === "c" ? "2px solid var(--interactive-accent)" : "none";
  pyBtn.style.outline = lang === "py" ? "2px solid var(--interactive-accent)" : "none";
  const cx = 160, cy = 150, R = 105, r = CAP <= 10 ? 20 : 15;
  let s = `<svg viewBox="0 0 320 300" width="100%" style="max-width:300px" font-family="sans-serif">`;
  s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--background-modifier-border)" stroke-width="2"/>`;
  const pos = (k, rad) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / CAP; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; };
  if (bad == null) {
    const [hx, hy] = pos(i, R - r - 6);
    s += `<line x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#e8590c" stroke-width="4" stroke-linecap="round"/>`;
  }
  s += `<circle cx="${cx}" cy="${cy}" r="5" fill="var(--text-normal)"/>`;
  for (let k = 0; k < CAP; k++) {
    const [x, y] = pos(k, R);
    const on = bad == null && k === i, seen = trail.includes(k);
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${on ? "#e8590c" : seen ? "var(--background-secondary)" : "var(--background-primary)"}" stroke="${on ? "#e8590c" : "var(--text-faint)"}" stroke-width="2"/>`;
    s += `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="bold" fill="${on ? "#fff" : "var(--text-normal)"}">${k}</text>`;
  }
  if (bad != null) {
    s += `<text x="${cx}" y="${cy - 20}" text-anchor="middle" font-size="30" font-weight="bold" fill="#d6336c">${bad}</text>`;
    s += `<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="13" fill="#d6336c">not on the clock!</text>`;
  } else {
    s += `<text x="${cx}" y="${cy + 32}" text-anchor="middle" font-size="14" fill="var(--text-muted)">i = ${i}</text>`;
  }
  face.innerHTML = s + "</svg>";
}

function back(safe) {
  if (busy) return;
  if (bad != null) { note.innerHTML = `i = ${bad} is broken. Press ↺ to reset.`; return; }
  const old = i;
  if (safe) {
    i = (old - 1 + CAP) % CAP;
    note.innerHTML = `(${old} − 1 + ${CAP}) % ${CAP} = ${old - 1 + CAP} % ${CAP} = <b>${i}</b>${old === 0 ? " ↩ wrapped backward ✅" : ""}<br>adding cap first keeps it ≥ 0 in every language`;
  } else {
    const v = lang === "c" ? modC(old - 1, CAP) : modPy(old - 1, CAP);
    if (v < 0) {
      bad = v;
      note.innerHTML = `(${old} − 1) % ${CAP} = ${old - 1} % ${CAP} = <b style="color:#d6336c">${v}</b> in C/Java/JS ❌<br>data[${v}] is out of bounds (C: garbage memory, Java: exception, JS: undefined)`;
    } else {
      i = v;
      note.innerHTML = `(${old} − 1) % ${CAP} = ${old - 1} % ${CAP} = <b>${v}</b>` +
        (old === 0 ? `<br>Python's % never goes negative here, so it works… but only in Python` : `<br>fine here, because ${old} − 1 isn't negative. Try it at i = 0`);
    }
  }
  trail = [i]; render();
}

function fwd() {
  if (busy) return;
  if (bad != null) { note.innerHTML = `i = ${bad} is broken. Press ↺ to reset.`; return; }
  const old = i;
  i = (old + 1) % CAP;
  note.innerHTML = `(${old} + 1) % ${CAP} = ${old + 1} % ${CAP} = <b>${i}</b>${i === 0 ? " ↩ wrapped to the start" : ""}`;
  trail = [i]; render();
}

async function lap() {
  if (busy) return;
  if (bad != null) reset();
  busy = true; trail = [i];
  const from = i;
  for (let n = 1; n <= CAP; n++) {
    const old = i;
    i = (i + 1) % CAP;
    trail.push(i);
    note.innerHTML = `step ${n}: (${old} + 1) % ${CAP} = <b>${i}</b>${i === 0 ? " ↩ wrapped" : ""}`;
    render();
    await sleep(350);
    if (!root.isConnected) return;
  }
  note.innerHTML = `${CAP} steps forward from ${from} → back at ${i}. Adding cap never changes the result: (i + ${CAP}) % ${CAP} = i`;
  busy = false;
}

cBtn.onclick = () => { lang = "c"; note.innerHTML = `C, C++, Java, JS: -1 % ${CAP} = <b>${modC(-1, CAP)}</b> (the sign follows the left side)`; render(); };
pyBtn.onclick = () => { lang = "py"; note.innerHTML = `Python: -1 % ${CAP} = <b>${modPy(-1, CAP)}</b> (the sign follows cap)`; render(); };
naiveBtn.onclick = () => back(false);
safeBtn.onclick = () => back(true);
fwdBtn.onclick = fwd;
lapBtn.onclick = lap;
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
