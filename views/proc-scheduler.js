// proc-scheduler: processes over time as Running / Ready / Blocked, and how switching on I/O keeps the CPU busy.
// Starts fully played out (the answer), with Replay/Step and a policy toggle. Narrates each tick's transitions
// and compares utilization with the other policy.
// input: { preset?: "fig44"|"fig43"|"both"|"three" (default "fig44"),
//          progs?: ["ccicc","ccccc"] (overrides preset; 'c' = CPU tick, 'i' = CPU tick that starts an I/O),
//          io?: I/O length in ticks 1–8 (default 3), policy?: "io"|"end" (default "io"), slice?: 0–4 (default 0 = none) }

const opts = (typeof input === "object" && input) || {};
const PRESETS = {
  fig44: ["ccicc", "ccccc"],
  fig43: ["cccc", "cccc"],
  both: ["cicc", "ccicc"],
  three: ["ici", "cccccc", "cicc"],
};
const progs = Array.isArray(opts.progs) && opts.progs.length ? opts.progs.slice(0, 4).map(String) : PRESETS[opts.preset] || PRESETS.fig44;
const L = Math.max(1, Math.min(8, opts.io ?? 3));
let policy = opts.policy === "end" ? "end" : "io";
const slice = Math.max(0, Math.min(4, opts.slice ?? 0));

function simulate(pol) {
  const P = progs.map((p) => ({ ops: p.split(""), pc: 0, state: "READY", io: 0 }));
  const cols = [];
  let cur = -1, ran = 0, switches = 0, busy = 0, pending = [];
  for (let t = 1; t <= 120; t++) {
    if (P.every((p) => p.state === "DONE")) break;
    const events = pending; pending = [];
    if (slice && pol !== "end" && cur >= 0 && P[cur].state === "RUNNING" && ran >= slice && P.some((p, k) => k !== cur && p.state === "READY")) {
      P[cur].state = "READY"; events.push(`P${cur}: Running → Ready (descheduled)`);
    }
    if (!(cur >= 0 && P[cur].state === "RUNNING")) {
      let pick = -1;
      if (pol === "end" && cur >= 0 && P[cur].state !== "DONE") pick = P[cur].state === "READY" ? cur : -1;
      else for (let k = 1; k <= P.length; k++) { const j = (cur + k + P.length) % P.length; if (P[j].state === "READY") { pick = j; break; } }
      if (pick >= 0) {
        if (cur >= 0 && pick !== cur) switches++;
        cur = pick; ran = 0; P[cur].state = "RUNNING"; events.push(`P${cur}: Ready → Running (scheduled)`);
      }
    }
    const snap = P.map((p) => p.state);
    const runner = P.findIndex((p) => p.state === "RUNNING");
    if (runner >= 0) {
      busy++; ran++;
      const p = P[runner], op = p.ops[p.pc++];
      if (op === "i") { snap[runner] = "IO"; p.state = "BLOCKED"; p.io = L; events.push(`P${runner}: Running → Blocked (I/O: initiate)`); }
      else if (p.pc >= p.ops.length) { p.state = "DONE"; events.push(`P${runner} finished`); }
    } else events.push("CPU idle: nobody is Ready");
    P.forEach((p, k) => {
      if (snap[k] === "BLOCKED" && --p.io === 0) {
        if (p.pc >= p.ops.length) { p.state = "DONE"; pending.push(`P${k}: I/O done → finished`); }
        else { p.state = "READY"; pending.push(`P${k}: Blocked → Ready (I/O: done)`); }
      }
    });
    cols.push({ t, snap, cpu: runner, events, busy, switches });
  }
  return cols;
}

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

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const polBtn = el("button", "", "", bar);
const replayBtn = el("button", "", "▶ Replay", bar);
const stepBtn = el("button", "", "⏭ Step", bar);
const progEl = el("div", "font-size:12px;color:var(--text-muted);margin-bottom:6px;");
const grid = el("div", "overflow-x:auto;padding-bottom:4px;");
const narr = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:2.4em;");
const stats = el("div", "margin-top:8px;");

