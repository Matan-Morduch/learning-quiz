// bsm-stepper: "will this script stop?" Step through a small bash script line by line,
// with set -e / set -u / pipefail toggles. Shows each line's output, $?, and where (and why) the script stops.
// input: { script?: "deploy"|"holes"|"pipes" = "deploy", e?: false, u?: false, pipefail?: false, run?: false (run to the end at start) }

const opts = (typeof input === "object" && input) || {};
const SCRIPTS = {
  deploy: {
    title: "🚀 deploy.sh (VERSION was never set)",
    lines: [
      { code: "cd /srv/app", rc: 0, out: "" },
      { code: "git pull 2>&1 | tee pull.log", rc: 0, pipeRc: 128, out: "fatal: not a git repository", why: "git failed (128), but tee succeeded (0)" },
      { code: 'echo "Deploying version $VERSION"', rc: 0, unset: "VERSION", out: "Deploying version " },
      { code: "cp -r build/* /var/www/", rc: 1, out: "cp: cannot stat 'build/*': No such file or directory" },
      { code: 'echo "Deploy finished ✅"', rc: 0, out: "Deploy finished ✅" },
    ],
  },
  holes: {
    title: "🕳️ holes.sh: where set -e does NOT stop",
    lines: [
      { code: "if grep -q admin users.txt; then echo has-admin; fi", rc: 0, out: "", why: "grep returned 1, but it's an if condition: ignored. An if with no branch taken returns 0" },
      { code: 'false && echo "never printed"', rc: 1, exempt: "false is on the LEFT of &&: ignored" },
      { code: "! true", rc: 1, exempt: "the command is negated with !: ignored" },
      { code: "f() { local x=$(false); }; f", rc: 0, out: "", why: "$(false) failed, but `local` itself succeeded (0) and hid it" },
      { code: "count=0; ((count++))", rc: 1, out: "", why: "count++ returns the OLD value 0, and (( 0 )) means exit status 1 (bash ≥ 4.1)" },
      { code: 'echo "reached the end"', rc: 0, out: "reached the end" },
    ],
  },
  pipes: {
    title: "🚰 pipes.sh: pipefail catches real errors and false alarms",
    lines: [
      { code: "grep ERROR app.log | wc -l", rc: 0, pipeRc: 1, out: "0", why: "no ERROR lines → grep exits 1 (no match). wc exits 0" },
      { code: "yes | head -n 1", rc: 0, pipeRc: 141, out: "y", why: "head quit, yes got SIGPIPE → 128 + 13 = 141" },
      { code: "sort data.csv | uniq -c", rc: 0, pipeRc: 2, out: "sort: cannot read: data.csv: No such file or directory", why: "sort failed (2), uniq succeeded (0)" },
      { code: 'echo "all done"', rc: 0, out: "all done" },
    ],
  },
};
const key = SCRIPTS[opts.script] ? opts.script : "deploy";

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

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const sel = el("select", "", null, bar);
for (const k of Object.keys(SCRIPTS)) { const o = el("option", "", SCRIPTS[k].title, sel); o.value = k; }
sel.value = key;
const flags = {};
for (const [f, label] of [["e", "set -e"], ["u", "set -u"], ["pipefail", "pipefail"]]) {
  const lab = el("label", "display:flex;gap:3px;align-items:center;font-family:var(--font-monospace);font-size:13px;", null, bar);
  const cb = el("input", "", null, lab); cb.type = "checkbox"; cb.checked = !!opts[f];
  el("span", "", label, lab);
  flags[f] = cb;
}
const btns = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const stepBtn = el("button", "", "▶ Step", btns);
const runBtn = el("button", "", "⏩ Run all", btns);
const resetBtn = el("button", "", "↺ Reset", btns);

const header = el("div", "font-family:var(--font-monospace);font-size:12px;color:var(--text-muted);");
const codeBox = el("div", "font-family:var(--font-monospace);font-size:13px;border-radius:6px;background:var(--background-secondary);padding:6px;");
const termTitle = el("div", "font-size:12px;color:var(--text-muted);margin-top:8px;", "terminal output:");
const term = el("div", "font-family:var(--font-monospace);font-size:13px;white-space:pre-wrap;border-radius:6px;border:1px solid var(--background-modifier-border);padding:6px;min-height:2.6em;");
const narr = el("div", "margin-top:8px;min-height:2.6em;");

