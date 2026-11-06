// zo-timeline: parent/child lifetimes on one time axis → when a child is a zombie, an orphan, or reaped.
// Lanes for PID 1, parent 100, child 101; a time cursor shows the matching `ps -o pid,ppid,stat,cmd` output.
// input: { order?: "child-first"|"parent-first" = "child-first",
//          parent?: "wait"|"never"|"handler"|"ignore"|"server" = "wait",
//          pid1?: "init"|"app" = "init",   // "app" = your program as PID 1 in Docker without --init (never reaps)
//          t?: 0–10 cursor time in seconds = 5 }

const opts = (typeof input === "object" && input) || {};
const ORDERS = { "child-first": "Child exits first", "parent-first": "Parent exits first" };
const PARENTS = {
  wait: "Parent calls wait() at t = 6",
  never: "Parent never waits, exits at t = 8",
  handler: "Parent has a SIGCHLD handler",
  ignore: "Parent sets SIGCHLD = SIG_IGN",
  server: "Parent = server, runs forever, never waits",
};
const PID1S = { init: "PID 1 = init/systemd (reaps)", app: "PID 1 = your app, no --init (never reaps)" };
let order = ORDERS[opts.order] ? opts.order : "child-first";
let parent = PARENTS[opts.parent] ? opts.parent : "wait";
let pid1 = PID1S[opts.pid1] ? opts.pid1 : "init";
let t = Math.max(0, Math.min(10, Number(opts.t ?? 5) || 0));
const END = 10;

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
function select(map, value, parentEl) {
  const s = el("select", "", null, parentEl);
  for (const [k, v] of Object.entries(map)) {
    const o = el("option", "", v, s);
    o.value = k;
  }
  s.value = value;
  return s;
}

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const orderSel = select(ORDERS, order, controls);
const parentSel = select(PARENTS, parent, controls);
const pid1Sel = select(PID1S, pid1, controls);
const row = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;");
const playBtn = el("button", "", "▶ Play", row);
const slider = el("input", "flex:1;min-width:140px;", null, row);
slider.type = "range"; slider.min = "0"; slider.max = "10"; slider.step = "0.1";
const tLabel = el("span", "font-family:var(--font-monospace);min-width:60px;", "", row);
const svgWrap = el("div", "");
const psBox = el("pre", "margin:6px 0;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;white-space:pre;overflow-x:auto;");
const narr = el("div", "font-size:13px;padding:6px 8px;border-left:3px solid var(--interactive-accent);min-height:1.4em;");
const verdict = el("div", "margin-top:6px;font-weight:bold;");

