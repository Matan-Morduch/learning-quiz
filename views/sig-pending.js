// sig-pending: block vs ignore. Send SIGINT several times while it's blocked (kept as ONE pending bit)
// or ignored (thrown away), then unblock and count how often the handler runs.
// input: { mode?: "block"|"ignore" (default "block"), sends?: SIGINTs sent at start (default 0) }

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
for (const [k, t] of [["block", "sigprocmask: BLOCK SIGINT"], ["ignore", "signal(SIGINT, SIG_IGN): IGNORE"]]) {
  const o = el("option", "", t, modeSel); o.value = k;
}
modeSel.value = opts.mode === "ignore" ? "ignore" : "block";
const sendBtn = el("button", "", "⌨️ Ctrl-C (send SIGINT)", row);
const openBtn = el("button", "", "🚪 Unblock / restore handler", row);
const resetBtn = el("button", "", "↺ Reset", row);
const pic = el("div", "margin-top:10px;");
const out = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12.5px;min-height:3em;");

let sent, pending, dropped, runs, open, msg;
function reset() { sent = 0; pending = false; dropped = 0; runs = 0; open = false; msg = "Door closed. Press Ctrl-C a few times."; }

function send() {
  sent++;
  if (open) { runs++; msg = `SIGINT #${sent}: handler runs right away (runs = ${runs}).`; return; }
  if (modeSel.value === "ignore") { dropped++; msg = `SIGINT #${sent}: ignored → thrown away (dropped = ${dropped}).`; return; }
  if (pending) { dropped++; msg = `SIGINT #${sent}: the pending bit is already 1 → merged. Nothing new to remember.`; return; }
  pending = true;
  msg = `SIGINT #${sent}: blocked → pending bit set to 1.`;
}
function unblock() {
  if (open) { msg = "Already open."; return; }
  open = true;
  if (pending) { pending = false; runs++; msg = `Unblocked → the pending SIGINT is delivered: handler ran ${runs} time for ${sent} Ctrl-C(s).`; }
  else msg = modeSel.value === "ignore"
    ? `Handler restored. The ${sent} ignored signal(s) are gone for good: handler ran 0 times.`
    : "Unblocked. Nothing was pending.";
}

function draw() {
  const blockMode = modeSel.value === "block";
  pic.innerHTML = `
  <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-family:var(--font-monospace);font-size:13px;">
    <div>sent: <b>${sent}</b></div>
    <div>pending bit (SIGINT): <b style="padding:2px 8px;border-radius:4px;${pending ? "background:#e8590c;color:white;" : "border:1px solid var(--background-modifier-border);"}">${pending ? 1 : 0}</b></div>
    <div>${blockMode ? "merged" : "thrown away"}: <b>${dropped}</b></div>
    <div>handler runs: <b style="color:#2b8a3e">${runs}</b></div>
    <div>${open ? "🚪 open" : blockMode ? "🔒 blocked" : "🙈 ignored"}</div>
  </div>`;
  out.textContent = msg;
}

sendBtn.onclick = () => { send(); draw(); };
openBtn.onclick = () => { unblock(); draw(); };
resetBtn.onclick = () => { reset(); draw(); };
modeSel.onchange = () => { reset(); draw(); };
reset();
for (let i = 0; i < Math.max(0, Math.min(10, opts.sends ?? 0)); i++) send();
draw();
