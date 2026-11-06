// bvq-env: shell variables vs environment variables. A child process (bash -c, python, any program)
// gets a COPY of only the exported variables. Changes in the child never flow back to the parent.
// input: { exported?: ["HOME"], show?: "city" }

const opts = (typeof input === "object" && input) || {};
const exportedInit = Array.isArray(opts.exported) ? opts.exported : ["HOME"];
let vars, child, log, busy = false;
function reset() {
  vars = [
    { name: "HOME", value: "/home/matan", exp: true },
    { name: "city", value: "Haifa", exp: false },
    { name: "count", value: "3", exp: false },
  ].map((v) => ({ ...v, exp: v.name === "HOME" || exportedInit.includes(v.name) }));
  child = null;
  log = "Two shell variables, one exported (HOME). Try running the child before and after export.";
}
const watch = typeof opts.show === "string" ? opts.show : "city";

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
const mono = "font-family:var(--font-monospace);";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ctl = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
const bExp = el("button", mono + "font-size:12px;", `export ${watch}`, ctl);
const bRun = el("button", mono + "font-size:12px;", `bash -c 'echo "[$${watch}]"'`, ctl);
const bOne = el("button", mono + "font-size:12px;", `${watch}=Eilat bash -c 'echo "[$${watch}]"'`, ctl);
const bSet = el("button", mono + "font-size:12px;", `bash -c '${watch}=Tokyo'`, ctl);
const bReset = el("button", "font-size:12px;", "↺ Reset", ctl);
const stage = el("div", "display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;align-items:flex-start;");
const out = el("div", mono + "font-size:13px;margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);min-height:2.6em;");

function card(title, list, highlight) {
  const rows = list.map((v) => `<div style="${mono}font-size:13px;padding:2px 4px;border-radius:4px;${v.name === highlight ? "background:rgba(59,130,246,.15);" : ""}">
    ${v.exp ? "🌍" : "🏠"} ${esc(v.name)}=${esc(v.value)} <span style="font-size:11px;color:var(--text-muted);">${v.exp ? "exported (environment)" : "shell only"}</span></div>`).join("");
  return `<div style="min-width:240px;flex:1;border:2px solid var(--background-modifier-border);border-radius:8px;padding:8px;">
    <div style="font-weight:bold;margin-bottom:4px;">${title}</div>${rows || "<i style='color:var(--text-muted)'>(no variables)</i>"}</div>`;
}
function render() {
  const childHtml = child
    ? card(`👶 child process (PID ${child.pid})`, child.vars, watch)
    : `<div style="min-width:240px;flex:1;border:2px dashed var(--background-modifier-border);border-radius:8px;padding:8px;color:var(--text-muted);">👶 no child yet. A child is made by fork() + exec(), and gets a copy of the <b>environment</b> only.</div>`;
  stage.innerHTML = card("🐚 your shell (PID 4100)", vars, watch) + childHtml;
  out.innerHTML = log;
  const v = vars.find((x) => x.name === watch);
  bExp.disabled = busy || (v && v.exp);
}
function spawn(extra) {
  // the child's environment = exported vars (+ one-shot assignment), copied
  const env = vars.filter((v) => v.exp).map((v) => ({ ...v }));
  if (extra) { const i = env.findIndex((v) => v.name === extra.name); if (i >= 0) env[i] = extra; else env.push(extra); }
  return { pid: 4100 + Math.floor(Math.random() * 800) + 1, vars: env };
}
bExp.onclick = () => {
  const v = vars.find((x) => x.name === watch);
  if (v) { v.exp = true; log = `export ${watch} → ${watch} is now in the environment. Future children get a copy.`; }
  render();
};
bRun.onclick = () => {
  child = spawn(null);
  const got = child.vars.find((v) => v.name === watch);
  log = `$ bash -c 'echo "[$${watch}]"'<br>[${got ? esc(got.value) : ""}]<br>` +
    (got ? `✅ ${watch} was exported, so the child got a copy.` : `❌ empty: ${watch} is a shell variable, not exported. The child never saw it.`);
  render();
};
bOne.onclick = () => {
  child = spawn({ name: watch, value: "Eilat", exp: true });
  const mine = vars.find((v) => v.name === watch);
  log = `$ ${watch}=Eilat bash -c 'echo "[$${watch}]"'<br>[Eilat]<br>🎯 A one-shot assignment puts ${watch}=Eilat in THIS child's environment only. Your shell still has ${watch}=${esc(mine ? mine.value : "")}.`;
  render();
};
bSet.onclick = () => {
  if (busy) return;
  busy = true;
  child = spawn(null);
  const c = child.vars.find((v) => v.name === watch);
  if (c) c.value = "Tokyo"; else child.vars.push({ name: watch, value: "Tokyo", exp: false });
  log = `the child sets ${watch}=Tokyo…`;
  render();
  setTimeout(() => {
    if (!root.isConnected) return;
    const mine = vars.find((v) => v.name === watch);
    child = null; busy = false;
    log = `child exited. Your shell: ${watch}=${esc(mine.value)} (unchanged). 🔒 A child can never change its parent's variables. That's why <b>cd</b> and <b>export</b> must be shell builtins.`;
    render();
  }, 1400);
};
bReset.onclick = () => { if (!busy) { reset(); render(); } };
reset();
render();
