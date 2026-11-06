// bcf-scope: step through bash function calls and watch where each variable lives.
// Frames are stacked (innermost on top, global at the bottom). A lookup searches from the top frame down:
// that's bash's DYNAMIC scoping. Toggle `local` to see the fix.
// input: { scenario?: "loop" | "dynamic" | "capture" (default "loop"), local?: boolean (default false) }

const opts = (typeof input === "object" && input) || {};
const SCEN = {
  loop: {
    title: "🐛 The loop-variable bug",
    code: [
      "print_row() {",
      "  local i                     # ← the fix",
      "  for ((i=0; i<3; i++)); do printf '*'; done; echo",
      "}",
      "for ((i=0; i<3; i++)); do",
      '  echo "row $i"',
      "  print_row",
      "done",
    ],
    localLine: 1,
  },
  dynamic: {
    title: "🔭 Dynamic scoping: callees see the caller's locals",
    code: [
      "x=global",
      "inner() {",
      '  echo "inner sees x=$x"',
      "  x=changed-by-inner",
      "}",
      "outer() {",
      "  local x=outer-local         # ← try with and without",
      "  inner",
      '  echo "outer after inner: x=$x"',
      "}",
      "outer",
      'echo "global after: x=$x"',
    ],
    localLine: 6,
  },
  capture: {
    title: "📦 $( ) runs in a subshell: changes are thrown away",
    code: [
      "count=0",
      'inc() { count=$((count+1)); echo "$count"; }',
      "x=$(inc)                      # runs in a COPY of the shell",
      'echo "x=$x count=$count"',
      "inc                           # runs in THIS shell",
      'echo "count=$count"',
    ],
    localLine: -1,
  },
};
let scen = SCEN[opts.scenario] ? opts.scenario : "loop";
let useLocal = !!opts.local;

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

const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const scenBtns = Object.entries(SCEN).map(([k, s]) => {
  const b = el("button", "", s.title.split(":")[0], top);
  b.onclick = () => { scen = k; reset(); };
  return [k, b];
});
const ctl = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const localLbl = el("label", "display:flex;gap:4px;align-items:center;", null, ctl);
const localBox = el("input", "", null, localLbl);
localBox.type = "checkbox";
el("span", mono, "use local", localLbl);
localBox.onchange = () => { useLocal = localBox.checked; reset(); };
const stepBtn = el("button", "", "▶ Step", ctl);
const playBtn = el("button", "", "⏩ Run to end", ctl);
const resetBtn = el("button", "", "↺ Reset", ctl);

const titleEl = el("div", "font-weight:bold;margin-bottom:4px;");
const body = el("div", "display:flex;gap:10px;flex-wrap:wrap;");
const codeEl = el("div", mono + "flex:1 1 300px;font-size:12px;border-radius:6px;background:var(--background-secondary);padding:6px;white-space:pre;overflow-x:auto;", null, body);
const side = el("div", "flex:1 1 220px;", null, body);
el("div", "font-size:12px;color:var(--text-muted);", "Call stack (lookups search top → down):", side);
const stackEl = el("div", "display:flex;flex-direction:column;gap:4px;margin:4px 0 8px;", null, side);
el("div", "font-size:12px;color:var(--text-muted);", "Output:", side);
const outEl = el("div", mono + "font-size:12px;white-space:pre;min-height:3em;padding:6px;border-radius:6px;background:var(--background-secondary);", null, side);
const narr = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;min-height:2.6em;");

// ---------- tiny bash-like runtime ----------
let frames, out, gen, line, hl, done;
function find(name) {
  for (let k = frames.length - 1; k >= 0; k--) if (name in frames[k].vars) return k;
  return -1;
}
function get(name) { const k = find(name); hl = { frame: k, name }; return k < 0 ? "" : frames[k].vars[name]; }
function set(name, val) {
  let k = find(name);
  if (k < 0) k = 0;                        // not found anywhere → becomes a global
  frames[k].vars[name] = val; hl = { frame: k, name };
  return k;
}
function where(k) { return k === 0 ? "the global" : `${frames[k].name}'s`; }

function* runLoop() {
  // body of print_row as a generator
  function* printRow() {
    frames.push({ name: "print_row()", vars: {} });
    if (useLocal) { line = 1; frames[frames.length - 1].vars.i = ""; hl = { frame: frames.length - 1, name: "i" }; yield "local i creates a NEW i inside print_row's frame. The loop below will use this one."; }
    let stars = "";
    line = 2; let k = set("i", 0); yield `i=0 → no new frame variable, so it writes ${where(k)} i.`;
    while (Number(get("i")) < 3) {
      stars += "*"; out[out.length - 1] += "*";
      k = set("i", Number(get("i")) + 1);
      line = 2; yield `printf '*', then i++ → i is now ${frames[k].vars.i} in ${where(k)} frame.`;
    }
    out.push("");
    line = 3; frames.pop(); hl = null;
    yield `print_row returns. Its frame is gone${useLocal ? " (and its local i with it)" : ""}.`;
  }
  line = 4; set("i", 0); yield "Main loop: i=0 (a global).";
  while (true) {
    line = 4;
    const iv = Number(get("i"));
    if (!(iv < 3)) { yield `Check i<3 → ${iv}<3 is false → the loop ends.${useLocal ? "" : " 😱 Only one row printed! print_row reused the same global i."}`; break; }
    line = 5; out[out.length - 1] = `row ${iv}`; out.push(""); yield `echo "row ${iv}"`;
    line = 6; yield* printRow();
    line = 4; const k = set("i", Number(get("i")) + 1); yield `i++ → global i is now ${frames[k].vars.i}.`;
  }
}

