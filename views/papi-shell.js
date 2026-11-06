// papi-shell: what a shell does to run one command, step by step: fork → (child rewires its file descriptors) → exec → wait.
// Cards show each process: PID, program, state, what fork() returned, and its fd table. Watch the PID stay the same across exec,
// fd 1 get pointed at a file (>) or a pipe (|), and the parent sleep in waitpid until the child exits and is reaped.
// input: { mode?: "simple"|"redirect"|"pipe" = "redirect", step?: start at this step (0 = beginning) = 0, autoplay?: false }

const opts = (typeof input === "object" && input) || {};
let mode = ["simple", "redirect", "pipe"].includes(opts.mode) ? opts.mode : "redirect";
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

const CMD = { simple: "ls", redirect: "wc -l notes.txt > out.txt", pipe: "ls | wc -l" };
const modeRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;");
const modeBtns = {
  simple: el("button", "", "$ ls", modeRow),
  redirect: el("button", "", "$ wc -l notes.txt > out.txt", modeRow),
  pipe: el("button", "", "$ ls | wc -l", modeRow),
};
const ctrl = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const nextBtn = el("button", "", "Next step ▶", ctrl);
const playBtn = el("button", "", "⏩ Play all", ctrl);
const resetBtn = el("button", "", "↺ Reset", ctrl);
const narr = el("div", "padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:2.6em;margin-bottom:8px;");
const cardsEl = el("div", "display:flex;gap:8px;flex-wrap:wrap;");
const ioEl = el("div", "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;");
const listEl = el("ol", "font-size:12px;color:var(--text-muted);margin:8px 0 0 0;padding-left:22px;");

const TERM = "terminal", KBD = "keyboard";
function fresh() {
  return {
    procs: [{ pid: 500, ppid: 1, prog: "bash (shell)", state: "running", rc: null, fds: { 0: KBD, 1: TERM, 2: TERM } }],
    term: [], file: null, pipe: null, hl: {},
  };
}
const P = (s, pid) => s.procs.find((p) => p.pid === pid);
function forkInto(s, parentPid, childPid) {
  const p = P(s, parentPid);
  s.procs.push({ pid: childPid, ppid: parentPid, prog: p.prog.replace(/ \(copy\)$/, "") + " (copy)", state: "running", rc: 0, fds: { ...p.fds } });
  p.rc = childPid;
  s.hl = { [childPid]: "card", [parentPid]: "rc" };
}

function buildSteps(m) {
  const S = [];
  const add = (who, text, apply) => S.push({ who, text, apply });
  add(500, `shell reads the line: "${CMD[m]}"`, (s) => { s.term.push(`$ ${CMD[m]}`); s.hl = { 500: "card" }; });
  if (m === "pipe") {
    add(500, "pipe(fd): kernel makes a pipe → fd 3 = read end, fd 4 = write end", (s) => {
      Object.assign(P(s, 500).fds, { 3: "pipe (read end)", 4: "pipe (write end)" }); s.pipe = []; s.hl = { 500: "fd3 fd4" };
    });
  }
  add(500, "fork() → new process 501, a copy of the shell. Shell gets 501, child gets 0", (s) => forkInto(s, 500, 501));
  if (m === "pipe") {
    add(500, "fork() again → process 502 (for wc). Shell gets 502, that child gets 0", (s) => forkInto(s, 500, 502));
    add(500, "shell: close(3); close(4). It doesn't use the pipe itself", (s) => { const f = P(s, 500).fds; delete f[3]; delete f[4]; s.hl = { 500: "fds" }; });
    add(501, "child 501: dup2(4, 1); close(3); close(4) → stdout now goes INTO the pipe", (s) => {
      const f = P(s, 501).fds; f[1] = "pipe (write end)"; delete f[3]; delete f[4]; s.hl = { 501: "fd1" };
    });
    add(502, "child 502: dup2(3, 0); close(3); close(4) → stdin now comes FROM the pipe", (s) => {
      const f = P(s, 502).fds; f[0] = "pipe (read end)"; delete f[3]; delete f[4]; s.hl = { 502: "fd0" };
    });
  }
  add(500, `shell: ${m === "pipe" ? "wait() for both children" : "waitpid(501, &status, 0)"} → sleeps 💤`, (s) => { P(s, 500).state = "waiting 💤"; s.hl = { 500: "state" }; });
  if (m === "redirect") {
    add(501, 'child: open("out.txt") → lowest free fd = 3', (s) => { P(s, 501).fds[3] = "out.txt"; s.file = ""; s.hl = { 501: "fd3" }; });
    add(501, "child: dup2(3, 1); close(3) → fd 1 now points at out.txt", (s) => { const f = P(s, 501).fds; f[1] = "out.txt"; delete f[3]; s.hl = { 501: "fd1" }; });
  }
  const execStep = (pid, prog) => add(pid, `${pid}: execvp("${prog.split(" ")[0]}") → program replaced by ${prog}. PID ${pid} and open fds KEPT`, (s) => {
    const p = P(s, pid); p.prog = prog; p.rc = null; s.hl = { [pid]: "prog" };
  });
  if (m === "simple") {
    execStep(501, "ls");
    add(501, 'ls writes "notes.txt  out.txt" to fd 1 → terminal', (s) => { s.term.push("notes.txt  out.txt"); s.hl = { 501: "fd1", term: 1 }; });
    add(501, "ls calls exit(0) → finished, waiting to be reaped", (s) => { P(s, 501).state = "exited (status 0)"; P(s, 501).fds = {}; s.hl = { 501: "state" }; });
  } else if (m === "redirect") {
    execStep(501, "wc -l notes.txt");
    add(501, 'wc writes "12 notes.txt" to fd 1 → it lands in out.txt, not on screen', (s) => { s.file = "12 notes.txt"; s.hl = { 501: "fd1", file: 1 }; });
    add(501, "wc calls exit(0) → finished, waiting to be reaped", (s) => { P(s, 501).state = "exited (status 0)"; P(s, 501).fds = {}; s.hl = { 501: "state" }; });
  } else {
    execStep(501, "ls");
    execStep(502, "wc -l");
    add(501, 'ls writes "notes.txt" and "out.txt" to fd 1 → into the pipe', (s) => { s.pipe = ["notes.txt", "out.txt"]; s.hl = { 501: "fd1", pipe: 1 }; });
    add(501, "ls exits → the last write end of the pipe closes, so wc will see end-of-file", (s) => { P(s, 501).state = "exited (status 0)"; P(s, 501).fds = {}; s.hl = { 501: "state" }; });
    add(502, 'wc reads 2 lines from fd 0, hits end-of-file, writes "2" to fd 1 → terminal', (s) => { s.pipe = []; s.term.push("2"); s.hl = { 502: "fd0", term: 1 }; });
    add(502, "wc calls exit(0)", (s) => { P(s, 502).state = "exited (status 0)"; P(s, 502).fds = {}; s.hl = { 502: "state" }; });
  }
  const kids = m === "pipe" ? [501, 502] : [501];
  add(500, `shell wakes: wait returned ${kids.join(" and ")}, WEXITSTATUS = 0 → child${kids.length > 1 ? "ren" : ""} reaped, gone. New prompt`, (s) => {
    s.procs = s.procs.filter((p) => p.pid === 500);
    const sh = P(s, 500); sh.state = "running"; sh.rc = null; s.term.push("$ ▌"); s.hl = { 500: "state" };
  });
  return S;
}

