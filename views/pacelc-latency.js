// pacelc-latency: the "ELC" half of PACELC. No partition, just distance. A client writes to a nearby replica
// that has a far-away copy. EC (consistency): wait for the far replica to confirm → ack after 2 + RTT ms.
// EL (latency): ack right after the local write → 2 ms, but the far replica is stale for about RTT/2 ms.
// input: { mode: "EC"|"EL" (default "EC"), rtt: 90 (far replica round trip in ms, 10–250), local: 1 (client↔local one-way ms) }

const opts = (typeof input === "object" && input) || {};
let mode = opts.mode === "EL" ? "EL" : "EC";
let rtt = Math.max(10, Math.min(250, Math.round(opts.rtt ?? 90)));
const LOCAL = Math.max(0.5, Math.min(10, opts.local ?? 1));
const SLOW = 15; // real ms per simulated ms in the animation (the t = … clock always shows true simulated time)
let busy = false;

// ---------- DOM ----------
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

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;");
const ecBtn = el("button", "", "🔒 EC: wait for far replica", bar);
const elBtn = el("button", "", "⚡ EL: answer locally", bar);
const sendBtn = el("button", "", "✍️ Send a write", bar);
const sl = el("div", "display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:13px;");
el("span", "", "far replica round trip:", sl);
const range = el("input", "flex:1;min-width:120px;", null, sl);
range.type = "range"; range.min = 10; range.max = 250; range.step = 5;
const rttLbl = el("b", "min-width:60px;", "", sl);
const svgWrap = el("div", "margin-top:6px;");
const narr = el("div", "margin-top:6px;font-family:var(--font-monospace);font-size:12px;min-height:2.6em;");
const compare = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

const X = { client: 40, local: 150, far: 470 };
let dots = [];        // {x, color}
let farFresh = true;  // does the far replica have the latest value?
let localFresh = true;
let clockMs = null;

const ackTime = (m) => (m === "EC" ? 2 * LOCAL + rtt : 2 * LOCAL);
const fmt = (v) => (Math.round(v * 10) / 10).toString();

function render() {
  ecBtn.style.outline = mode === "EC" ? "2px solid #3b82f6" : "none";
  elBtn.style.outline = mode === "EL" ? "2px solid #2b8a3e" : "none";
  range.value = rtt;
  rttLbl.textContent = `${rtt} ms`;
  const node = (x, label, sub, fresh) => {
    const c = fresh ? "#3b82f6" : "#e8590c";
    return `<circle cx="${x}" cy="60" r="24" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="3"/>
      <text x="${x}" y="65" text-anchor="middle" font-size="16">${label}</text>
      <text x="${x}" y="102" text-anchor="middle" font-size="11" fill="${fresh ? "gray" : "#e8590c"}">${sub}</text>`;
  };
  let s = `<svg viewBox="0 0 520 120" width="100%" style="max-width:560px" font-family="sans-serif" font-size="12">`;
  s += `<line x1="${X.client}" y1="60" x2="${X.local}" y2="60" stroke="gray" stroke-width="2"/>`;
  s += `<line x1="${X.local}" y1="60" x2="${X.far}" y2="60" stroke="gray" stroke-width="2" stroke-dasharray="4 4"/>`;
  s += `<text x="${(X.client + X.local) / 2}" y="50" text-anchor="middle" fill="gray">${LOCAL} ms</text>`;
  s += `<text x="${(X.local + X.far) / 2}" y="50" text-anchor="middle" fill="gray">${fmt(rtt / 2)} ms one way (far city)</text>`;
  s += node(X.client, "🧑‍💻", "client", true);
  s += node(X.local, "🗄️", localFresh ? "nearby replica" : "nearby (old)", localFresh);
  s += node(X.far, "🗄️", farFresh ? "far replica" : "far replica: STALE", farFresh);
  for (const d of dots) s += `<circle cx="${d.x}" cy="60" r="7" fill="${d.color}"/>`;
  if (clockMs != null) s += `<text x="260" y="18" text-anchor="middle" font-weight="bold" fill="currentColor">t = ${fmt(clockMs)} ms</text>`;
  s += `</svg>`;
  svgWrap.innerHTML = s;
  const ec = ackTime("EC"), elT = ackTime("EL");
  compare.innerHTML =
    `<div><b style="color:#3b82f6">EC</b>: ack after ${LOCAL} + ${fmt(rtt / 2)} + ${fmt(rtt / 2)} + ${LOCAL} = <b>${fmt(ec)} ms</b>, far replica never stale</div>` +
    `<div><b style="color:#2b8a3e">EL</b>: ack after ${LOCAL} + ${LOCAL} = <b>${fmt(elT)} ms</b> (${fmt(ec / elT)}× faster), far replica stale for ≈ <b>${fmt(rtt / 2)} ms</b></div>`;
}

