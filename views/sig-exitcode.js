// sig-exitcode: decode shell / Docker exit codes. Killed by signal N → 128 + N, and back again.
// input: { code?: exit code to decode at start (default 137) }

const opts = (typeof input === "object" && input) || {};
const SIG = {
  1: ["SIGHUP", "terminal closed (or 'reload config')"],
  2: ["SIGINT", "Ctrl-C"],
  3: ["SIGQUIT", "Ctrl-\\ (quit + core dump)"],
  6: ["SIGABRT", "abort(): failed assert"],
  9: ["SIGKILL", "kill -9, OOM killer, grace period ran out"],
  11: ["SIGSEGV", "segmentation fault: bad memory access"],
  13: ["SIGPIPE", "wrote to a pipe nobody reads"],
  14: ["SIGALRM", "alarm() timer"],
  15: ["SIGTERM", "kill / docker stop with no handler"],
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

const row = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;");
el("span", "", "Exit code:", row);
const inp = el("input", "width:70px;", null, row);
inp.type = "number"; inp.min = "0"; inp.max = "255";
inp.value = String(opts.code ?? 137);
const chips = el("div", "display:flex;gap:4px;flex-wrap:wrap;", null, row);
for (const c of [0, 1, 124, 130, 137, 139, 141, 143]) {
  const b = el("button", "", String(c), chips);
  b.onclick = () => { inp.value = String(c); draw(); };
}
const out = el("div", "margin-top:10px;padding:10px;border-radius:6px;background:var(--background-secondary);line-height:1.6;");
const table = el("div", "margin-top:10px;display:flex;gap:4px;flex-wrap:wrap;");

function draw() {
  const c = Math.round(+inp.value);
  let h;
  if (!(c >= 0 && c <= 255)) h = "Exit codes are 0–255 (8 bits).";
  else if (c === 0) h = "<b>0</b> = success. If a program caught SIGTERM and then called <code>exit(0)</code>, you see 0 too.";
  else if (c === 124) h = "<b>124</b> = GNU <code>timeout</code>'s own code: \"the command timed out\" (its SIGTERM worked).";
  else if (c > 128 && c < 128 + 65) {
    const n = c - 128, s = SIG[n];
    h = `<div style="font-family:var(--font-monospace);font-size:16px;">${c} − 128 = <b>${n}</b> → <b style="color:#d6336c">${s ? s[0] : "signal " + n}</b></div>` +
        `<div>Killed by a signal: the process didn't return a number; the shell reports 128 + N.</div>` +
        (s ? `<div style="color:var(--text-muted)">Usually: ${s[1]}</div>` : "");
  } else h = `<b>${c}</b> ≤ 128: the program <b>chose</b> this number itself (<code>exit(${c})</code>). Not a signal.`;
  out.innerHTML = h;
  table.innerHTML = Object.entries(SIG).map(([n, s]) => {
    const hit = c - 128 === +n;
    return `<div style="padding:3px 7px;border-radius:5px;font-family:var(--font-monospace);font-size:12px;border:1px solid ${hit ? "#d6336c" : "var(--background-modifier-border)"};${hit ? "background:#d6336c;color:white;" : ""}">${128 + +n} = 128+${n} ${s[0].slice(3)}</div>`;
  }).join("");
}
inp.oninput = draw;
draw();
