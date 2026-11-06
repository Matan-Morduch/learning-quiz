// moving-average: smoothing a noisy sensor with a ring of the last N readings.
// Each new reading overwrites the oldest (overwrite-oldest policy), and a running total
// makes each update O(1): total = total − oldest + newest, average = total / N.
// input: { n?: window size 2–32 (default 8) }

const opts = (typeof input === "object" && input) || {};
const SIZES = [2, 4, 8, 16, 32];
let N = Math.max(2, Math.min(32, Math.round(Number(opts.n) || 8)));
const HIST = 80, WARM = 90;

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

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const playBtn = el("button", "", "▶ Play", controls);
const stepBtn = el("button", "", "➕ One reading", controls);
el("span", "color:var(--text-muted);font-size:13px;margin-left:4px;", "N =", controls);
const nSel = el("select", "", null, controls);
for (const s of SIZES.concat(SIZES.includes(N) ? [] : [N]).sort((a, b) => a - b)) { const o = el("option", "", String(s), nSel); o.value = String(s); }
nSel.value = String(N);

const chart = el("div", "margin-top:8px;");
const legend = el("div", "font-size:12px;color:var(--text-muted);", null);
legend.innerHTML = `<span style="color:#e8590c">━ raw reading (noisy)</span> · <span style="color:#3b82f6">━ average of the last N</span>`;
const ringTitle = el("div", "font-size:12px;color:var(--text-muted);margin-top:8px;", "");
const ringEl = el("div", "display:flex;gap:2px;flex-wrap:wrap;margin-top:4px;");
const note = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:2.5em;line-height:1.6;");

// ---------- state ----------
let ring, idx, total, t, raws, avgs, seed, playing = false, last = null, opsRunning, opsResum;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function sensor() { t++; return Math.max(0, Math.min(1023, Math.round(512 + 220 * Math.sin(t / 16) + (rnd() - 0.5) * 320))); }

function addReading() {
  const r = sensor(), oldest = ring[idx], before = total;
  total = total - oldest + r;       // O(1): no re-summing
  ring[idx] = r;
  const at = idx;
  idx = (idx + 1) % N;
  const avg = total / N;
  raws.push(r); avgs.push(avg);
  if (raws.length > HIST) { raws.shift(); avgs.shift(); }
  opsRunning += 2; opsResum += N;
  last = { r, oldest, before, at, avg };
}

function reset() {
  ring = Array(N).fill(0); idx = 0; total = 0; t = 0; raws = []; avgs = []; seed = 7; last = null;
  for (let k = 0; k < WARM; k++) addReading();
  opsRunning = 0; opsResum = 0;
  render();
}

function render() {
  // chart
  const W = 600, H = 170, pad = 4;
  const x = (k) => pad + (k * (W - 2 * pad)) / (HIST - 1);
  const y = (v) => H - pad - (v / 1023) * (H - 2 * pad);
  const path = (arr) => arr.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:var(--background-secondary);border-radius:6px;">
    <path d="${path(raws)}" fill="none" stroke="#e8590c" stroke-width="1.5" opacity="0.8"/>
    <path d="${path(avgs)}" fill="none" stroke="#3b82f6" stroke-width="3"/>
    ${raws.length ? `<circle cx="${x(raws.length - 1).toFixed(1)}" cy="${y(raws[raws.length - 1]).toFixed(1)}" r="4" fill="#e8590c"/>` : ""}</svg>`;

  // ring
  ringTitle.textContent = `the ring: last ${N} readings · write index = ${idx} (the next slot to overwrite = the oldest reading)`;
  const w = N <= 8 ? 56 : N <= 16 ? 44 : 36;
  let h = "";
  for (let k = 0; k < N; k++) {
    const isNew = last && k === last.at, isNext = k === idx;
    h += `<div style="width:${w}px;text-align:center;">
      <div style="height:28px;line-height:24px;border:${isNext ? "3px solid #e8590c" : "1px solid var(--background-modifier-border)"};border-radius:4px;box-sizing:border-box;
        font-family:var(--font-monospace);font-size:${N <= 16 ? 12 : 10}px;background:${isNew ? "#3b82f6" : "transparent"};color:${isNew ? "#fff" : "var(--text-normal)"};">${ring[k]}</div>
      <div style="font-size:10px;color:var(--text-muted)">${k}</div></div>`;
  }
  ringEl.innerHTML = h;

  if (!last) { note.textContent = ""; return; }
  note.innerHTML = `new reading <b>${last.r}</b> overwrites the oldest (${last.oldest}) at slot ${last.at}<br>` +
    `total = ${last.before} − ${last.oldest} + ${last.r} = <b>${total}</b> → average = ${total} / ${N} = <b>${last.avg.toFixed(1)}</b><br>` +
    `<span style="color:var(--text-muted)">work per reading: running total = 2 ops (O(1)) vs re-summing = ${N} adds (O(N)). ` +
    (opsRunning ? `Since you started: ${opsRunning} vs ${opsResum} ops` : "") + `</span>`;
}

function stepOnce() { addReading(); render(); }

let loopId = 0;
async function play() {
  const id = ++loopId;
  while (playing && id === loopId && root.isConnected) {
    stepOnce();
    await new Promise((r) => setTimeout(r, 220));
  }
}

playBtn.onclick = () => {
  playing = !playing;
  playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";
  if (playing) play();
};
stepBtn.onclick = () => {
  if (playing) { playing = false; playBtn.textContent = "▶ Play"; }
  stepOnce();
};
nSel.onchange = () => { N = Number(nSel.value); reset(); };

reset();