let steps, at, busy = false;
function stateAt(k) {
  const s = fresh();
  for (let i = 0; i < k; i++) steps[i].apply(s);
  if (k === 0) s.hl = {};
  return s;
}

function card(p, hl) {
  const h = hl[p.pid] || "";
  const mark = (key) => (h.includes(key) || h === "card" ? "background:rgba(232,89,12,0.25);border-radius:4px;" : "");
  const color = p.pid === 500 ? "#3b82f6" : p.pid === 501 ? "#2b8a3e" : "#9c36b5";
  let fds = "";
  for (const [fd, t] of Object.entries(p.fds)) fds += `<div style="${mark("fd" + fd)}${mark("fds")}">fd ${fd} → ${t}</div>`;
  if (!fds) fds = `<div style="color:var(--text-faint)">(no open fds)</div>`;
  const rc = p.rc === null ? "" : `<div style="${mark("rc")}">fork() returned <b>${p.rc}</b>${p.rc === 0 ? " → I'm the child" : " → my child's PID"}</div>`;
  return `<div style="flex:1 1 180px;min-width:170px;border:2px solid ${color};border-radius:8px;padding:6px 8px;font-size:12px;${h === "card" ? "box-shadow:0 0 0 3px rgba(232,89,12,0.35);" : ""}">
    <div style="font-weight:bold;color:${color};font-size:13px;">PID ${p.pid} <span style="color:var(--text-muted);font-weight:normal;">(PPID ${p.ppid})</span></div>
    <div style="${mark("prog")}">program: <b>${p.prog}</b></div>
    <div style="${mark("state")}">state: ${p.state}</div>${rc}
    <div style="margin-top:4px;font-family:var(--font-monospace);">${fds}</div></div>`;
}

function render() {
  const s = stateAt(at);
  for (const [k, b] of Object.entries(modeBtns)) b.style.fontWeight = k === mode ? "bold" : "normal";
  narr.textContent = at === 0 ? `Press Next to run "${CMD[mode]}" (${steps.length} steps).` : `step ${at}/${steps.length} · ${steps[at - 1].text}`;
  cardsEl.innerHTML = s.procs.map((p) => card(p, s.hl)).join("");
  const box = (title, lines, hot) => `<div style="flex:1 1 160px;border:1px dashed var(--background-modifier-border);border-radius:8px;padding:6px 8px;font-family:var(--font-monospace);font-size:12px;${hot ? "background:rgba(232,89,12,0.18);" : ""}">
    <div style="font-family:inherit;font-weight:bold;margin-bottom:2px;">${title}</div>${lines.length ? lines.map((l) => `<div>${l}</div>`).join("") : `<div style="color:var(--text-faint)">(empty)</div>`}</div>`;
  let io = box("🖥️ terminal", s.term, s.hl.term);
  if (s.file !== null) io += box("📄 out.txt", s.file ? [s.file] : [], s.hl.file);
  if (s.pipe !== null) io += box("🚰 pipe", s.pipe, s.hl.pipe);
  ioEl.innerHTML = io;
  listEl.innerHTML = steps.map((st, i) => `<li style="${i === at - 1 ? "color:var(--text-normal);font-weight:bold;" : i < at ? "" : "opacity:0.6;"}">[${st.who}] ${st.text}</li>`).join("");
}

function load(m, k = 0) { mode = m; steps = buildSteps(m); at = Math.max(0, Math.min(steps.length, k)); render(); }

nextBtn.onclick = () => { if (busy) return; if (at < steps.length) at++; render(); };
resetBtn.onclick = () => { if (!busy) load(mode, 0); };
for (const [k, b] of Object.entries(modeBtns)) b.onclick = () => { if (!busy) load(k, 0); };
async function play() {
  if (busy) return;
  busy = true;
  if (at >= steps.length) at = 0;
  while (at < steps.length) {
    at++; render();
    await sleep(1100);
    if (!root.isConnected) return;
  }
  busy = false;
}
playBtn.onclick = play;

load(mode, opts.step ?? 0);
if (opts.autoplay) play();
