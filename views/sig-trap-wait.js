// sig-trap-wait: when does a bash trap actually run? SIGTERM arrives while the script runs a long command.
// Foreground `sleep N` → the trap waits until sleep finishes. `sleep N & wait $!` → the trap runs at once.
// input: { mode?: "fg"|"wait" (default "fg"), sleep?: seconds 2–60 (default 5), at?: second the TERM arrives (default 1) }

const opts = (typeof input === "object" && input) || {};

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

const row = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const modeSel = el("select", "", null, row);
for (const [k, t] of [["fg", "sleep N        (foreground)"], ["wait", "sleep N & wait $!"]]) { const o = el("option", "", t, modeSel); o.value = k; }
modeSel.value = opts.mode === "wait" ? "wait" : "fg";
el("span", "", "N =", row);
const nIn = el("input", "width:110px;", null, row);
nIn.type = "range"; nIn.min = "2"; nIn.max = "60";
nIn.value = String(Math.max(2, Math.min(60, opts.sleep ?? 5)));
const nLabel = el("b", "", "", row);
const playBtn = el("button", "", "▶ Play", row);
const code = el("pre", "margin:8px 0;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:12px;");
const svgWrap = el("div", "");
const out = el("div", "margin-top:6px;font-size:13px;");

const AT = Math.max(0.5, opts.at ?? 1);

function model() {
  const N = +nIn.value, at = Math.min(AT, N - 0.5);
  const trapAt = modeSel.value === "fg" ? N : at;
  return { N, at, trapAt };
}

function draw(tNow = null) {
  const { N, at, trapAt } = model();
  nLabel.textContent = `${N} s`;
  code.textContent = `trap 'echo cleanup; exit 143' TERM\n` + (modeSel.value === "fg" ? `sleep ${N}` : `sleep ${N} & wait $!`) + `\n# SIGTERM arrives at t = ${at} s`;
  const span = N * 1.1, x0 = 20, x1 = 580, X = (t) => x0 + (t / span) * (x1 - x0);
  let s = `<svg viewBox="0 0 600 120" width="100%" style="max-width:640px" font-family="sans-serif" font-size="12">`;
  s += `<line x1="${x0}" y1="90" x2="${x1}" y2="90" stroke="var(--text-muted)"/>`;
  const step = N > 30 ? 10 : N > 10 ? 5 : 1;
  for (let t = 0; t <= span; t += step) s += `<text x="${X(t)}" y="106" text-anchor="middle" fill="var(--text-muted)" font-size="10">${t}s</text>`;
  const sleepEnd = modeSel.value === "fg" ? N : trapAt;
  s += `<rect x="${X(0)}" y="50" width="${X(sleepEnd) - X(0)}" height="18" rx="3" fill="#3b82f6" fill-opacity="0.75"/><text x="${X(0) + 4}" y="63" fill="white" font-size="11">${modeSel.value === "fg" ? "bash stuck: waiting for sleep" : "wait"}</text>`;
  if (trapAt > at) s += `<rect x="${X(at)}" y="72" width="${X(trapAt) - X(at)}" height="10" fill="#d6336c" fill-opacity="0.35"/><text x="${(X(at) + X(trapAt)) / 2}" y="81" text-anchor="middle" fill="#d6336c" font-size="10">signal pending ${(trapAt - at).toFixed(0)} s</text>`;
  s += `<line x1="${X(at)}" y1="22" x2="${X(at)}" y2="90" stroke="#e8590c" stroke-width="2"/><text x="${X(at)}" y="16" text-anchor="middle" fill="#e8590c" font-weight="bold">⚡TERM</text>`;
  s += `<line x1="${X(trapAt)}" y1="30" x2="${X(trapAt)}" y2="90" stroke="#2b8a3e" stroke-width="2.5"/><text x="${Math.min(X(trapAt) + 4, 520)}" y="40" fill="#2b8a3e" font-weight="bold">trap runs</text>`;
  if (tNow !== null) s += `<line x1="${X(tNow)}" y1="20" x2="${X(tNow)}" y2="92" stroke="var(--text-normal)" stroke-dasharray="3 2" stroke-width="2"/>`;
  svgWrap.innerHTML = s + `</svg>`;
  out.innerHTML = modeSel.value === "fg"
    ? `Bash runs traps only <b>between</b> commands. TERM arrived at ${at} s, but the trap runs at <b>${trapAt} s</b>, when <code>sleep</code> ends: ${(trapAt - at).toFixed(0)} s late.`
    : `<code>wait</code> is interrupted by the signal, so the trap runs at <b>${trapAt} s</b>, right away. (The background sleep keeps running until it finishes; kill it in the trap if needed.)`;
}

let busy = false;
playBtn.onclick = () => {
  if (busy) return;
  busy = true;
  const end = model().trapAt + 0.3, t0 = Date.now(), dur = 2500;
  const tick = () => {
    if (!root.isConnected) { busy = false; return; }
    const f = Math.min((Date.now() - t0) / dur, 1);
    draw(f * end);
    if (f < 1) setTimeout(tick, 30); else busy = false;
  };
  tick();
};
modeSel.onchange = nIn.oninput = () => { if (!busy) draw(); };
draw();
