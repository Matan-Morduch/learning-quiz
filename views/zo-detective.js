// zo-detective: game. Read a clue (ps output or a short story) and say if the process is a zombie, an orphan, or normal.
// Teaches: Z/<defunct> = zombie (dead, not reaped); alive with a changed PPID = orphan; PPID 1 alone isn't proof.
// input: { shuffle?: true, only?: "zombie"|"orphan"|"normal" (limit to one answer type) }

const opts = (typeof input === "object" && input) || {};
const SHUFFLE = opts.shuffle !== false;

const CASES = [
  { clue: "$ ps -o pid,ppid,stat,cmd -p 4120\n  PID  PPID STAT CMD\n 4120  4100 Z    [worker] <defunct>", a: "zombie",
    why: "STAT Z and <defunct>: it already exited, and its parent 4100 hasn't called wait() yet." },
  { clue: "A script runs `sleep 300 &` and exits. 10 s later:\n  PID  PPID STAT CMD\n 5310     1 S    sleep 300", a: "orphan",
    why: "Still alive (S), but its parent (the script) is gone, so it was re-parented to PID 1." },
  { clue: "$ ps -o pid,ppid,stat,cmd -p 812\n  PID  PPID STAT CMD\n  812     1 Ss   nginx: master process", a: "normal",
    why: "PPID 1 because systemd started nginx on purpose: PID 1 is its real parent. PPID 1 alone doesn't mean orphan." },
  { clue: "You ran `kill -9 7001` three times. ps still shows:\n 7001  6990 Z    [convert] <defunct>", a: "zombie",
    why: "kill -9 does nothing to a zombie: it's already dead. Kill or fix parent 6990 instead." },
  { clue: "A child prints getppid() twice:\n  my parent is 2200\n  (parent crashes)\n  my parent is 1873   ← systemd --user", a: "orphan",
    why: "Parent died, child still running, adopted by a child subreaper (systemd --user) instead of PID 1." },
  { clue: "  PID  PPID STAT CMD\n 2201  2100 Ss   -bash\n 2250  2201 R+   python app.py", a: "normal",
    why: "Alive, and its parent (bash 2201) is still alive. Nothing unusual." },
  { clue: "A web server forks a child per request and never calls wait(). A child finished 2 minutes ago.", a: "zombie",
    why: "The child exited, but its parent never reaps it, so it stays a zombie as long as the server runs." },
  { clue: "Docker container without --init, PID 1 = node app.js:\n  PID  PPID STAT CMD\n   57     1 Z    [sh] <defunct>", a: "zombie",
    why: "It was an orphan (adopted by PID 1), then exited. Your app as PID 1 never calls wait(), so it's stuck as a zombie." },
  { clue: "You `kill -9` a parent process. Its child, in the middle of a long download, keeps going.", a: "orphan",
    why: "Killing a parent doesn't kill its children. The child keeps running with a new parent." },
  { clue: "`./reap` waits on its child:\n  reaped 104, exit code 42\nps --ppid shows nothing.", a: "normal",
    why: "The child was a zombie only until wait(). Now it's fully gone: no zombie, no orphan." },
];

const ANS = { zombie: "🧟 Zombie", orphan: "👶 Orphan", normal: "🙂 Normal" };
let pool = CASES.filter((c) => !ANS[opts.only] || c.a === opts.only);
if (!pool.length) pool = CASES.slice();

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

const head = el("div", "display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px;");
const caseLabel = el("div", "font-weight:bold;", "", head);
const scoreLabel = el("div", "font-family:var(--font-monospace);", "", head);
const clueBox = el("pre", "margin:0 0 8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;white-space:pre-wrap;");
const btnRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
const buttons = {};
for (const k of Object.keys(ANS)) buttons[k] = el("button", "", ANS[k], btnRow);
const feedback = el("div", "margin-top:8px;min-height:2.6em;font-size:13px;");
const nextBtn = el("button", "margin-top:4px;", "Next case ➜");

let order, idx, score, answered, done;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function start() {
  order = SHUFFLE ? shuffle(pool.slice()) : pool.slice();
  idx = 0; score = 0; answered = 0; done = false;
  show();
}
function show() {
  const c = order[idx];
  caseLabel.textContent = `🕵️ Case ${idx + 1} of ${order.length}`;
  scoreLabel.textContent = `score ${score}/${answered}`;
  clueBox.textContent = c.clue;
  feedback.textContent = "Zombie, orphan, or normal?";
  feedback.style.color = "var(--text-muted)";
  for (const b of Object.values(buttons)) { b.disabled = false; b.style.outline = ""; }
  nextBtn.style.display = "none";
}
for (const [k, b] of Object.entries(buttons)) {
  b.onclick = () => {
    if (done) return;
    const c = order[idx];
    done = true;
    answered++;
    const right = k === c.a;
    if (right) score++;
    for (const bb of Object.values(buttons)) bb.disabled = true;
    buttons[c.a].style.outline = "3px solid #2b8a3e";
    if (!right) b.style.outline = "3px solid #d6336c";
    feedback.innerHTML = `<b style="color:${right ? "#2b8a3e" : "#d6336c"}">${right ? "✅ Right!" : `❌ It's ${ANS[c.a]}.`}</b> ${c.why}`;
    feedback.style.color = "var(--text-normal)";
    scoreLabel.textContent = `score ${score}/${answered}`;
    nextBtn.textContent = idx + 1 < order.length ? "Next case ➜" : `🏁 Done: ${score}/${order.length}. Play again`;
    nextBtn.style.display = "";
  };
}
nextBtn.onclick = () => {
  if (idx + 1 < order.length) { idx++; done = false; show(); } else start();
};
start();
