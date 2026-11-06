// bsm-andor: the `A && B || C` trap. Toggle whether A and B succeed, see which commands run,
// and compare with a real `if A; then B; else C; fi`.
// input: { a?: 0, b?: 1 }  (exit codes; default shows the trap: A ok, B fails → C runs anyway)

const opts = (typeof input === "object" && input) || {};
let a = opts.a ? 1 : 0, b = opts.b === 0 ? 0 : opts.b ? 1 : 1;

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

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;");
const aBtn = el("button", "", "", bar);
const bBtn = el("button", "", "", bar);
const rows = el("div", "display:grid;grid-template-columns:1fr;gap:8px;");
const verdict = el("div", "margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);");

function chip(parent, name, state) {
  // state: "ok" | "fail" | "skip"
  const col = state === "ok" ? "#2b8a3e" : state === "fail" ? "#d6336c" : "var(--text-faint)";
  const label = state === "ok" ? "ran ✓0" : state === "fail" ? "ran ✗1" : "skipped";
  const c = el("span", `display:inline-block;padding:3px 8px;margin:2px;border-radius:6px;border:2px solid ${col};color:${col};font-family:var(--font-monospace);${state === "skip" ? "border-style:dashed;" : ""}`, `${name}: ${label}`, parent);
  return c;
}

function render() {
  aBtn.textContent = `A ${a ? "fails ✗" : "succeeds ✓"}`;
  bBtn.textContent = `B ${b ? "fails ✗" : "succeeds ✓"}`;
  rows.innerHTML = "";
  // chain: A && B || C
  const r1 = el("div", "", null, rows);
  el("div", "font-family:var(--font-monospace);font-weight:bold;", "A && B || C", r1);
  const bRuns = a === 0;
  const leftStatus = a !== 0 ? a : b; // status of `A && B`
  const cRunsChain = leftStatus !== 0;
  chip(r1, "A", a ? "fail" : "ok");
  chip(r1, "B", bRuns ? (b ? "fail" : "ok") : "skip");
  chip(r1, "C", cRunsChain ? "ok" : "skip");
  el("div", "font-size:12px;color:var(--text-muted);", `A && B → status ${leftStatus} → ${cRunsChain ? "non-zero, so || runs C" : "0, so || skips C"}`, r1);
  // if/else
  const r2 = el("div", "", null, rows);
  el("div", "font-family:var(--font-monospace);font-weight:bold;", "if A; then B; else C; fi", r2);
  chip(r2, "A", a ? "fail" : "ok");
  chip(r2, "B", a === 0 ? (b ? "fail" : "ok") : "skip");
  chip(r2, "C", a !== 0 ? "ok" : "skip");
  el("div", "font-size:12px;color:var(--text-muted);", `only A decides: A ${a ? "failed → else → C" : "succeeded → then → B (C never runs)"}`, r2);
  const same = cRunsChain === (a !== 0);
  verdict.innerHTML = same
    ? "✅ Same result here. The difference only shows when A succeeds and B fails."
    : "⚠️ <b>Different!</b> A succeeded, B failed, so the chain ALSO ran C. Both B and C ran: `&& ||` is not if/else.";
}

aBtn.onclick = () => { a = a ? 0 : 1; render(); };
bBtn.onclick = () => { b = b ? 0 : 1; render(); };
render();
