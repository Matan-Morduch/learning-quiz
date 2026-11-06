// flush-demo: output waits in a line buffer until a newline (or a flush) pushes it to the screen.
// Runs the note's Python example: for i in range(5): print(i, end=" "); sleep(1) — then print("done").
// Timeline at the top answers the question at a glance; ▶ Run animates one second per step.
// input: { flush?: start with flush=True (default false) }

const opts = (typeof input === "object" && input) || {};
let flush = !!opts.flush;

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
const MONO = "font-family:var(--font-monospace);";

// ---------- UI ----------
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const runBtn = el("button", "", "▶ Run", controls);
const flushLbl = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
const flushBox = el("input", "", null, flushLbl);
flushBox.type = "checkbox"; flushBox.checked = flush;
el("span", MONO, "flush=True", flushLbl);
const manualBtn = el("button", "", "🚽 Flush now", controls);

const code = el("pre", MONO + "font-size:12px;margin:0 0 8px;padding:8px;border-radius:6px;background:var(--background-secondary);white-space:pre-wrap;");
const panes = el("div", "display:flex;gap:8px;flex-wrap:wrap;");
const bufPane = el("div", "flex:1;min-width:150px;", null, panes);
el("div", "font-size:12px;color:var(--text-muted);", "🪣 output buffer (in RAM)", bufPane);
const bufBox = el("div", MONO + "min-height:30px;padding:6px;border:2px dashed #e8590c;border-radius:6px;", null, bufPane);
const scrPane = el("div", "flex:1;min-width:150px;", null, panes);
el("div", "font-size:12px;color:var(--text-muted);", "🖥 terminal (what you see)", scrPane);
const scrBox = el("div", MONO + "min-height:30px;padding:6px;border-radius:6px;background:#1e1e1e;color:#e6e6e6;", null, scrPane);
const narr = el("div", "margin-top:8px;min-height:1.4em;font-size:13px;" + MONO);
const timeline = el("div", "margin-top:10px;font-size:12px;");

// ---------- state ----------
let buffered, screen, busy, sec;
function reset() { buffered = ""; screen = ""; sec = 0; }
function renderCode(line = -1) {
  const lines = [
    "import time",
    "for i in range(5):",
    `    print(i, end=" "${flush ? ", flush=True" : ""})`,
    "    time.sleep(1)",
    'print("done")',
  ];
  code.innerHTML = lines.map((l, i) =>
    `<div style="${i === line ? "background:var(--interactive-accent);color:var(--text-on-accent);border-radius:3px;" : ""}">${l.replace(/</g, "&lt;")}</div>`).join("");
}
function render(line) {
  renderCode(line);
  bufBox.textContent = buffered.replace(/\n/g, "⏎") || "·";
  scrBox.textContent = screen.replace(/\n/g, "⏎") || " ";
}
// what the screen shows at the end of each second, with and without flush
function renderTimeline() {
  const cell = "flex:1;min-width:44px;padding:3px;border:1px solid var(--background-modifier-border);border-radius:4px;" + MONO;
  const row = (label, f) => {
    let h = `<div style="display:flex;gap:3px;align-items:stretch;margin:2px 0;flex-wrap:wrap;"><div style="width:90px;${MONO}">${label}</div>`;
    for (let t = 1; t <= 5; t++) {
      const shown = f ? Array.from({ length: t }, (_, i) => i).join(" ") + (t === 5 ? " done" : "") : (t === 5 ? "0 1 2 3 4 done" : "");
      h += `<div style="${cell}${t === 5 && !f ? "background:#e8590c33;" : ""}"><span style="color:var(--text-muted)">t=${t}s</span><br>${shown || "…"}</div>`;
    }
    return h + "</div>";
  };
  timeline.innerHTML = `<div style="color:var(--text-muted);margin-bottom:2px;">Screen after each second (terminal, line-buffered):</div>` +
    row("no flush", false) + row("flush=True", true);
}

function write(text) {
  buffered += text;
  if (flush || text.includes("\n")) {
    const why = flush ? "flush=True" : "newline";
    screen += buffered;
    narr.textContent = `${why} → ${buffered.length} char(s) pushed from buffer to screen`;
    buffered = "";
  } else {
    narr.textContent = `"${text}" is waiting in the buffer (no newline yet) · ${buffered.length} char(s) held`;
  }
}

async function run() {
  if (busy) return;
  busy = true; reset(); render(); narr.textContent = "running…";
  for (let i = 0; i < 5; i++) {
    write(`${i} `); render(2);
    await sleep(350); if (!root.isConnected) return;
    sec++; narr.textContent += ` · t = ${sec} s`; render(3);
    await sleep(650); if (!root.isConnected) return;
  }
  write("done\n"); render(4);
  busy = false;
}

runBtn.onclick = run;
flushBox.onchange = () => { if (busy) { flushBox.checked = flush; return; } flush = flushBox.checked; reset(); narr.textContent = ""; render(); };
manualBtn.onclick = () => {
  const n = buffered.length;
  screen += buffered; buffered = "";
  narr.textContent = n ? `manual flush → ${n} char(s) sent out right now` : "buffer already empty";
  render();
};

reset();
renderTimeline();
render();
narr.textContent = flush ? "flush=True: every print appears immediately." : "Without flush, numbers wait in the buffer until the final newline.";