function* runDynamic() {
  line = 0; set("x", "global"); yield "x=global creates a global x.";
  line = 10; frames.push({ name: "outer()", vars: {} }); hl = null; yield "Call outer: a new frame goes on the stack.";
  if (useLocal) { line = 6; frames[1].vars.x = "outer-local"; hl = { frame: 1, name: "x" }; yield "local x=outer-local: a new x in outer's frame. It hides the global x."; }
  line = 7; frames.push({ name: "inner()", vars: {} }); hl = null; yield "outer calls inner: another frame on top.";
  line = 2; let v = get("x"); let k = hl.frame; out.push(`inner sees x=${v}`);
  yield `inner reads $x: it searches inner (none) → ${k === 1 ? "outer: found it! inner sees outer's LOCAL. That's dynamic scoping: what you see depends on who called you." : "outer (none) → global."}`;
  line = 3; k = set("x", "changed-by-inner"); yield `x=changed-by-inner writes the nearest x: ${where(k)} one.`;
  line = 4; frames.pop(); hl = null; yield "inner returns.";
  line = 8; v = get("x"); out.push(`outer after inner: x=${v}`); yield `outer prints its x: ${v}.`;
  line = 9; frames.pop(); hl = null; yield `outer returns${useLocal ? ": its local x disappears" : ""}.`;
  line = 11; v = get("x"); out.push(`global after: x=${v}`); yield useLocal ? "The global x was never touched ✅." : "No local anywhere → every x was the global one. inner changed it for everyone ⚠️.";
}

function* runCapture() {
  line = 0; set("count", 0); yield "count=0 (global).";
  line = 2; const copy = JSON.parse(JSON.stringify(frames[0].vars));
  frames.push({ name: "subshell (a copy)", vars: copy, sub: true }); hl = null;
  yield "$( ) starts a SUBSHELL: a separate child process with a copy of all variables.";
  line = 1; frames[1].vars.count = frames[1].vars.count + 1; hl = { frame: 1, name: "count" }; yield `inc runs in the copy: count=${frames[1].vars.count} in the copy only. echo "1" goes into the capture.`;
  line = 2; frames.pop(); frames[0].vars.x = "1"; hl = { frame: 0, name: "x" }; yield "The subshell exits. Its copy is thrown away. Only its OUTPUT survives: x=1.";
  line = 3; out.push(`x=1 count=${frames[0].vars.count}`); yield "count is still 0! Changes made inside $( ) never come back.";
  line = 4; frames[0].vars.count += 1; hl = { frame: 0, name: "count" }; out.push("1"); yield "Calling inc directly runs it in THIS shell: count really becomes 1 (and it prints 1).";
  line = 5; out.push(`count=${frames[0].vars.count}`); yield "To get data out AND keep changes: use a global, or local -n (bash 4.3+).";
}

function reset() {
  frames = [{ name: "global", vars: {} }];
  out = [""]; hl = null; line = -1; done = false;
  gen = { loop: runLoop, dynamic: runDynamic, capture: runCapture }[scen]();
  localBox.checked = useLocal;
  localLbl.style.display = SCEN[scen].localLine < 0 ? "none" : "flex";
  narr.textContent = "Press ▶ Step.";
  render();
}
function step() {
  if (done) return;
  const r = gen.next();
  if (r.done) { done = true; narr.textContent += "  (end)"; return render(); }
  narr.textContent = r.value;
  render();
}
let steps = 0;
stepBtn.onclick = step;
playBtn.onclick = () => { steps = 0; while (!done && steps++ < 200) step(); };
resetBtn.onclick = reset;

function render() {
  scenBtns.forEach(([k, b]) => (b.style.outline = k === scen ? "2px solid var(--interactive-accent)" : ""));
  const s = SCEN[scen];
  titleEl.textContent = s.title;
  codeEl.innerHTML = "";
  s.code.forEach((t, i) => {
    const off = i === s.localLine && !useLocal;
    const ln = el("div", `padding:0 4px;border-radius:3px;${i === line ? "background:var(--interactive-accent);color:var(--text-on-accent);" : ""}${off ? "opacity:0.35;text-decoration:line-through;" : ""}`, `${String(i + 1).padStart(2)}  ${t}`, codeEl);
    ln.title = off ? "turned off: tick 'use local'" : "";
  });
  stackEl.innerHTML = "";
  for (let k = frames.length - 1; k >= 0; k--) {
    const f = frames[k];
    const box = el("div", `border:1px ${f.sub ? "dashed" : "solid"} ${k === 0 ? "#9c36b5" : f.sub ? "#e8590c" : "#3b82f6"};border-radius:6px;padding:4px 6px;`, null, stackEl);
    el("div", "font-size:11px;color:var(--text-muted);", k === 0 ? "🌍 global" : `📞 ${f.name}`, box);
    const names = Object.keys(f.vars);
    const vs = el("div", mono + "font-size:12px;display:flex;gap:6px;flex-wrap:wrap;", names.length ? null : "(no variables)", box);
    names.forEach((n) => {
      const on = hl && hl.frame === k && hl.name === n;
      el("span", `padding:0 4px;border-radius:4px;${on ? "background:#e8590c;color:white;" : "background:var(--background-secondary);"}`, `${n}=${f.vars[n] === "" ? '""' : f.vars[n]}`, vs);
    });
  }
  outEl.textContent = out.join("\n").replace(/^\n+|\n+$/g, "");
}
reset();
