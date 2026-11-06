// rgb-bytes: a pixel's color = three bytes (red, green, blue), each 8 bits = 0–255.
// Flip bits or drag sliders per channel and watch the swatch, rgb() and hex update.
// input: { r?: 0–255 (default 255), g?: 0–255 (default 128), b?: 0–255 (default 0) }

const opts = (typeof input === "object" && input) || {};
const clamp = (v, d) => Math.max(0, Math.min(255, Math.floor(Number(v ?? d)) || 0));
const START = [clamp(opts.r, 255), clamp(opts.g, 128), clamp(opts.b, 0)];
let rgb = START.slice(), msg = "";

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

const presets = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;");
const PRE = [["red", [255, 0, 0]], ["yellow", [255, 255, 0]], ["white", [255, 255, 255]], ["black", [0, 0, 0]], ["gray", [128, 128, 128]], ["orange", START]];
for (const [name, v] of PRE) {
  const b = el("button", "", name, presets);
  b.onclick = () => { rgb = v.slice(); msg = `${name} = rgb(${v.join(", ")})`; render(); };
}

const layout = el("div", "display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;");
const chans = el("div", "flex:1 1 320px;min-width:0;", null, layout);
const swatchBox = el("div", "flex:0 0 130px;text-align:center;", null, layout);
const swatch = el("div", "width:120px;height:120px;border-radius:10px;border:1px solid var(--background-modifier-border);margin:auto;", null, swatchBox);
const code = el("div", "font-family:var(--font-monospace);font-size:12px;margin-top:6px;", null, swatchBox);
const note = el("div", "margin-top:10px;padding:6px 8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;min-height:1.4em;");
const total = el("div", "margin-top:6px;font-size:12px;color:var(--text-muted);",
  "3 channels × 8 bits = 24 bits per pixel → 2^24 = 16,777,216 colors");

const NAMES = ["R", "G", "B"], COLS = ["#e03131", "#2b8a3e", "#3b82f6"];
const rows = [];
NAMES.forEach((nm, c) => {
  const row = el("div", "margin-bottom:8px;", null, chans);
  const head = el("div", "display:flex;gap:6px;align-items:center;", null, row);
  el("b", `color:${COLS[c]};width:16px;`, nm, head);
  const slider = el("input", "flex:1;min-width:80px;", null, head);
  slider.type = "range"; slider.min = "0"; slider.max = "255"; slider.step = "1";
  const val = el("span", "font-family:var(--font-monospace);width:34px;text-align:right;", null, head);
  const bitsRow = el("div", "display:flex;gap:2px;margin-top:3px;margin-left:22px;", null, row);
  const btns = [];
  for (let k = 7; k >= 0; k--) {
    const b = el("button", "flex:1;max-width:34px;min-width:22px;height:26px;padding:0;font-family:var(--font-monospace);font-weight:bold;", "0", bitsRow);
    b.title = `worth ${2 ** k}`;
    b.onclick = () => {
      const before = rgb[c];
      rgb[c] ^= 1 << k;
      msg = `${nm}: flipped bit worth ${2 ** k} → ${before} ${rgb[c] > before ? "+" : "−"} ${2 ** k} = ${rgb[c]}`;
      render();
    };
    btns.push({ k, b });
  }
  slider.oninput = () => { rgb[c] = clamp(slider.value, 0); msg = `${nm} = ${rgb[c]} = ${rgb[c].toString(2).padStart(8, "0")}₂`; render(); };
  rows.push({ slider, val, btns });
});

const hex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
function render() {
  rows.forEach(({ slider, val, btns }, c) => {
    slider.value = String(rgb[c]);
    val.textContent = String(rgb[c]);
    for (const { k, b } of btns) {
      const on = (rgb[c] >> k) & 1;
      b.textContent = String(on);
      b.style.background = on ? COLS[c] : "var(--background-secondary)";
      b.style.color = on ? "#fff" : "var(--text-muted)";
    }
  });
  swatch.style.background = `rgb(${rgb.join(",")})`;
  code.innerHTML = `rgb(${rgb.join(", ")})<br>#${rgb.map(hex).join("")}`;
  note.textContent = msg || rgb.map((v, c) => `${NAMES[c]} ${v.toString(2).padStart(8, "0")}`).join(" · ") + ` → one byte each, max 11111111₂ = 255`;
}
render();
