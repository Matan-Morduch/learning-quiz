// buffer-size-calc: two buffer formulas, worked step by step with real numbers.
//   memory:  bitrate × seconds buffered → bits → ÷8 → bytes → MB
//   latency: samples in the buffer ÷ sample rate → seconds of delay
// input: { mode?: "memory" | "latency" (default "memory"),
//          bitrate?: Mbit/s (default 5), seconds?: seconds buffered (default 10),
//          samples?: buffer size in samples (default 512), rate?: samples per second (default 44100) }

const opts = (typeof input === "object" && input) || {};
let mode = opts.mode === "latency" ? "latency" : "memory";
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

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
function field(parent, label, value, min, max, step, unit) {
  const w = el("label", "display:flex;gap:6px;align-items:center;flex-wrap:wrap;", null, parent);
  el("span", "", label, w);
  const inp = el("input", "width:90px;", null, w);
  inp.type = "number"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  el("span", "color:var(--text-muted);", unit, w);
  inp.addEventListener("input", render);
  return inp;
}
const fmt = (x, d = 2) => Number(x.toFixed(d)).toLocaleString("en-US", { maximumFractionDigits: d });

// ---------- UI ----------
const tabs = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;");
const memTab = el("button", "", "💾 How much memory?", tabs);
const latTab = el("button", "", "⏱ How much delay?", tabs);

const memBox = el("div", "display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;");
const bitrate = field(memBox, "Bitrate", num(opts.bitrate, 5), 0.1, 100, 0.5, "Mbit/s");
const seconds = field(memBox, "Buffered", num(opts.seconds, 10), 1, 600, 1, "s");

const latBox = el("div", "display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;");
const samples = field(latBox, "Buffer", num(opts.samples, 512), 16, 16384, 16, "samples");
const rate = field(latBox, "Rate", num(opts.rate, 44100), 8000, 192000, 100, "samples/s");
const presets = el("div", "display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;", null, latBox);
for (const n of [128, 256, 512, 1024, 2048]) {
  const b = el("button", "font-size:12px;", String(n), presets);
  b.onclick = () => { samples.value = n; render(); };
}

const steps = el("div", "font-family:var(--font-monospace);font-size:13px;line-height:1.7;padding:8px;border-radius:6px;background:var(--background-secondary);");
const bar = el("div", "margin-top:10px;");
const note = el("div", "margin-top:8px;font-size:13px;color:var(--text-muted);");

function render() {
  memTab.style.fontWeight = mode === "memory" ? "bold" : "normal";
  latTab.style.fontWeight = mode === "latency" ? "bold" : "normal";
  memBox.style.display = mode === "memory" ? "flex" : "none";
  latBox.style.display = mode === "latency" ? "flex" : "none";

  if (mode === "memory") {
    const r = num(bitrate.value, 5), s = num(seconds.value, 10);
    const mbit = r * s, mbyte = mbit / 8;
    steps.innerHTML =
      `1. bits &nbsp;= bitrate × seconds = ${fmt(r)} Mbit/s × ${fmt(s)} s = <b>${fmt(mbit)} Mbit</b><br>` +
      `2. bytes = bits ÷ 8 = ${fmt(mbit)} ÷ 8 = <b style="color:#2b8a3e">${fmt(mbyte, 3)} MB</b><br>` +
      `&nbsp;&nbsp;&nbsp;(= ${fmt(mbyte * 1e6, 0)} bytes, 1 MB = 1,000,000 bytes)`;
    // bar: one block per second of video
    const n = Math.min(60, Math.round(s));
    let h = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:3px;">each block = 1 s of video = ${fmt(r / 8, 3)} MB</div><div style="display:flex;gap:2px;flex-wrap:wrap;">`;
    for (let i = 0; i < n; i++) h += `<div style="width:14px;height:18px;border-radius:3px;background:#3b82f6;"></div>`;
    if (s > n) h += `<span style="font-size:12px;"> … +${fmt(s - n, 0)} more</span>`;
    bar.innerHTML = h + "</div>";
    note.textContent = `Bonus: on a live stream those ${fmt(s)} s in the buffer also mean you are about ${fmt(s)} s behind real time.`;
  } else {
    const n = num(samples.value, 512), f = num(rate.value, 44100);
    const ms = (n / f) * 1000;
    steps.innerHTML =
      `delay = samples waiting ÷ consumption rate<br>` +
      `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= ${fmt(n, 0)} ÷ ${fmt(f, 0)} samples/s = ${fmt(n / f, 5)} s<br>` +
      `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= <b style="color:#2b8a3e">${fmt(ms, 1)} ms</b>`;
    // bar: 0–50 ms scale with the "musicians notice" zone
    const max = 50, w = Math.min(100, (ms / max) * 100);
    bar.innerHTML =
      `<div style="position:relative;height:22px;border-radius:5px;background:var(--background-secondary);overflow:hidden;">` +
      `<div style="position:absolute;left:20%;width:20%;top:0;bottom:0;background:#e8590c;opacity:0.25;"></div>` +
      `<div style="position:absolute;left:0;top:4px;height:14px;width:${w.toFixed(1)}%;background:${ms > 20 ? "var(--text-error)" : "#3b82f6"};border-radius:3px;"></div></div>` +
      `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);"><span>0 ms</span><span>10–20 ms: musicians start to notice</span><span>${max} ms${ms > max ? " +" : ""}</span></div>`;
    note.textContent = ms <= 10 ? "Small buffer: barely noticeable delay, but more risk of clicks/dropouts if the CPU is late."
      : ms <= 20 ? "Borderline: many musicians start to feel the lag around here."
      : "Big buffer: very safe from dropouts, but the delay is clearly noticeable when playing live.";
  }
}

memTab.onclick = () => { mode = "memory"; render(); };
latTab.onclick = () => { mode = "latency"; render(); };
render();
