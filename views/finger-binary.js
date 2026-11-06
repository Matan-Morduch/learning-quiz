// finger-binary: count in binary on your fingers. Each finger is a bit, up = 1.
// thumb = 1, index = 2, middle = 4, ring = 8, pinky = 16 → one hand counts 0–31; a 2nd hand adds 32…512 → 0–1,023.
// input: { hands?: 1 | 2 (default 1), value?: starting value (default 0) }

const opts = (typeof input === "object" && input) || {};
let hands = opts.hands === 2 ? 2 : 1;
const maxFor = (h) => 2 ** (5 * h) - 1;
let value = Math.max(0, Math.min(maxFor(hands), Math.floor(Number(opts.value)) || 0));

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

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const minus = el("button", "", "−1", controls);
const plus = el("button", "", "+1", controls);
const autoBtn = el("button", "", "▶ Auto count", controls);
const maxBtn = el("button", "", "all up", controls);
const handsBtn = el("button", "", "", controls);
const resetBtn = el("button", "", "↺ Reset", controls);
const handsBox = el("div", "display:flex;gap:10px;justify-content:center;flex-wrap:wrap;");
const big = el("div", "text-align:center;font-family:var(--font-monospace);font-size:20px;font-weight:bold;margin-top:6px;");
const note = el("div", "margin-top:6px;padding:6px 8px;border-radius:6px;background:var(--background-secondary);font-size:13px;min-height:1.4em;");

const FINGERS = ["pinky", "ring", "middle", "index", "thumb"]; // drawn left → right; thumb is the LSB of its hand
let timer = null, msg = "";

// One hand as SVG. `offset` = bit index of this hand's thumb (0 or 5).
function handSvg(offset, label) {
  const lens = { pinky: 62, ring: 80, middle: 88, index: 80, thumb: 52 };
  const xs = { pinky: 18, ring: 48, middle: 78, index: 108 };
  let s = `<svg viewBox="0 0 190 210" width="170" style="max-width:48%;min-width:150px;cursor:pointer;" font-family="sans-serif" font-size="11">`;
  s += `<rect x="14" y="110" width="124" height="90" rx="26" fill="#e8590c" fill-opacity="0.18" stroke="#e8590c" stroke-width="2"/>`;
  FINGERS.forEach((f) => {
    const bit = offset + (4 - FINGERS.indexOf(f));
    const up = (value >> bit) & 1;
    const len = up ? lens[f] : 16;
    const col = up ? "#3b82f6" : "gray";
    if (f === "thumb") {
      // thumb sticks out sideways from the right edge of the palm
      const w = up ? lens.thumb : 14;
      s += `<g data-bit="${bit}"><rect data-bit="${bit}" x="132" y="${up ? 104 : 124}" width="${w}" height="24" rx="12"
        transform="rotate(${up ? -35 : 0} 132 ${up ? 116 : 136})" fill="${col}" fill-opacity="${up ? 0.85 : 0.35}" stroke="${col}" stroke-width="2"/></g>`;
      s += `<text x="160" y="${up ? 70 : 108}" text-anchor="middle" fill="${col}" font-weight="bold">${2 ** bit}</text>`;
    } else {
      const x = xs[f];
      s += `<rect data-bit="${bit}" x="${x}" y="${114 - len}" width="26" height="${len + 8}" rx="13"
        fill="${col}" fill-opacity="${up ? 0.85 : 0.35}" stroke="${col}" stroke-width="2"/>`;
      s += `<text x="${x + 13}" y="${106 - len}" text-anchor="middle" fill="${col}" font-weight="bold">${2 ** bit}</text>`;
    }
  });
  s += `<text x="76" y="162" text-anchor="middle" fill="gray">${label}</text></svg>`;
  return s;
}

function upNames() {
  const out = [];
  for (let b = 5 * hands - 1; b >= 0; b--) if ((value >> b) & 1) {
    const h = b >= 5 ? "L " : hands === 2 ? "R " : "";
    out.push(`${h}${FINGERS[4 - (b % 5)]} (${2 ** b})`);
  }
  return out;
}

function draw() {
  handsBox.innerHTML = hands === 2
    ? handSvg(5, "left hand: 32…512") + handSvg(0, "right hand: 1…16")
    : handSvg(0, "one hand: 1…16");
  // clicking a finger toggles its bit
  const parts = handsBox.querySelectorAll ? handsBox.querySelectorAll("[data-bit]") : [];
  for (const p of parts) p.onclick = (e) => {
    e.stopPropagation && e.stopPropagation();
    const b = Number(p.getAttribute("data-bit"));
    const before = value;
    value ^= 1 << b;
    msg = `${FINGERS[4 - (b % 5)]} ${value > before ? "up" : "down"}: ${before} ${value > before ? "+" : "−"} ${2 ** b} = ${value}`;
    draw();
  };
  const bits = 5 * hands;
  big.textContent = `${value.toString(2).padStart(bits, "0")}₂ = ${value}`;
  const names = upNames();
  note.textContent = msg || (names.length ? `up: ${names.join(" + ")}` : `all fingers down = 0. Click a finger!`) +
    ` · ${hands} hand${hands > 1 ? "s" : ""} = ${bits} bits → 0…2^${bits} − 1 = ${maxFor(hands).toLocaleString("en-US")}`;
  handsBtn.textContent = hands === 1 ? "use 2 hands" : "use 1 hand";
  autoBtn.textContent = timer ? "⏸ Stop" : "▶ Auto count";
  msg = "";
}

function step(d) {
  const m = maxFor(hands), next = value + d;
  if (next > m) msg = `${value} + 1 = ${next} doesn't fit in ${5 * hands} fingers → back to 0`;
  else if (next < 0) msg = `below 0 → wraps to ${m}`;
  value = (next + m + 1) % (m + 1);
  draw();
}
function stopAuto() { if (timer) clearInterval(timer); timer = null; draw(); }
autoBtn.onclick = () => {
  if (timer) return stopAuto();
  timer = setInterval(() => { if (!root.isConnected) { clearInterval(timer); timer = null; return; } step(1); }, 450);
  draw();
};
plus.onclick = () => step(1);
minus.onclick = () => step(-1);
maxBtn.onclick = () => { value = maxFor(hands); msg = `all ${5 * hands} fingers up = 2^${5 * hands} − 1 = ${value.toLocaleString("en-US")}`; draw(); };
handsBtn.onclick = () => { hands = hands === 1 ? 2 : 1; value = value & maxFor(hands); draw(); };
resetBtn.onclick = () => { if (timer) clearInterval(timer); timer = null; value = 0; draw(); };
draw();
