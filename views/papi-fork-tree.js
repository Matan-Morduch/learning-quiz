// papi-fork-tree: how many processes do N fork() calls make? Step through fork() calls and watch the tree grow.
// "plain" = fork(); fork(); … (every process forks → 2^N). "loop" = for (i < N) if (fork() == 0) break; (only the parent forks → N + 1).
// The table shows what fork() returned to each process: 0 to the new child, the child's PID to the parent.
// input: { mode?: "plain"|"loop" = "plain", n?: number of fork calls 1–4 = 3, start?: forks already run 0–n = n, table?: true }

const opts = (typeof input === "object" && input) || {};
const N = Math.max(1, Math.min(4, opts.n ?? 3));
let mode = opts.mode === "loop" ? "loop" : "plain";
const START = Math.max(0, Math.min(N, opts.start ?? N));
const SHOW_TABLE = opts.table !== false;
const COLORS = ["#3b82f6", "#2b8a3e", "#e8590c", "#9c36b5", "#d6336c"];

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
const plainBtn = el("button", "", "fork(); × N", controls);
const loopBtn = el("button", "", "loop + break", controls);
const stepBtn = el("button", "", "▶ next fork()", controls);
const resetBtn = el("button", "", "↺ Reset", controls);
const codeEl = el("pre", "margin:6px 0;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:12px;white-space:pre-wrap;");
const treeEl = el("div");
const msg = el("div", "margin:8px 0;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:2.6em;");
const tableEl = el("div", "overflow-x:auto;font-size:12px;");

let procs, step, nextPid, note;

function reset(runTo = 0) {
  procs = [{ pid: 100, ppid: 99, gen: 0, born: 0, rcs: [], children: [], done: false }];
  step = 0; nextPid = 101;
  note = "1 process (PID 100). Nothing forked yet.";
  for (let k = 0; k < runTo; k++) doStep(true);
  render();
}

function doStep(silent = false) {
  if (step >= N) { note = `All ${N} fork() calls done. Press Reset.`; if (!silent) render(); return; }
  const k = step;
  const forking = procs.filter((p) => !p.done);
  const born = [];
  for (const p of forking) {
    const c = { pid: nextPid++, ppid: p.pid, gen: p.gen + 1, born: k + 1, rcs: p.rcs.slice(), children: [], done: mode === "loop" };
    c.rcs[k] = 0;
    p.rcs[k] = c.pid;
    p.children.push(c);
    born.push(c);
  }
  procs.push(...born);
  step++;
  const n = procs.length;
  const formula = mode === "plain" ? `2^${step} = ${n}` : `${step} + 1 = ${n}`;
  note = `fork #${step}: ${forking.length} process(es) called fork() → ${born.length} new: PID ${born.map((b) => b.pid).join(", ")}. ` +
    `Parents got the child's PID, children got 0. Total: ${formula}` +
    (mode === "loop" ? " (children hit break, only PID 100 keeps forking)" : "");
  if (!silent) render();
}

function render() {
  plainBtn.style.fontWeight = mode === "plain" ? "bold" : "normal";
  loopBtn.style.fontWeight = mode === "loop" ? "bold" : "normal";
  const lines = [];
  for (let i = 0; i < N; i++) {
    const text = mode === "plain" ? `fork();                  // #${i + 1}` : `if (fork() == 0) break;  // #${i + 1}`;
    lines.push((i === step ? "▶ " : "  ") + text + (i < step ? "  ✓" : ""));
  }
  const formula = mode === "plain" ? `2^${N} = ${2 ** N}` : `${N} + 1 = ${N + 1}`;
  lines.push(`  printf("hi\\n");   // prints once per process → ${step === N ? procs.length : "?"}${step === N ? `  (${formula})` : ""}`);
  codeEl.textContent = lines.join("\n");

  const order = [];
  (function walk(p) { order.push(p); p.children.forEach(walk); })(procs[0]);
  const W = 640, dx = Math.min(70, (W - 40) / Math.max(order.length, 1));
  const maxGen = Math.max(...procs.map((p) => p.gen));
  const H = 50 + (maxGen + 1) * 60;
  const pos = new Map();
  order.forEach((p, i) => pos.set(p.pid, { x: 20 + dx / 2 + i * dx, y: 34 + p.gen * 60 }));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" font-family="sans-serif">`;
  for (const p of procs) for (const c of p.children) {
    const a = pos.get(p.pid), b = pos.get(c.pid), color = COLORS[c.born];
    s += `<path d="M${a.x} ${a.y} L${a.x} ${b.y - 28} L${b.x} ${b.y - 28} L${b.x} ${b.y}" fill="none" stroke="${color}" stroke-width="2"/>`;
    s += `<text x="${b.x + 4}" y="${b.y - 32}" font-size="10" fill="${color}">#${c.born}</text>`;
  }
  const r = Math.min(17, dx / 2 - 2);
  for (const p of procs) {
    const q = pos.get(p.pid);
    s += `<circle cx="${q.x}" cy="${q.y}" r="${r}" fill="${COLORS[p.gen]}" fill-opacity="${p.done ? 0.45 : 0.9}" stroke="${COLORS[p.gen]}" stroke-width="2"/>`;
    s += `<text x="${q.x}" y="${q.y + 4}" text-anchor="middle" font-size="${r > 14 ? 11 : 9}" font-weight="bold" fill="white">${p.pid}</text>`;
  }
  s += `<text x="${W - 10}" y="${H - 8}" text-anchor="end" font-size="13" fill="var(--text-muted)">processes: ${procs.length}</text></svg>`;
  treeEl.innerHTML = s;
  msg.textContent = note;

  if (!SHOW_TABLE || step === 0) { tableEl.innerHTML = ""; return; }
  let t = `<table style="border-collapse:collapse;"><tr><th style="text-align:left;padding:2px 6px;">PID</th><th style="text-align:left;padding:2px 6px;">PPID</th>`;
  for (let k = 0; k < step; k++) t += `<th style="text-align:left;padding:2px 6px;">fork #${k + 1} returned</th>`;
  t += `</tr>`;
  for (const p of procs.slice().sort((a, b) => a.pid - b.pid)) {
    t += `<tr><td style="padding:2px 6px;"><b>${p.pid}</b></td><td style="padding:2px 6px;">${p.ppid}</td>`;
    for (let k = 0; k < step; k++) {
      const v = p.rcs[k];
      t += k < p.born - 1 ? `<td style="padding:2px 6px;color:var(--text-faint)">not born yet</td>`
        : v === undefined ? `<td style="padding:2px 6px;color:var(--text-faint)">left the loop</td>`
        : v === 0 ? `<td style="padding:2px 6px;color:#2b8a3e"><b>0</b> (child)</td>`
        : `<td style="padding:2px 6px;color:#3b82f6"><b>${v}</b> (my child)</td>`;
    }
    t += `</tr>`;
  }
  tableEl.innerHTML = t + `</table>`;
}

stepBtn.onclick = () => doStep(false);
resetBtn.onclick = () => reset(0);
plainBtn.onclick = () => { mode = "plain"; reset(0); };
loopBtn.onclick = () => { mode = "loop"; reset(0); };

reset(START);
