// dec-to-bin: decimal → binary, one step at a time.
//   divide:   keep dividing by 2; the remainders, read bottom-up, are the bits (first remainder = LSB).
//   subtract: walk down the powers of 2; if it fits, subtract it and write 1, else write 0.
// Type your own number, then Next (one step) or Play (auto).
// input: { n?: 0–65535 (default 13), method?: "divide" | "subtract" (default "divide") }

const opts = (typeof input === "object" && input) || {};
let n = Math.max(0, Math.min(65535, Math.floor(Number(opts.n ?? 13)) || 0));
let method = opts.method === "subtract" ? "subtract" : "divide";

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

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;");
el("span", "", "n =", controls);
const inp = el("input", "width:90px;", null, controls);
const methodBtn = el("button", "", "", controls);
const nextBtn = el("button", "", "▶| Next", controls);
const playBtn = el("button", "", "▶ Play", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const title = el("div", "font-weight:bold;margin-bottom:6px;");
const table = el("div", "font-family:var(--font-monospace);font-size:13px;overflow-x:auto;");
const resultRow = el("div", "display:flex;gap:3px;flex-wrap:wrap;margin-top:10px;align-items:flex-end;");
const note = el("div", "margin-top:8px;padding:6px 8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;min-height:1.4em;");

let steps = [], shown = 0, playing = false, timer = null;
const nBits = () => Math.max(1, n.toString(2).length);

function build() {
  steps = [];
  if (method === "divide") {
    let q = n, k = 0;
    do {
      const nq = Math.floor(q / 2), r = q % 2;
      steps.push({ q, nq, r, k });
      q = nq; k++;
    } while (q > 0);
  } else {
    let rem = n;
    for (let k = nBits() - 1; k >= 0; k--) {
      const p = 2 ** k, fits = p <= rem;
      steps.push({ p, k, before: rem, fits, after: fits ? rem - p : rem });
      if (fits) rem -= p;
    }
  }
  shown = 0;
}

function bitsKnown() {
  // returns map k → bit for bits revealed so far
  const m = {};
  for (let i = 0; i < shown; i++) {
    const s = steps[i];
    m[s.k] = method === "divide" ? s.r : (s.fits ? 1 : 0);
  }
  return m;
}

function render() {
  const done = shown === steps.length;
  inp.value = String(n);
  methodBtn.textContent = method === "divide" ? "method: ÷2 remainders" : "method: subtract powers of 2";
  title.textContent = method === "divide"
    ? `Divide ${n} by 2 again and again. Remainders are the bits, LSB first.`
    : `Subtract the biggest power of 2 that fits, starting at 2^${nBits() - 1} = ${2 ** (nBits() - 1)}.`;
  const th = "padding:3px 8px;border-bottom:1px solid var(--background-modifier-border);text-align:left;color:var(--text-muted);font-weight:normal;";
  const td = "padding:3px 8px;";
  let h = `<table style="border-collapse:collapse;">`;
  if (method === "divide") {
    h += `<tr><th style="${th}">divide</th><th style="${th}">result</th><th style="${th}">remainder</th><th style="${th}"></th></tr>`;
    for (let i = 0; i < shown; i++) {
      const s = steps[i];
      const readHl = done ? "background:rgba(59,130,246,0.15);" : "";
      const tag = i === 0 ? "← LSB (bit 0)" : i === steps.length - 1 ? `← MSB (bit ${s.k})` : `bit ${s.k}`;
      h += `<tr style="${i === shown - 1 && !done ? "background:rgba(232,89,12,0.15);" : ""}">
        <td style="${td}">${s.q} ÷ 2</td><td style="${td}">${s.nq}</td>
        <td style="${td}${readHl}font-weight:bold;color:#3b82f6;">${s.r}</td><td style="${td}color:var(--text-muted);">${tag}</td></tr>`;
    }
    if (done) h += `<tr><td></td><td></td><td style="${td}color:#3b82f6;font-weight:bold;">↑ read up</td><td></td></tr>`;
  } else {
    h += `<tr><th style="${th}">power</th><th style="${th}">fits?</th><th style="${th}">remainder</th><th style="${th}">bit</th></tr>`;
    for (let i = 0; i < shown; i++) {
      const s = steps[i];
      h += `<tr style="${i === shown - 1 && !done ? "background:rgba(232,89,12,0.15);" : ""}">
        <td style="${td}">2^${s.k} = ${s.p}</td><td style="${td}">${s.p} ≤ ${s.before}? ${s.fits ? "yes" : "no"}</td>
        <td style="${td}">${s.fits ? `${s.before} − ${s.p} = ${s.after}` : s.after}</td>
        <td style="${td}font-weight:bold;color:${s.fits ? "#3b82f6" : "var(--text-muted)"};">${s.fits ? 1 : 0}</td></tr>`;
    }
  }
  h += `</table>`;
  table.innerHTML = shown ? h : `<div style="color:var(--text-muted);padding:4px 0;">press Next or Play</div>`;

  // result bits (MSB left), filled as they are discovered
  const known = bitsKnown();
  let r = `<div style="margin-right:6px;font-weight:bold;">result:</div>`;
  for (let k = nBits() - 1; k >= 0; k--) {
    const b = known[k];
    const isNew = shown > 0 && steps[shown - 1].k === k;
    r += `<div style="text-align:center;width:34px;">
      <div style="font-size:10px;color:#e8590c;">${2 ** k}</div>
      <div style="height:32px;line-height:30px;border-radius:5px;font-weight:bold;font-size:17px;
        border:2px solid ${isNew ? "#e8590c" : "var(--background-modifier-border)"};
        background:${b === 1 ? "var(--interactive-accent)" : "transparent"};
        color:${b === 1 ? "var(--text-on-accent)" : b === 0 ? "var(--text-normal)" : "var(--text-faint)"};">${b ?? "?"}</div></div>`;
  }
  resultRow.innerHTML = r;

  const bin = n.toString(2);
  if (!shown) note.textContent = `goal: write ${n} in binary`;
  else if (done) {
    const parts = [];
    for (let k = bin.length - 1; k >= 0; k--) if ((n >> k) & 1) parts.push(2 ** k);
    note.textContent = method === "divide"
      ? `read the remainders bottom-up → ${bin}₂ · check: ${parts.join(" + ") || 0} = ${n} ✅` +
        (bin.length > 1 && bin !== [...bin].reverse().join("") ? ` (top-down would give ${[...bin].reverse().join("")}₂ = ${parseInt([...bin].reverse().join(""), 2)} ✗)` : "")
      : `→ ${bin}₂ · check: ${parts.join(" + ") || 0} = ${n} ✅`;
  } else {
    const s = steps[shown - 1];
    note.textContent = method === "divide"
      ? `${s.q} ÷ 2 = ${s.nq} remainder ${s.r} → bit ${s.k} = ${s.r}${s.nq > 0 ? `, keep going with ${s.nq}` : ""}`
      : s.fits ? `${s.p} fits in ${s.before}: write 1, ${s.before} − ${s.p} = ${s.after} left`
        : `${s.p} doesn't fit in ${s.before}: write 0`;
  }
  nextBtn.disabled = done;
  playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";
}

function stop() { playing = false; if (timer) clearTimeout(timer); timer = null; render(); }
function tick() {
  if (!root.isConnected || !playing) { playing = false; return; }
  if (shown >= steps.length) return stop();
  shown++;
  render();
  if (shown >= steps.length) return stop();
  timer = setTimeout(tick, 900);
}
nextBtn.onclick = () => { if (playing) return; if (shown < steps.length) { shown++; render(); } };
playBtn.onclick = () => {
  if (playing) return stop();
  if (shown >= steps.length) shown = 0;
  playing = true;
  render();
  timer = setTimeout(tick, 300);
};
resetBtn.onclick = () => { stop(); shown = 0; render(); };
methodBtn.onclick = () => { stop(); method = method === "divide" ? "subtract" : "divide"; build(); render(); };
function setN() {
  const v = Math.floor(Number(inp.value));
  if (!Number.isFinite(v) || v < 0 || v > 65535) { note.textContent = "type a whole number from 0 to 65535"; return; }
  stop(); n = v; build(); render();
}
inp.onchange = setN;
inp.onkeydown = (e) => { if (e.key === "Enter") setN(); };

build();
shown = steps.length; // start solved; Play replays it step by step
render();
