// bits-bytes: internet speeds are in BITS per second, file sizes in BYTES. 1 byte = 8 bits.
// Converts Mbit/s → MB/s, works out the download time step by step, and shows the "forgot ÷8" trap.
// input: { mbps: 100 (Mbit/s), size: 1, unit: "KB"|"MB"|"GB"|"TB" (default "GB"), latencyMs: 0 }

const opts = (typeof input === "object" && input) || {};
const pos = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const UNITS = { KB: 0.001, MB: 1, GB: 1000, TB: 1000000 }; // in MB (decimal units, like the note)
const nice = (x) => (x >= 100 ? Math.round(x).toLocaleString("en-US") : x >= 1 ? String(+x.toFixed(2)) : String(+x.toPrecision(3)));
function human(sec) {
  if (sec < 1) return `${nice(sec * 1000)} ms`;
  if (sec < 120) return `${nice(sec)} s`;
  if (sec < 7200) return `${nice(sec)} s ≈ ${nice(sec / 60)} min`;
  return `${nice(sec)} s ≈ ${nice(sec / 3600)} h`;
}

// ---------- DOM helpers ----------
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
const row = el("div", "display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
el("span", "", "🚰 Plan:", row);
const speed = el("input", "width:80px;", null, row);
Object.assign(speed, { type: "number", min: 0.1, step: "any", value: pos(opts.mbps, 100) });
el("span", "", "Mbit/s", row);
el("span", "margin-left:8px;", "📦 File:", row);
const size = el("input", "width:70px;", null, row);
Object.assign(size, { type: "number", min: 0.001, step: "any", value: pos(opts.size, 1) });
const unitSel = el("select", "", null, row);
for (const u of Object.keys(UNITS)) { const o = el("option", "", u, unitSel); o.value = u; }
unitSel.value = UNITS[opts.unit] ? opts.unit : "GB";
const lat = pos(opts.latencyMs, 0);

const steps = el("div", "font-family:var(--font-monospace);font-size:13px;line-height:1.7;");
const trap = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");
const ctrl = el("div", "display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap;");
const goBtn = el("button", "", "▶ Download (sped up)", ctrl);
const barOut = el("div", "flex:1;min-width:160px;height:18px;border-radius:5px;background:var(--background-modifier-border);overflow:hidden;", null, ctrl);
const barIn = el("div", "height:100%;width:0%;background:#3b82f6;", null, barOut);
const live = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;margin-top:4px;");

let busy = false, raf = null;
function calc() {
  const mbps = pos(speed.value, 100), s = pos(size.value, 1), u = UNITS[unitSel.value] ? unitSel.value : "GB";
  const MB = s * UNITS[u];
  const MBps = mbps / 8;
  const secs = MB / MBps + lat / 1000;
  return { mbps, s, u, MB, MBps, secs, naive: MB / mbps };
}
function draw() {
  const c = calc();
  steps.innerHTML =
    `1. speed: ${nice(c.mbps)} Mbit/s ÷ 8 = <b style="color:#3b82f6">${nice(c.MBps)} MB/s</b><br>` +
    `2. size: ${nice(c.s)} ${c.u} = <b>${nice(c.MB)} MB</b> = ${nice(c.MB * 8)} Mbit<br>` +
    `3. time ≈ ${nice(c.MB)} MB ÷ ${nice(c.MBps)} MB/s${lat ? ` + ${nice(lat)} ms latency` : ""} = <b style="color:#2b8a3e">${human(c.secs)}</b>`;
  trap.innerHTML =
    `⚠️ Forgot the ÷ 8? ${nice(c.MB)} MB ÷ ${nice(c.mbps)} = <s>${human(c.naive)}</s>: <b>8× too optimistic</b>. ` +
    `Bits (small b) on the plan, Bytes (big B) on the file.`;
  if (!busy) { barIn.style.width = "0%"; live.textContent = "Press ▶: the bar fills in a few seconds, the clock shows real time."; }
}
function stop() { if (raf) cancelAnimationFrame(raf); raf = null; busy = false; goBtn.textContent = "▶ Download (sped up)"; }
goBtn.onclick = () => {
  if (busy) return;
  busy = true; goBtn.textContent = "⏳ Downloading…";
  const c = calc(), t0 = performance.now(), dur = 3000;
  const frame = (now) => {
    if (!root.isConnected) return stop();
    const f = Math.min(1, (now - t0) / dur);
    barIn.style.width = `${f * 100}%`;
    live.textContent = `t = ${human(f * c.secs)} · ${nice(f * c.MB)} / ${nice(c.MB)} MB at ${nice(c.MBps)} MB/s${f >= 1 ? " ✅ done" : ""}`;
    if (f < 1) raf = requestAnimationFrame(frame); else { raf = null; busy = false; goBtn.textContent = "▶ Again"; }
  };
  raf = requestAnimationFrame(frame);
};
for (const e of [speed, size, unitSel]) e.addEventListener("input", () => { stop(); draw(); });
unitSel.addEventListener("change", () => { stop(); draw(); });

draw();
