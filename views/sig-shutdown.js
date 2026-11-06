// sig-shutdown: graceful-shutdown timeline. SIGTERM at t = 0, a grace period, then SIGKILL.
// Race between the app's cleanup and the deadline (docker stop 10 s, Kubernetes 30 s, systemd 90 s).
// input: { platform?: "docker"|"k8s"|"systemd" (default "docker"),
//          app?: "handler"|"none"|"pid1" (default "handler"),
//          cleanup?: seconds of cleanup 0–120 (default 6), autoplay?: false }

const opts = (typeof input === "object" && input) || {};
const PLAT = { docker: ["docker stop", 10], k8s: ["Kubernetes pod delete", 30], systemd: ["systemctl stop", 90] };
const APP = {
  handler: "App handles SIGTERM (cleanup, then exit 0)",
  none: "No handler (normal process)",
  pid1: "No handler, and it's PID 1 in the container",
};

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
function select(parent, entries, value) {
  const s = el("select", "", null, parent);
  for (const [k, label] of entries) { const o = el("option", "", label, s); o.value = k; }
  s.value = value;
  return s;
}

const row = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;");
const platSel = select(row, Object.entries(PLAT).map(([k, v]) => [k, `${v[0]} (grace ${v[1]} s)`]), PLAT[opts.platform] ? opts.platform : "docker");
const appSel = select(row, Object.entries(APP), APP[opts.app] ? opts.app : "handler");
const row2 = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;");
el("span", "", "Cleanup takes:", row2);
const slider = el("input", "width:170px;", null, row2);
slider.type = "range"; slider.min = "0"; slider.max = "120";
slider.value = String(Math.max(0, Math.min(120, opts.cleanup ?? 6)));
const sLabel = el("b", "", "", row2);
const playBtn = el("button", "", "▶ Play", row2);
const svgWrap = el("div", "margin-top:6px;");
const out = el("div", "margin-top:6px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;");

function outcome() {
  const grace = PLAT[platSel.value][1], cleanup = +slider.value, app = appSel.value;
  if (app === "none") return { grace, cleanup: 0, end: 0, code: 143, killed: false,
    text: "SIGTERM's default action = terminate: it dies <b>instantly</b>, but <b>no cleanup</b> runs. $? = 128 + 15 = 143." };
  if (app === "pid1") return { grace, cleanup: 0, end: grace, code: 137, killed: true,
    text: `PID 1 has no handler → the kernel <b>drops</b> SIGTERM. Nothing happens for ${grace} s, then SIGKILL. $? = 137, no cleanup.` };
  if (cleanup <= grace) return { grace, cleanup, end: cleanup, code: 0, killed: false,
    text: `Cleanup done at ${cleanup} s, before the ${grace} s deadline → clean <b>exit 0</b> ✅` };
  const pct = Math.round((grace / cleanup) * 100);
  return { grace, cleanup, end: grace, code: 137, killed: true,
    text: `Cleanup needs ${cleanup} s, grace is ${grace} s → SIGKILL at ${grace} s cuts it off ~${pct}% done (${grace} ÷ ${cleanup}). $? = 137 ⚠️` };
}

function draw(tNow = null) {
  const o = outcome();
  sLabel.textContent = `${slider.value} s`;
  slider.disabled = appSel.value !== "handler";
  const span = Math.max(o.grace, o.cleanup, 1) * 1.15;
  const x0 = 20, x1 = 580, X = (t) => x0 + (t / span) * (x1 - x0);
  let s = `<svg viewBox="0 0 600 150" width="100%" style="max-width:640px" font-family="sans-serif" font-size="12">`;
  s += `<line x1="${x0}" y1="110" x2="${x1}" y2="110" stroke="var(--text-muted)" stroke-width="1.5"/>`;
  const step = span > 60 ? 20 : span > 20 ? 5 : 2;
  for (let t = 0; t <= span; t += step)
    s += `<line x1="${X(t)}" y1="106" x2="${X(t)}" y2="114" stroke="var(--text-muted)"/><text x="${X(t)}" y="128" text-anchor="middle" fill="var(--text-muted)" font-size="10">${t}s</text>`;
  s += `<rect x="${X(0)}" y="70" width="${X(o.grace) - X(0)}" height="18" rx="3" fill="#e8590c" fill-opacity="0.2" stroke="#e8590c"/>`;
  s += `<text x="${X(0) + 4}" y="83" fill="#e8590c" font-size="11">grace ${o.grace} s</text>`;
  if (appSel.value === "handler" && o.cleanup > 0) {
    const w = X(Math.min(o.cleanup, o.end)) - X(0);
    s += `<rect x="${X(0)}" y="40" width="${Math.max(w, 2)}" height="18" rx="3" fill="#2b8a3e" fill-opacity="0.8"/>`;
    if (o.killed) s += `<rect x="${X(o.end)}" y="40" width="${X(o.cleanup) - X(o.end)}" height="18" rx="3" fill="none" stroke="#2b8a3e" stroke-dasharray="4 3"/>`;
    s += `<text x="${X(0) + 4}" y="53" fill="white" font-size="11">cleanup</text>`;
  }
  s += `<line x1="${X(0)}" y1="22" x2="${X(0)}" y2="110" stroke="#3b82f6" stroke-width="2"/><text x="${X(0) + 3}" y="18" fill="#3b82f6" font-weight="bold">⚡TERM</text>`;
  if (o.killed) s += `<line x1="${X(o.end)}" y1="22" x2="${X(o.end)}" y2="110" stroke="#d6336c" stroke-width="2.5"/><text x="${X(o.end)}" y="18" text-anchor="middle" fill="#d6336c" font-weight="bold">💀 KILL</text>`;
  else if (appSel.value === "handler") s += `<text x="${X(o.end) + 4}" y="53" fill="#2b8a3e" font-weight="bold">exit 0 ✅</text>`;
  else s += `<text x="${X(0) + 50}" y="53" fill="#d6336c" font-weight="bold">dies instantly · exit 143</text>`;
  if (tNow !== null)
    s += `<line x1="${X(tNow)}" y1="30" x2="${X(tNow)}" y2="114" stroke="var(--text-normal)" stroke-width="2" stroke-dasharray="3 2"/><text x="${X(tNow)}" y="144" text-anchor="middle" fill="var(--text-normal)" font-size="11">t = ${tNow.toFixed(1)} s</text>`;
  svgWrap.innerHTML = s + `</svg>`;
  out.innerHTML = `${o.text} · <b>exit code ${o.code}</b>`;
}

let busy = false;
function play() {
  if (busy) return;
  busy = true;
  const total = Math.max(outcome().end, 0.5), t0 = Date.now(), dur = 3000;
  const tick = () => {
    if (!root.isConnected) { busy = false; return; }
    const f = Math.min((Date.now() - t0) / dur, 1);
    draw(f * total);
    if (f < 1) setTimeout(tick, 30);
    else busy = false;
  };
  tick();
}
playBtn.onclick = play;
platSel.onchange = appSel.onchange = slider.oninput = () => { if (!busy) draw(); };
draw();
if (opts.autoplay) play();
