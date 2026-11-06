// proc-states: the three-state process model as a clickable state machine.
// Fire events (scheduler picks it, time slice up, start I/O, I/O done); valid ones animate the arrow and move
// the process, invalid ones explain why that transition doesn't exist (e.g. no Ready → Blocked).
// input: { start?: "running"|"ready"|"blocked" (default "ready") }

const opts = (typeof input === "object" && input) || {};
let state = ["running", "ready", "blocked"].includes(opts.start) ? opts.start : "ready";

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

const NAMES = { running: "Running", ready: "Ready", blocked: "Blocked" };
const PS = { running: "R", ready: "R (waiting in the run queue)", blocked: "S or D" };
const EVENTS = [
  { id: "sched", text: "🎯 Scheduler picks it", from: "ready", to: "running", arrow: "sched", name: "Scheduled" },
  { id: "desched", text: "⏰ Time slice is up", from: "running", to: "ready", arrow: "desched", name: "Descheduled" },
  { id: "io", text: "💾 Calls read() on the disk", from: "running", to: "blocked", arrow: "io", name: "I/O: initiate" },
  { id: "done", text: "✅ The I/O finishes", from: "blocked", to: "ready", arrow: "done", name: "I/O: done" },
];
const WHY_NOT = {
  "sched:running": "It's already Running. The scheduler only picks from Ready processes.",
  "sched:blocked": "A Blocked process can't be scheduled: it's still waiting for its I/O. A free CPU doesn't help it.",
  "desched:ready": "It isn't on the CPU, so there's nothing to take away. It's already waiting its turn.",
  "desched:blocked": "It isn't on the CPU. It already gave the CPU up when it blocked.",
  "io:ready": "Trap! A Ready process isn't executing instructions, so it can't call read(). It must be scheduled first: there's no Ready → Blocked arrow.",
  "io:blocked": "It's already waiting for an I/O, and it isn't running, so it can't start another one.",
  "done:running": "It isn't waiting for any I/O, so there's nothing to finish.",
  "done:ready": "It isn't waiting for any I/O, so there's nothing to finish.",
};

const svgWrap = el("div");
const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;");
const narr = el("div", "padding:8px;border-radius:6px;background:var(--background-secondary);min-height:2.6em;");
const histEl = el("div", "margin-top:6px;font-size:12px;color:var(--text-muted);font-family:var(--font-monospace);");
let busy = false, flash = null;
const history = [NAMES[state]];

function box(x, y, key, fill, txtCol) {
  const on = state === key;
  return `<rect x="${x}" y="${y}" width="140" height="50" rx="10" fill="${fill}" fill-opacity="${on ? 0.95 : 0.25}" stroke="${on ? "var(--text-normal)" : "gray"}" stroke-width="${on ? 4 : 1.5}"/>` +
    `<text x="${x + 70}" y="${y + 31}" text-anchor="middle" font-weight="bold" font-size="15" fill="${on ? txtCol : "var(--text-muted)"}">${NAMES[key]}</text>`;
}
function arrowCol(id, base) { return flash === id ? "#d6336c" : base; }
function draw() {
  const w = (id) => (flash === id ? 4 : 2);
  svgWrap.innerHTML = `<svg viewBox="0 0 640 250" width="100%" style="max-width:600px" font-family="sans-serif" font-size="13">
<line x1="220" y1="58" x2="412" y2="58" stroke="${arrowCol("desched", "currentColor")}" stroke-width="${w("desched")}"/>
<polygon points="410,53 420,58 410,63" fill="${arrowCol("desched", "currentColor")}"/>
<text x="320" y="50" text-anchor="middle" fill="${arrowCol("desched", "currentColor")}">Descheduled</text>
<line x1="420" y1="82" x2="228" y2="82" stroke="${arrowCol("sched", "currentColor")}" stroke-width="${w("sched")}"/>
<polygon points="230,77 220,82 230,87" fill="${arrowCol("sched", "currentColor")}"/>
<text x="320" y="100" text-anchor="middle" fill="${arrowCol("sched", "currentColor")}">Scheduled</text>
<line x1="170" y1="95" x2="273" y2="180" stroke="${arrowCol("io", "#e8590c")}" stroke-width="${w("io")}"/>
<polygon points="269.1,182.6 280,185 275.5,174.8" fill="${arrowCol("io", "#e8590c")}"/>
<text x="212" y="150" text-anchor="end" fill="${arrowCol("io", "#e8590c")}">I/O: initiate</text>
<line x1="360" y1="185" x2="463" y2="100" stroke="${arrowCol("done", "#2b8a3e")}" stroke-width="${w("done")}"/>
<polygon points="465.5,105.2 470,95 459.1,97.4" fill="${arrowCol("done", "#2b8a3e")}"/>
<text x="425" y="150" fill="${arrowCol("done", "#2b8a3e")}">I/O: done</text>
${box(80, 45, "running", "#3b82f6", "white")}
${box(420, 45, "ready", "gray", "var(--text-normal)")}
${box(250, 185, "blocked", "#e8590c", "white")}
</svg>`;
  histEl.textContent = "path: " + history.slice(-8).join(" → ");
}

EVENTS.forEach((ev) => {
  const b = el("button", "", ev.text, bar);
  b.onclick = () => {
    if (busy) return;
    if (ev.from !== state) {
      narr.innerHTML = `🚫 <b>Not possible from ${NAMES[state]}.</b> ${WHY_NOT[ev.id + ":" + state]}`;
      return;
    }
    busy = true; flash = ev.arrow; draw();
    narr.innerHTML = `<b>${ev.name}</b>: ${NAMES[ev.from]} → ${NAMES[ev.to]}…`;
    setTimeout(() => {
      if (!root.isConnected) return;
      state = ev.to; flash = null; busy = false; history.push(NAMES[state]); draw();
      const extra = ev.id === "done" ? " Note: it goes to <b>Ready</b>, not Running. The scheduler decides when it runs." : "";
      narr.innerHTML = `<b>${ev.name}</b>: now <b>${NAMES[state]}</b>. In <code>ps</code> this shows as <b>${PS[state]}</b>.${extra}`;
    }, 650);
  };
});
const reset = el("button", "", "↺ Reset", bar);
reset.onclick = () => { if (busy) return; state = ["running", "ready", "blocked"].includes(opts.start) ? opts.start : "ready"; history.length = 0; history.push(NAMES[state]); narr.textContent = "Fire an event. Try the impossible ones too."; draw(); };

narr.innerHTML = `The process is <b>${NAMES[state]}</b> (ps: ${PS[state]}). Fire an event. Try the impossible ones too.`;
draw();