let cols = [], shown = 0, timer = null;
const LOOK = {
  RUNNING: ["#3b82f6", "white", "run"], IO: ["#3b82f6", "white", "I/O"],
  READY: ["transparent", "var(--text-muted)", "rdy"], BLOCKED: ["#e8590c", "white", "blk"], DONE: ["transparent", "var(--text-faint)", ""],
};
const cell = (bg, fg, txt, border) =>
  `<div style="width:28px;min-width:28px;height:22px;line-height:22px;text-align:center;font-size:10px;border-radius:4px;background:${bg};color:${fg};border:${border};">${txt}</div>`;
const label = (t) => `<div style="width:38px;min-width:38px;font-weight:bold;line-height:22px;">${t}</div>`;

function stop() { if (timer) clearInterval(timer); timer = null; }
function rebuild(full) {
  stop();
  cols = simulate(policy);
  shown = full ? cols.length : 0;
  polBtn.textContent = policy === "io" ? "Policy: switch on I/O (click to change)" : "Policy: wait for I/O (click to change)";
  progEl.innerHTML = progs.map((p, k) => `<b>P${k}</b>: ` + p.split("").map((c) => (c === "i" ? "<span style='color:#e8590c'>I/O</span>" : "CPU")).join(" ")).join(" · ") +
    ` · I/O blocks for ${L} tick${L > 1 ? "s" : ""}${slice ? ` · time slice ${slice} (switch-on-I/O only)` : ""}`;
  draw();
}

function draw() {
  let h = `<div style="display:flex;gap:2px;">${label("")}` +
    cols.map((c, i) => `<div style="width:28px;min-width:28px;text-align:center;font-size:10px;color:${i === shown - 1 ? "var(--text-accent)" : "var(--text-muted)"};">${c.t}</div>`).join("") + "</div>";
  for (let k = 0; k < progs.length; k++) {
    h += `<div style="display:flex;gap:2px;margin-top:2px;">${label("P" + k)}`;
    cols.forEach((c, i) => {
      if (i >= shown) { h += cell("transparent", "", "", "1px dashed var(--background-modifier-border)"); return; }
      const [bg, fg, txt] = LOOK[c.snap[k]];
      h += cell(bg, fg, txt, c.snap[k] === "READY" ? "1px solid var(--text-muted)" : "1px solid transparent");
    });
    h += "</div>";
  }
  h += `<div style="display:flex;gap:2px;margin-top:4px;">${label("CPU")}`;
  cols.forEach((c, i) => {
    if (i >= shown) { h += cell("transparent", "", "", "1px dashed var(--background-modifier-border)"); return; }
    h += c.cpu >= 0 ? cell("#2b8a3e", "white", "P" + c.cpu, "1px solid transparent") : cell("#d6336c", "white", "idle", "1px solid transparent");
  });
  grid.innerHTML = h + "</div>";

  if (!shown) { narr.textContent = "All processes start Ready."; stats.textContent = ""; return; }
  const c = cols[shown - 1];
  narr.innerHTML = `t = ${c.t}: ` + c.events.join(" · ");
  const other = simulate(policy === "io" ? "end" : "io");
  const o = other[other.length - 1];
  const pct = (b, t) => ((100 * b) / t).toFixed(1) + "%";
  const last = cols[cols.length - 1];
  stats.innerHTML = `So far: <b>${c.t}</b> tick${c.t > 1 ? "s" : ""}, CPU busy <b>${c.busy}</b> → ${c.busy} ÷ ${c.t} = <b>${pct(c.busy, c.t)}</b>, context switches ${c.switches}` +
    (shown === cols.length
      ? `<br><span style="color:var(--text-muted)">The other policy (${policy === "io" ? "wait for I/O" : "switch on I/O"}) needs <b>${o.t}</b> ticks → ${o.busy} ÷ ${o.t} = <b>${pct(o.busy, o.t)}</b>. Same ${last.busy} ticks of work either way.</span>`
      : "");
}

polBtn.onclick = () => { policy = policy === "io" ? "end" : "io"; rebuild(true); };
replayBtn.onclick = () => {
  rebuild(false);
  timer = setInterval(() => {
    if (!root.isConnected) return stop();
    if (shown < cols.length) { shown++; draw(); } else stop();
  }, 550);
};
stepBtn.onclick = () => { stop(); if (shown >= cols.length) shown = 0; shown++; draw(); };
rebuild(true);