// ---------- model ----------
// Returns segments [from, to, kind] per lane, events [t, text], reparentAt, reapAt (null = never).
function model() {
  const parentSeg = [], childSeg = [], ev = [[0, "fork(): parent 100 creates child 101"]];
  let reparentAt = null, reapAt = null, parentEnd;
  if (order === "parent-first") {
    const P = 3, C = 7;
    parentEnd = P;
    parentSeg.push([0, P, "run"]);
    childSeg.push([0, P, "run"], [P, C, "orphan"]);
    reparentAt = P;
    ev.push([P, "parent 100 exits first → child 101 is an ORPHAN, adopted by PID 1 (PPID 100 → 1)"]);
    ev.push([C, "orphan 101 exits → zombie; its parent is now PID 1"]);
    if (pid1 === "init") {
      reapAt = C + 0.3;
      childSeg.push([C, reapAt, "zombie"]);
      ev.push([reapAt, "PID 1 calls wait() → zombie reaped, PID 101 is free"]);
    } else {
      childSeg.push([C, END, "zombie"]);
      ev.push([C + 0.05, "PID 1 is your app and never calls wait() → zombie forever"]);
    }
  } else {
    const C = 3;
    const P = parent === "server" ? null : 8;
    parentEnd = P ?? END;
    parentSeg.push([0, parentEnd, "run"]);
    childSeg.push([0, C, "run"]);
    if (parent === "ignore") {
      reapAt = C;
      ev.push([C, "child exits; SIGCHLD is SIG_IGN → kernel frees it at once, no zombie"]);
    } else if (parent === "handler") {
      reapAt = C + 0.3;
      childSeg.push([C, reapAt, "zombie"]);
      ev.push([C, "child exits → zombie; kernel sends SIGCHLD to parent"]);
      ev.push([reapAt, "handler runs waitpid(-1, …, WNOHANG) loop → reaped"]);
    } else if (parent === "wait") {
      reapAt = 6;
      childSeg.push([C, 6, "zombie"]);
      ev.push([C, "child calls exit(42) → zombie, holding status 42 for its parent"]);
      ev.push([6, "parent calls wait() → gets exit code 42, zombie reaped"]);
    } else if (parent === "never") {
      ev.push([C, "child calls exit(42) → zombie; parent is busy and never waits"]);
      reparentAt = P;
      ev.push([P, "parent exits without waiting → zombie adopted by PID 1 (PPID 100 → 1)"]);
      if (pid1 === "init") {
        reapAt = P + 0.3;
        childSeg.push([C, reapAt, "zombie"]);
        ev.push([reapAt, "PID 1 reaps it → PID 101 free"]);
      } else {
        childSeg.push([C, END, "zombie"]);
        ev.push([P + 0.05, "new parent (your app as PID 1) never waits → stuck forever"]);
      }
    } else {
      childSeg.push([C, END, "zombie"]);
      ev.push([C, "child exits → zombie; the server never calls wait()"]);
      ev.push([C + 0.05, "it stays a zombie as long as the server runs"]);
    }
    if (P !== null && parent !== "never") ev.push([P, "parent 100 exits"]);
  }
  ev.sort((a, b) => a[0] - b[0]);
  return { parentSeg, childSeg, ev, reparentAt, reapAt, parentEnd };
}

const X0 = 110, SCALE = 48;
const X = (s) => X0 + s * SCALE;
const COLORS = { run: "#3b82f6", orphan: "#e8590c", zombie: "#d6336c" };
const LABEL = { run: "running", orphan: "ORPHAN", zombie: "ZOMBIE" };

function segAt(segs, time) {
  return segs.find(([a, b]) => time >= a && (time < b || (b === END && time <= END))) || null;
}

