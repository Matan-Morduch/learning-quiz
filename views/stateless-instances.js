// stateless-instances: the global-variable trap. `visits += 1` in a serverless function.
// Each instance has its OWN copy of the global (starting at 0). Requests are routed to whichever
// instance is free, bursts create new instances, and idle instances are shut down (counter lost).
// Switch the counter to a database and every request sees the true total.
// input: { store: "global"|"db" (default "global"), preload: true }

const opts = (typeof input === "object" && input) || {};
let store = opts.store === "db" ? "db" : "global";
const PRELOAD = opts.preload !== false;
const MAXI = 8;
const NAMES = "ABCDEFGH";

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

let seed = 11;
function rng() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const oneBtn = el("button", "", "📨 1 request", controls);
const burstBtn = el("button", "", "⚡ Burst of 4 at once", controls);
const idleBtn = el("button", "", "💤 Quiet 15 min", controls);
const modeBtn = el("button", "", "", controls);
const resetBtn = el("button", "", "↺ Reset", controls);

const code = el("pre", "margin:0 0 8px;padding:6px 8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;white-space:pre-wrap;");
const grid = el("div", "display:flex;gap:6px;flex-wrap:wrap;min-height:74px;align-items:stretch;");
const dbBox = el("div", "margin-top:8px;font-family:var(--font-monospace);font-size:13px;");
const log = el("div", "margin-top:8px;font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);min-height:1.4em;line-height:1.5;");
const narrate = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);line-height:1.5;");

let instances, total, seen, nextName, lastHit, lastMsg;

function reset() {
  instances = []; total = 0; seen = []; nextName = 0; lastHit = new Set(); lastMsg = "";
  seed = 11;
  if (PRELOAD) {
    burst(3, false);
    for (let i = 0; i < 5; i++) one(false);
    lastMsg = `8 requests so far (a burst of 3, then 5 one by one).`;
  }
  render();
}

function newInstance() {
  if (instances.length >= MAXI) return null;
  const inst = { name: NAMES[nextName++ % NAMES.length], visits: 0 };
  instances.push(inst);
  return inst;
}
function handle(inst) {
  total++;
  inst.visits++;
  const shown = store === "db" ? total : inst.visits;
  seen.push(shown);
  lastHit.add(inst.name);
  return `req #${total} → ${inst.name} → returns ${shown}`;
}
function one(show = true) {
  lastHit = new Set();
  let inst = instances.length ? instances[Math.floor(rng() * instances.length)] : null;
  let cold = false;
  if (!inst) { inst = newInstance(); cold = true; }
  const msg = handle(inst) + (cold ? " (🥶 new instance, visits started at 0)" : "");
  if (show) { lastMsg = msg; flash(); render(); }
}
function burst(n, show = true) {
  lastHit = new Set();
  const msgs = [];
  // simultaneous requests: each existing instance takes one, the rest need NEW instances
  const existing = instances.slice();
  for (let i = 0; i < n; i++) {
    let fresh = false;
    let inst = existing[i];
    if (!inst) { inst = newInstance(); fresh = !!inst; }
    if (!inst) inst = instances[i % instances.length];
    msgs.push(handle(inst) + (fresh ? " 🥶new" : ""));
  }
  if (show) { lastMsg = `${n} at once: ${msgs.join(" | ")}`; flash(); render(); }
}
function idle() {
  const lost = instances.map((i) => `${i.name}=${i.visits}`).join(", ");
  instances = [];
  lastHit = new Set();
  lastMsg = lost ? `All instances shut down. Lost counters: ${lost}. Next request starts from 0 again.` : "No instances were running.";
  render();
}
function flash() {
  setTimeout(() => { if (!root.isConnected) return; lastHit = new Set(); render(); }, 900);
}

function render() {
  modeBtn.textContent = store === "db" ? "🗄️ Counter: database ✅" : "🧠 Counter: global variable ❌";
  code.textContent = store === "db"
    ? "def lambda_handler(event, context):\n    return db.increment(\"visits\")   # one shared counter"
    : "visits = 0                      # module-level global\ndef lambda_handler(event, context):\n    global visits\n    visits += 1\n    return visits";
  grid.innerHTML = "";
  if (!instances.length) el("div", "color:var(--text-faint);align-self:center;", "0 instances (scaled to zero)", grid);
  instances.forEach((inst) => {
    const hit = lastHit.has(inst.name);
    const b = el("div", `min-width:78px;padding:6px 8px;border-radius:6px;text-align:center;border:2px solid ${hit ? "#e8590c" : "var(--background-modifier-border)"};background:${hit ? "rgba(232,89,12,0.15)" : "var(--background-primary)"};transition:all 0.3s;`, null, grid);
    el("div", "font-weight:bold;", `⚙️ ${inst.name}`, b);
    el("div", "font-family:var(--font-monospace);font-size:12px;" + (store === "db" ? "color:var(--text-faint);" : ""), `visits = ${inst.visits}`, b);
  });
  dbBox.innerHTML = store === "db"
    ? `🗄️ database: <b>visits = ${total}</b> (shared by every instance)`
    : `<span style="color:var(--text-muted)">real total = <b>${total}</b> (but nobody stores it)</span>`;
  log.textContent = lastMsg;
  const last = seen.slice(-10);
  const distinct = store === "db" ? true : instances.reduce((s, i) => s + i.visits, 0) === total;
  narrate.innerHTML =
    `Users saw (last ${last.length}): <b>${last.join(", ") || "–"}</b><br>` +
    (store === "db"
      ? `✅ Every answer is the true running total. The instances stay stateless; the state lives in the DB.`
      : `❌ ${instances.length} instance${instances.length === 1 ? "" : "s"} → ${instances.length} separate counters` +
        (instances.length ? ` (${instances.map((i) => i.visits).join(" + ")} = ${instances.reduce((s, i) => s + i.visits, 0)})` : "") +
        ` vs real total ${total}.` + (distinct ? "" : ` <b>${total - instances.reduce((s, i) => s + i.visits, 0)} visits were lost</b> when instances shut down.`));
}

oneBtn.onclick = () => one();
burstBtn.onclick = () => burst(4);
idleBtn.onclick = idle;
modeBtn.onclick = () => { store = store === "db" ? "global" : "db"; reset(); };
resetBtn.onclick = reset;
reset();
