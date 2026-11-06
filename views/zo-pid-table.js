// zo-pid-table: a leaky server forks one short-lived child per request. If it never reaps, zombies (Z)
// fill a toy PID table until fork() fails with EAGAIN. Switch on a SIGCHLD handler, or kill the server so
// PID 1 adopts and reaps its zombies. A calculator shows how long a real pid_max lasts.
// input: { slots?: 20–80 PIDs in the toy table = 40, reap?: "never"|"handler" = "never",
//          prefill?: 0–0.9 fraction of the table already zombies at start = 0.5 (only when reap = "never"),
//          rate?: forks per second for the calculator = 10, pidmax?: 32768|4194304 = 32768 }

const opts = (typeof input === "object" && input) || {};
const N = Math.max(20, Math.min(80, Math.round(opts.slots ?? 40)));
let reap = opts.reap === "handler" ? "handler" : "never";
const PREFILL = Math.max(0, Math.min(0.9, Number(opts.prefill ?? 0.5) || 0));
let rate = Math.max(1, Math.min(1000, Number(opts.rate ?? 10) || 10));
let pidmax = Number(opts.pidmax) === 4194304 ? 4194304 : 32768;
const SYS = 4; // PID 1, sshd, bash, server

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
const runBtn = el("button", "", "▶ Start traffic", controls);
const reapSel = el("select", "", null, controls);
for (const [k, v] of [["never", "Server never calls wait()"], ["handler", "SIGCHLD handler reaps (loop)"]]) {
  const o = el("option", "", v, reapSel); o.value = k;
}
reapSel.value = reap;
const killBtn = el("button", "", "💀 kill the server", controls);
const resetBtn = el("button", "", "↺ Reset", controls);
const grid = el("div", "display:flex;flex-wrap:wrap;gap:3px;margin:6px 0;");
const stats = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);");
const narr = el("div", "margin-top:6px;padding:6px 8px;border-left:3px solid var(--interactive-accent);font-size:13px;min-height:1.4em;");
const calc = el("div", "margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

// ---------- state ----------
let slots, failed, forks, running = false, busy = false;
const C = { free: "transparent", sys: "#2b8a3e", run: "#3b82f6", zombie: "#d6336c", adopt: "#9c36b5" };
function reset() {
  slots = Array.from({ length: N }, (_, i) => ({ kind: i < SYS ? "sys" : "free", life: 0, parent: "server" }));
  failed = 0; forks = 0;
  if (reap === "never") {
    const z = Math.floor((N - SYS) * PREFILL);
    for (let i = 0; i < z; i++) slots[SYS + i].kind = "zombie";
  }
  narr.textContent = reap === "never" && PREFILL > 0
    ? `The server has been leaking for a while: ${count("zombie")} zombies already. Press ▶.`
    : "Press ▶ to send requests. Each one forks a child that lives ~1 s.";
  render();
}
const count = (k) => slots.filter((s) => s.kind === k).length;

function tick() {
  const msgs = [];
  for (const s of slots) {
    if (s.kind !== "run") continue;
    if (--s.life > 0) continue;
    if (s.parent === "init" || reap === "handler") {
      s.kind = "free";
      msgs.push(s.parent === "init" ? "an orphan exited → PID 1 reaped it" : "child exited → SIGCHLD → waitpid loop reaped it");
    } else {
      s.kind = "zombie";
      msgs.push("child exited → ZOMBIE (no wait())");
    }
  }
  if (serverAlive) {
    const free = slots.findIndex((s) => s.kind === "free");
    if (free < 0) {
      failed++;
      msgs.unshift("💥 fork() failed: EAGAIN (Resource temporarily unavailable). Request dropped!");
    } else {
      forks++;
      slots[free] = { kind: "run", life: 2 + Math.floor(Math.random() * 2), parent: "server" };
      msgs.unshift(`request → fork() → child gets PID slot ${free + 1}`);
    }
  }
  narr.textContent = msgs.join(" · ");
  render();
}

let serverAlive = true;
runBtn.onclick = () => {
  if (running) { running = false; runBtn.textContent = "▶ Start traffic"; return; }
  running = true;
  runBtn.textContent = "⏸ Pause";
  const timer = setInterval(() => {
    if (!root.isConnected || !running) { clearInterval(timer); return; }
    if (!busy) tick();
  }, 400);
};
reapSel.onchange = () => {
  reap = reapSel.value;
  if (reap === "handler") {
    const z = count("zombie");
    slots.forEach((s) => { if (s.kind === "zombie") s.kind = "free"; });
    narr.textContent = `Handler installed. The next SIGCHLD runs its waitpid(-1, …, WNOHANG) loop, which reaps all ${z} old zombies too.`;
  } else narr.textContent = "Handler removed: exited children will pile up as zombies.";
  render();
};
killBtn.onclick = () => {
  if (busy) return;
  busy = true;
  const z = count("zombie"), r = count("run");
  slots.forEach((s) => { if (s.kind === "zombie") s.kind = "adopt"; if (s.kind === "run") s.parent = "init"; });
  serverAlive = false;
  narr.textContent = `Server killed. Its ${z} zombies are adopted by PID 1 (purple), and its ${r} running children become orphans…`;
  render();
  setTimeout(() => {
    if (!root.isConnected) return;
    slots.forEach((s) => { if (s.kind === "adopt") s.kind = "free"; });
    narr.textContent = `…PID 1 called wait() and reaped all ${z} zombies. systemd restarts the server (still ${reap === "never" ? "leaky!" : "with the handler"}).`;
    serverAlive = true;
    busy = false;
    render();
  }, 1200);
};
resetBtn.onclick = () => { if (!busy) reset(); };

function render() {
  let h = "";
  slots.forEach((s, i) => {
    const filled = s.kind !== "free";
    const label = i === 0 ? "1" : s.kind === "sys" ? (i === SYS - 1 ? "★" : "S") : s.kind === "run" ? "R" : s.kind === "zombie" ? "Z" : s.kind === "adopt" ? "Z" : "·";
    h += `<div title="PID slot ${i + 1}" style="width:26px;height:26px;line-height:24px;text-align:center;border-radius:4px;font-size:12px;font-weight:bold;
      border:1px solid ${filled ? C[s.kind] : "var(--background-modifier-border)"};background:${C[s.kind]};
      color:${filled ? "white" : "var(--text-faint)"};">${label}</div>`;
  });
  grid.innerHTML = h;
  const z = count("zombie") + count("adopt"), r = count("run"), f = count("free");
  stats.textContent = `pid_max = ${N} (toy) · free ${f} · running ${r} · zombie ${z} · system ${SYS} (★ = server) · forks ok ${forks} · failed ${failed}`;
}
function renderCalc() {
  const secs = pidmax / rate;
  calc.innerHTML = `<b>Real life:</b> pid_max <select data-k="m"><option value="32768">32,768</option><option value="4194304">4,194,304</option></select>
    at <input data-k="r" type="number" min="1" max="1000" value="${rate}" style="width:64px;"> leaked forks/s
    → full after about <b>${pidmax.toLocaleString("en-US")} ÷ ${rate} ≈ ${Math.round(secs).toLocaleString("en-US")} s ≈ ${human(secs)}</b>
    <span style="color:var(--text-muted)">(a bit sooner in practice: other processes and threads use PIDs too)</span>`;
  const m = calc.querySelector && calc.querySelector('[data-k="m"]'), ri = calc.querySelector && calc.querySelector('[data-k="r"]');
  if (m) { m.value = String(pidmax); m.onchange = () => { pidmax = Number(m.value); renderCalc(); }; }
  if (ri) ri.onchange = () => { rate = Math.max(1, Math.min(1000, Number(ri.value) || 1)); renderCalc(); };
}
function human(s) {
  if (s < 120) return `${s.toFixed(0)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
}
reset();
renderCalc();