function render() {
  const m = model();
  parentSel.disabled = order === "parent-first";
  slider.value = String(t);
  tLabel.textContent = `t = ${t.toFixed(1)} s`;

  let s = `<svg viewBox="0 0 600 200" width="100%" style="max-width:640px" font-family="sans-serif" font-size="12">`;
  const lanes = [["PID 1", pid1 === "init" ? "init" : "your app", 30], ["parent", "PID 100", 80], ["child", "PID 101", 130]];
  for (const [a, b, y] of lanes) {
    s += `<text x="8" y="${y + 4}" fill="var(--text-normal)" font-weight="bold">${a}</text><text x="8" y="${y + 18}" fill="var(--text-muted)" font-size="11">${b}</text>`;
  }
  s += `<rect x="${X0}" y="20" width="${X(END) - X0}" height="22" rx="4" fill="#2b8a3e" fill-opacity="0.8"/>`;
  s += `<text x="${(X0 + X(END)) / 2}" y="35" text-anchor="middle" fill="white">${pid1 === "init" ? "calls wait() in a loop forever" : "never calls wait() for adopted children"}</text>`;
  for (const [a, b, k] of m.parentSeg) {
    s += `<rect x="${X(a)}" y="70" width="${X(b) - X(a)}" height="22" rx="4" fill="${COLORS[k]}" fill-opacity="0.85"/>`;
    if (b < END) s += `<text x="${X(b) + 4}" y="85" fill="var(--text-muted)">exits</text>`;
  }
  for (const [a, b, k] of m.childSeg) {
    const w = X(b) - X(a);
    s += `<rect x="${X(a)}" y="120" width="${w}" height="22" rx="4" fill="${COLORS[k]}" fill-opacity="0.85"/>`;
    if (w > 55) s += `<text x="${X(a) + w / 2}" y="135" text-anchor="middle" fill="white" font-weight="bold">${LABEL[k]}</text>`;
  }
  if (m.reapAt !== null) s += `<text x="${X(m.reapAt) + 4}" y="135" fill="var(--text-muted)">reaped ✓</text>`;
  if (m.reparentAt !== null) {
    s += `<line x1="${X(m.reparentAt)}" y1="118" x2="${X(m.reparentAt)}" y2="44" stroke="#9c36b5" stroke-width="2" stroke-dasharray="5 3"/>`;
    s += `<text x="${X(m.reparentAt) + 4}" y="112" fill="#9c36b5" font-weight="bold">adopted</text>`;
  }
  if (order === "child-first" && parent === "wait") {
    s += `<line x1="${X(6)}" y1="94" x2="${X(6)}" y2="118" stroke="#e8590c" stroke-width="2" stroke-dasharray="4 3"/>`;
    s += `<text x="${X(6)}" y="64" text-anchor="middle" fill="#e8590c" font-weight="bold">wait()</text>`;
  }
  s += `<line x1="${X0}" y1="165" x2="${X(END)}" y2="165" stroke="var(--text-faint)"/>`;
  for (let i = 0; i <= END; i += 2) s += `<text x="${X(i)}" y="180" text-anchor="middle" fill="var(--text-muted)" font-size="11">${i}s</text>`;
  s += `<line x1="${X(t)}" y1="12" x2="${X(t)}" y2="168" stroke="var(--text-normal)" stroke-width="1.5" stroke-dasharray="2 2"/>`;
  s += `</svg>`;
  svgWrap.innerHTML = s;

  // ps output at time t
  const pad = (v, n) => String(v).padStart(n);
  let ps = `  PID  PPID STAT CMD\n${pad(1, 5)} ${pad(0, 5)} S    ${pid1 === "init" ? "/sbin/init" : "node app.js   (your app)"}\n`;
  if (t < m.parentEnd || (m.parentEnd === END && t <= END)) ps += `${pad(100, 5)} ${pad(50, 5)} S    ./parent\n`;
  const seg = segAt(m.childSeg, t);
  if (seg) {
    const ppid = m.reparentAt !== null && t >= m.reparentAt ? 1 : 100;
    ps += seg[2] === "zombie" ? `${pad(101, 5)} ${pad(ppid, 5)} Z    [child] <defunct>` : `${pad(101, 5)} ${pad(ppid, 5)} S    ./child`;
  } else if (t > 0) {
    ps += "  (101 is gone: reaped, PID free)";
  }
  psBox.textContent = `$ ps -o pid,ppid,stat,cmd   (t = ${t.toFixed(1)} s)\n` + ps;

  const past = m.ev.filter(([et]) => et <= t + 1e-9);
  narr.textContent = past.length ? `t = ${past[past.length - 1][0].toFixed(1)} s · ${past[past.length - 1][1]}` : "";

  const z = m.childSeg.filter((x) => x[2] === "zombie");
  const zTime = z.reduce((acc, [a, b]) => acc + (b - a), 0);
  const forever = z.some(([, b]) => b === END);
  verdict.textContent = forever
    ? `🧟 Zombie from t = ${z[0][0]} s and never reaped (still Z at 10 s)`
    : zTime > 0
      ? `🧟 Zombie for ${zTime.toFixed(1)} s, then reaped ✓`
      : "✨ No zombie phase at all";
  verdict.style.color = forever ? "#d6336c" : "var(--text-normal)";
}

// ---------- interaction ----------
let playing = false;
function stop() { playing = false; playBtn.textContent = "▶ Play"; }
playBtn.onclick = () => {
  if (playing) return stop();
  if (t >= END) t = 0;
  playing = true;
  playBtn.textContent = "⏸ Pause";
  const timer = setInterval(() => {
    if (!root.isConnected || !playing) { clearInterval(timer); return; }
    t = Math.min(END, Math.round((t + 0.1) * 10) / 10);
    render();
    if (t >= END) { clearInterval(timer); stop(); }
  }, 100);
};
slider.oninput = () => { stop(); t = Number(slider.value); render(); };
orderSel.onchange = () => { order = orderSel.value; render(); };
parentSel.onchange = () => { parent = parentSel.value; render(); };
pid1Sel.onchange = () => { pid1 = pid1Sel.value; render(); };

render();