// move one dot from a to b over `ms` simulated ms, advancing the clock
async function travel(from, to, ms, color, t0) {
  const d = { x: from, color };
  dots.push(d);
  const real = Math.max(350, ms * SLOW); // short hops get a minimum on-screen time so you can see them
  const steps = Math.max(6, Math.round(real / 30));
  for (let i = 1; i <= steps; i++) {
    await sleep(real / steps);
    if (!root.isConnected) return false;
    d.x = from + ((to - from) * i) / steps;
    clockMs = Math.max(clockMs, t0 + (ms * i) / steps);
    render();
  }
  dots = dots.filter((z) => z !== d);
  return true;
}

async function send() {
  if (busy) return;
  busy = true;
  dots = []; clockMs = 0; farFresh = true; localFresh = false;
  narr.textContent = `t = 0: client sends the write to the nearby replica…`;
  render();
  if (!(await travel(X.client, X.local, LOCAL, "#3b82f6", 0))) return;
  localFresh = true; farFresh = false;
  const t1 = LOCAL;
  if (mode === "EC") {
    narr.textContent = `t = ${fmt(t1)} ms: stored nearby. EC: now wait for the far replica before saying "done"…`;
    if (!(await travel(X.local, X.far, rtt / 2, "#9c36b5", t1))) return;
    farFresh = true;
    narr.textContent = `t = ${fmt(t1 + rtt / 2)} ms: far replica has it and confirms…`;
    if (!(await travel(X.far, X.local, rtt / 2, "#9c36b5", t1 + rtt / 2))) return;
    if (!(await travel(X.local, X.client, LOCAL, "#2b8a3e", t1 + rtt))) return;
    narr.textContent = `✅ ack at t = ${fmt(ackTime("EC"))} ms. Slow, but every replica already agrees (consistent).`;
  } else {
    narr.textContent = `t = ${fmt(t1)} ms: stored nearby. EL: answer now, copy to the far replica in the background.`;
    const bg = travel(X.local, X.far, rtt / 2, "#9c36b5", t1);
    if (!(await travel(X.local, X.client, LOCAL, "#2b8a3e", t1))) return;
    narr.textContent = `✅ ack at t = ${fmt(ackTime("EL"))} ms! But a read at the far replica right now returns the OLD value…`;
    if (!(await bg)) return;
    farFresh = true;
    narr.textContent = `✅ ack was at t = ${fmt(ackTime("EL"))} ms. Far replica caught up at t = ${fmt(t1 + rtt / 2)} ms: stale for ${fmt(rtt / 2)} ms (eventual consistency).`;
  }
  render();
  busy = false;
}

ecBtn.onclick = () => { if (!busy) { mode = "EC"; clockMs = null; narr.textContent = ""; render(); } };
elBtn.onclick = () => { if (!busy) { mode = "EL"; clockMs = null; narr.textContent = ""; render(); } };
range.oninput = () => { if (busy) { range.value = rtt; return; } rtt = Number(range.value); render(); };
sendBtn.onclick = send;
narr.textContent = `Mode ${mode}: press "Send a write" to watch it. The numbers below already compare both.`;
render();
