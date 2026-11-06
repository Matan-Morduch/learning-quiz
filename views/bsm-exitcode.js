// bsm-exitcode: exit N is stored in 8 bits (N mod 256), and what the common codes mean
// (0, 1, 2, 126, 127, 128+N = killed by signal N).
// input: { n?: number passed to `exit` = 300 }

const opts = (typeof input === "object" && input) || {};
const SIGS = { 1: "SIGHUP", 2: "SIGINT (Ctrl-C)", 3: "SIGQUIT", 6: "SIGABRT", 9: "SIGKILL", 11: "SIGSEGV", 13: "SIGPIPE", 14: "SIGALRM", 15: "SIGTERM" };
let n = Number.isFinite(Number(opts.n)) ? Math.trunc(Number(opts.n)) : 300;

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

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;font-family:var(--font-monospace);");
el("span", "", "exit", bar);
const inp = el("input", "width:6em;", null, bar); inp.type = "number"; inp.value = String(n);
const presets = el("div", "display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;");
for (const p of [0, 1, 2, 126, 127, 130, 137, 143, 256, 300, -1]) {
  const b = el("button", "font-family:var(--font-monospace);", String(p), presets);
  b.onclick = () => { inp.value = String(p); n = p; render(); };
}
const bits = el("div", "display:flex;gap:2px;flex-wrap:wrap;margin:6px 0;font-family:var(--font-monospace);");
const out = el("div", "padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;");

function meaning(c) {
  if (c === 0) return "✅ success (the only success code)";
  if (c === 1) return "general error";
  if (c === 2) return "misuse / syntax error (e.g. bash -n on a broken script)";
  if (c === 126) return "found, but not executable (permission denied)";
  if (c === 127) return "command not found";
  if (c > 128 && c < 160) return `killed by signal ${c - 128}${SIGS[c - 128] ? " = " + SIGS[c - 128] : ""}  (128 + ${c - 128})`;
  return "an error code the program chose";
}

function render() {
  const c = ((n % 256) + 256) % 256;
  bits.innerHTML = "";
  for (let i = 7; i >= 0; i--) {
    const on = (c >> i) & 1;
    el("span", `display:inline-block;width:1.8em;text-align:center;padding:3px 0;border-radius:4px;border:1px solid var(--background-modifier-border);${on ? "background:var(--interactive-accent);color:var(--text-on-accent);" : ""}`, String(on), bits);
  }
  const wrap = n !== c ? `${n} doesn't fit in 8 bits → keep the low 8 bits: ${n} mod 256 = ${c}` : `${n} fits in 8 bits (0–255)`;
  out.innerHTML = `${wrap}<br>echo $?  →  <b>${c}</b><br>meaning: ${meaning(c)}`;
}

inp.oninput = () => { const v = Math.trunc(Number(inp.value)); if (Number.isFinite(v)) { n = v; render(); } };
render();