let pc, status, out, done, lastQ, notes;

function reset() {
  pc = 0; status = []; out = []; done = null; lastQ = 0; notes = "Press ▶ Step. Toggle flags and reset to compare.";
  render();
}

function step() {
  if (done) return;
  const L = SCRIPTS[sel.value].lines[pc];
  const f = { e: flags.e.checked, u: flags.u.checked, p: flags.pipefail.checked };
  if (L.unset && f.u) {
    out.push(`deploy.sh: line ${pc + 1}: ${L.unset}: unbound variable`);
    status[pc] = { rc: 1, stop: true };
    lastQ = 1;
    done = `🛑 set -u: $${L.unset} is not set → bash stops with exit status 1.`;
    notes = done; pc++; return render();
  }
  const rc = L.pipeRc != null && f.p ? L.pipeRc : L.rc;
  if (L.out) out.push(L.out);
  lastQ = rc;
  let msg = `$? = ${rc}`;
  if (L.pipeRc != null) msg += f.p ? ` (pipefail: rightmost failing command → ${L.pipeRc})` : ` (no pipefail: only the LAST command counts → ${L.rc})`;
  if (L.why) msg += `. ${L.why}.`;
  if (L.unset && !f.u) msg += ` ⚠️ $${L.unset} is unset → silently became "" (empty).`;
  const stop = rc !== 0 && f.e && !L.exempt;
  status[pc] = { rc, stop, exempt: rc !== 0 && L.exempt };
  if (rc !== 0 && L.exempt) msg += ` ${f.e ? "set -e does not stop: " : ""}${L.exempt}.`;
  pc++;
  if (stop) done = `🛑 set -e: line ${pc} failed with status ${rc} → script exits with ${rc}.`;
  else if (pc >= SCRIPTS[sel.value].lines.length) done = `🏁 reached the end. Script exit status = ${rc} (status of the last command).`;
  notes = done ? `${msg}<br><b>${done}</b>` : msg;
  render();
}

function render() {
  const lines = SCRIPTS[sel.value].lines;
  const hdr = ["#!/usr/bin/env bash"];
  const on = [flags.e.checked && "e", flags.u.checked && "u"].filter(Boolean).join("");
  if (on || flags.pipefail.checked) hdr.push(`set ${on ? "-" + on : ""}${flags.pipefail.checked ? (on ? " -o pipefail" : "-o pipefail") : ""}`);
  header.textContent = hdr.join("   ·   ");
  codeBox.innerHTML = "";
  lines.forEach((L, i) => {
    const s = status[i];
    const row = el("div", "display:flex;gap:8px;padding:2px 4px;border-radius:4px;" + (i === pc && !done ? "outline:2px solid var(--interactive-accent);" : ""), null, codeBox);
    el("span", "color:var(--text-faint);min-width:1.2em;", String(i + 1), row);
    const c = el("span", "flex:1;" + (s ? "" : done ? "opacity:0.4;" : ""), L.code, row);
    if (done && !s) c.textContent += "   ← never runs";
    let badge = "", col = "var(--text-faint)";
    if (s) { badge = s.stop ? `✗ ${s.rc} STOP` : s.exempt ? `${s.rc} ignored` : s.rc ? `✗ ${s.rc}` : "✓ 0"; col = s.stop ? "#d6336c" : s.rc ? "#e8590c" : "#2b8a3e"; }
    el("span", `color:${col};font-weight:bold;white-space:nowrap;`, badge, row);
  });
  term.textContent = out.length ? out.join("\n") : "(nothing yet)";
  narr.innerHTML = notes;
  stepBtn.disabled = runBtn.disabled = !!done;
}

stepBtn.onclick = step;
runBtn.onclick = () => { let guard = 20; while (!done && guard--) step(); };
resetBtn.onclick = reset;
sel.onchange = reset;
for (const cb of Object.values(flags)) cb.onchange = reset;
reset();
if (opts.run) runBtn.onclick();
