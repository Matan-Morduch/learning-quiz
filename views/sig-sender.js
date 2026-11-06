// sig-sender: send INT/TERM/KILL/STOP/CONT to different kinds of processes and see what happens.
// Shows ps state, pending signals, the shell's exit code (128 + N) and whether cleanup ran.
// input: { type?: "plain"|"handler"|"ignores"|"zombie"|"dstate"|"pid1" (default "plain"),
//          send?: array of signals to send at start, e.g. ["TERM"] or ["STOP","TERM"] (default []) }

const opts = (typeof input === "object" && input) || {};
const TYPES = {
  plain: "Plain program (no handlers)",
  handler: "Has a SIGTERM + SIGINT handler",
  ignores: "Ignores SIGTERM (SIG_IGN)",
  zombie: "Zombie (already exited)",
  dstate: "Stuck in disk I/O (D state)",
  pid1: "PID 1 in a container, no handler (signals from the host)",
};
const SIGS = [["INT", 2], ["TERM", 15], ["KILL", 9], ["STOP", 19], ["CONT", 18]];
const NUM = Object.fromEntries(SIGS);
const START_TYPE = TYPES[opts.type] ? opts.type : "plain";
const START_SEND = Array.isArray(opts.send) ? opts.send.filter((s) => NUM[s]) : [];

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

const top = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;");
const sel = el("select", "", null, top);
for (const [k, v] of Object.entries(TYPES)) {
  const o = el("option", "", v, sel);
  o.value = k;
}
sel.value = START_TYPE;
const resetBtn = el("button", "", "↺ New process", top);

const btns = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;");
for (const [name, n] of SIGS) {
  const b = el("button", "", `SIG${name} (${n})`, btns);
  b.onclick = () => { send(name); draw(); };
}
const ioBtn = el("button", "", "💾 I/O finishes", btns);

const view = el("div", "");
const logEl = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:4em;");

let st;
const log = (s) => st.lines.unshift(s);

function reset() {
  const t = sel.value;
  st = {
    type: t,
    state: t === "zombie" ? "zombie" : t === "dstate" ? "dstate" : "running",
    pending: [], exit: null, temp: t === "zombie" ? "—" : "exists", lines: [],
  };
  log(`PID 4242 started: ${TYPES[t]}`);
}

function die(code, clean, why) {
  st.state = "dead";
  st.exit = code;
  if (st.temp === "exists") st.temp = clean ? "removed ✅" : "left behind ⚠️";
  log(why);
}

function deliver(sig) {
  const n = NUM[sig], t = st.type;
  if (sig === "KILL") return die(137, false, `💀 SIGKILL: removed instantly, no code ran. $? = 128 + 9 = 137`);
  if (sig === "STOP") { st.state = "stopped"; return log(`⏸️ SIGSTOP: stopped (T). Can't be caught.`); }
  if (sig === "CONT") return log(`▶️ SIGCONT: already running, nothing to do.`);
  if (t === "pid1") return log(`🛡️ SIG${sig} dropped: PID 1 has no handler for it.`);
  if (t === "ignores" && sig === "TERM") return log(`🙈 SIGTERM ignored (SIG_IGN). Still running.`);
  if (t === "handler") return die(0, true, `🪝 handler set a flag → main loop cleaned up → exit(0). $? = 0`);
  return die(128 + n, false, `⚰️ SIG${sig} default = terminate. $? = 128 + ${n} = ${128 + n}`);
}

function send(sig) {
  if (st.state === "dead") return log(`kill -${sig} 4242 → "No such process"`);
  if (st.state === "zombie") return log(`🧟 kill -${sig}: accepted, nothing happens. Already dead; only the parent's wait() removes it.`);
  if (st.state === "stopped" && sig === "STOP") return log(`Already stopped.`);
  if (st.state === "dstate" || (st.state === "stopped" && sig !== "KILL" && sig !== "CONT")) {
    if (st.pending.includes(sig)) return log(`SIG${sig} already pending: normal signals don't queue (1 bit).`);
    st.pending.push(sig);
    return log(st.state === "dstate"
      ? `⏳ SIG${sig} pending: in uninterruptible sleep (D). Acts when the I/O finishes.`
      : `⏳ SIG${sig} pending: stopped. Acts after SIGCONT.`);
  }
  if (st.state === "stopped" && sig === "CONT") {
    st.state = "running";
    log(`▶️ SIGCONT: running again.`);
    return flush();
  }
  deliver(sig);
}

function flush() {
  const p = st.pending.slice();
  st.pending = [];
  p.sort((a, b) => (a === "KILL" ? -1 : b === "KILL" ? 1 : 0)); // KILL is delivered first
  for (const s of p) {
    if (st.state !== "running") break;
    log(`→ delivering pending SIG${s}`);
    deliver(s);
  }
}

ioBtn.onclick = () => {
  if (st.state !== "dstate") log("Not waiting for I/O.");
  else { st.state = "running"; log("💾 I/O finished."); flush(); }
  draw();
};
sel.onchange = () => { reset(); draw(); };
resetBtn.onclick = () => { reset(); draw(); };

function draw() {
  const S = {
    running: ["S/R", "running", "#2b8a3e", "🏃"], stopped: ["T", "stopped", "#e8590c", "⏸️"],
    dead: ["—", "gone", "gray", "🪦"], zombie: ["Z", "zombie <defunct>", "#9c36b5", "🧟"],
    dstate: ["D", "uninterruptible sleep", "#d6336c", "💤"],
  }[st.state];
  view.innerHTML = `
  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
    <div style="font-size:40px;">${S[3]}</div>
    <div style="font-family:var(--font-monospace);font-size:13px;line-height:1.7;">
      <div>PID 4242 · STAT <b style="color:${S[2]}">${S[0]}</b> (${S[1]})</div>
      <div>pending: <b>${st.pending.length ? st.pending.map((s) => "SIG" + s).join(", ") : "none"}</b></div>
      <div>exit code ($?): <b>${st.exit === null ? "—" : st.exit}</b></div>
      <div>temp file: <b>${st.temp}</b></div>
    </div>
  </div>`;
  ioBtn.style.display = st.type === "dstate" ? "" : "none";
  logEl.innerHTML = st.lines.slice(0, 7).join("<br>");
}

reset();
for (const s of START_SEND) send(s);
draw();
