// bvq-param: parameter expansion playground. Pick an operator (# ## % %% / // ^^ ,, :- #len :off:len),
// type a pattern, and see which part of the value is cut (struck through) and the result.
// "Quiz me" mode: a random value/operator/pattern, type your guess, then reveal.
// input: { value?: "/home/matan/photos/beach.tar.gz", op?: "#"|"##"|"%"|"%%"|"/"|"//"|"^^"|",,"|":-"|"len"|"sub" = "##",
//          pattern?: "*/", rep?: "", quiz?: false }

const opts = (typeof input === "object" && input) || {};
const OPS = ["#", "##", "%", "%%", "/", "//", "^^", ",,", ":-", "len", "sub"];
let value = typeof opts.value === "string" ? opts.value : "/home/matan/photos/beach.tar.gz";
let op = OPS.includes(opts.op) ? opts.op : "##";
let pattern = typeof opts.pattern === "string" ? opts.pattern : (op === "%" || op === "%%" ? ".*" : "*/");
let rep = typeof opts.rep === "string" ? opts.rep : "";
let quizMode = !!opts.quiz;

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

// ---------- glob pattern matching (parameter-expansion style: * also matches /) ----------
function re(p) {
  let r = "^", i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "*") r += "[\\s\\S]*";
    else if (c === "?") r += "[\\s\\S]";
    else if (c === "[") {
      const j = p.indexOf("]", i + 2);
      if (j > 0) { let cls = p.slice(i + 1, j); if (cls[0] === "!") cls = "^" + cls.slice(1); r += "[" + cls.replace(/\\/g, "\\\\") + "]"; i = j + 1; continue; }
      r += "\\[";
    } else r += c.replace(/[.+^${}()|\\]/g, "\\$&");
    i++;
  }
  try { return new RegExp(r + "$"); } catch (e) { return /^\b\B$/; }
}
// returns { result, cut: [start,end] ranges removed/replaced, how }
function expand(v, o, p, r) {
  const m = re(p), n = v.length;
  if (o === "#" || o === "##") {
    const order = o === "#" ? [...Array(n + 1).keys()] : [...Array(n + 1).keys()].reverse();
    for (const i of order) if (m.test(v.slice(0, i))) return { result: v.slice(i), cut: i ? [[0, i]] : [], how: `${o === "#" ? "shortest" : "longest"} match of "${p}" from the START removed (${i} chars)` };
    return { result: v, cut: [], how: `"${p}" doesn't match the start → nothing removed` };
  }
  if (o === "%" || o === "%%") {
    const order = o === "%" ? [...Array(n + 1).keys()].reverse() : [...Array(n + 1).keys()];
    for (const i of order) if (m.test(v.slice(i))) return { result: v.slice(0, i), cut: i < n ? [[i, n]] : [], how: `${o === "%" ? "shortest" : "longest"} match of "${p}" from the END removed (${n - i} chars)` };
    return { result: v, cut: [], how: `"${p}" doesn't match the end → nothing removed` };
  }
  if (o === "/" || o === "//") {
    if (p === "") return { result: v, cut: [], how: "empty pattern → nothing replaced" };
    let out = "", i = 0; const cut = [];
    while (i < n) {
      let hit = -1;
      for (let j = n; j > i; j--) if (m.test(v.slice(i, j))) { hit = j; break; }
      if (hit > 0) { out += r; cut.push([i, hit]); i = hit; if (o === "/") { out += v.slice(i); i = n; } }
      else { out += v[i]; i++; }
    }
    return { result: out, cut, how: cut.length ? `${o === "/" ? "first" : "every"} longest match of "${p}" → "${r}" (${cut.length} replaced)` : `"${p}" not found → unchanged` };
  }
  if (o === "^^") return { result: v.toUpperCase(), cut: [], how: "every letter → UPPERCASE" };
  if (o === ",,") return { result: v.toLowerCase(), cut: [], how: "every letter → lowercase" };
  if (o === ":-") return v === "" ? { result: p, cut: [], how: "value is empty/unset → use the default" } : { result: v, cut: [], how: "value is set and not empty → default ignored" };
  if (o === "len") return { result: String(n), cut: [], how: `the value has ${n} characters` };
  // sub = ${v:offset:length}, pattern holds "offset:length"
  const [a, b] = p.split(":"); let off = parseInt(a, 10) || 0; if (off < 0) off = Math.max(0, n + off);
  const len = b === undefined || b === "" ? n - off : parseInt(b, 10) || 0;
  const end = len < 0 ? n + len : Math.min(n, off + len);
  return { result: v.slice(off, Math.max(off, end)), cut: [[0, off], [Math.max(off, end), n]].filter(([s, e]) => e > s), how: `start at index ${off}, take ${Math.max(0, end - off)} chars` };
}
function syntax(o, p, r) {
  if (o === "len") return "${#v}";
  if (o === "^^" || o === ",,") return "${v" + o + "}";
  if (o === "sub") return "${v:" + p + "}";
  if (o === "/" || o === "//") return "${v" + o + p + "/" + r + "}";
  return "${v" + o + p + "}";
}

// ---------- UI ----------
const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
el("span", mono, "v=", top);
const vIn = el("input", mono + "width:260px;", null, top); vIn.type = "text";
const quizBtn = el("button", "", "", top);
const opRow = el("div", "display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;");
const opBtns = OPS.map((o) => { const b = el("button", mono + "font-size:12px;", syntax(o, o === "sub" ? "1:3" : "…", "…"), opRow); b.onclick = () => { op = o; pattern = defaultPat(o); reveal = false; render(); }; return b; });
const patRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;");
const patLbl = el("span", "font-size:13px;color:var(--text-muted);", "", patRow);
const pIn = el("input", mono + "width:110px;", null, patRow); pIn.type = "text";
const rLbl = el("span", "font-size:13px;color:var(--text-muted);", "replace with:", patRow);
const rIn = el("input", mono + "width:80px;", null, patRow); rIn.type = "text";
const code = el("div", mono + "font-size:15px;margin-top:10px;font-weight:bold;");
const strip = el("div", mono + "font-size:15px;margin-top:6px;word-break:break-all;");
const guessRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;");
const gIn = el("input", mono + "width:240px;", null, guessRow); gIn.type = "text"; gIn.placeholder = "type what bash prints";
const gBtn = el("button", "", "Check", guessRow);
const nextBtn = el("button", "", "🎲 Next", guessRow);
const out = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;min-height:1.4em;");

function defaultPat(o) { return { "#": "*/", "##": "*/", "%": "/*", "%%": ".*", "/": "a", "//": "a", ":-": "default", sub: "1:3" }[o] ?? ""; }
let reveal = false, score = 0, tries = 0;
const QUIZ = [
  ["/home/matan/photos/beach.tar.gz", "##", "*/"], ["/home/matan/photos/beach.tar.gz", "%/*", null],
  ["beach.tar.gz", "%", ".*"], ["beach.tar.gz", "%%", ".*"], ["beach.tar.gz", "#", "*."], ["beach.tar.gz", "##", "*."],
  ["report-2026-10-23.csv", "//", "-", "_"], ["report-2026-10-23.csv", "/", "-", "_"], ["Hello World", "^^", ""],
  ["", ":-", "guest"], ["matan", ":-", "guest"], ["photo.JPG", ",,", ""], ["abcdef", "sub", "2:3"], ["abcdef", "sub", "-2"],
  ["my file.txt", "len", ""], ["/var/log/nginx/access.log.1", "##", "*."],
];
function nextQuiz() {
  const q = QUIZ[Math.floor(Math.random() * QUIZ.length)];
  value = q[0];
  if (q[1] === "%/*") { op = "%"; pattern = "/*"; } else { op = q[1]; pattern = q[2] ?? ""; }
  rep = q[3] ?? ""; reveal = false; gIn.value = ""; render();
}
gBtn.onclick = () => {
  if (reveal) return;
  const r = expand(value, op, pattern, rep).result;
  tries++; if (gIn.value === r) score++;
  reveal = true; render(gIn.value === r ? "✅ Correct!" : `❌ Not quite. You typed "${esc(gIn.value)}".`);
};
gIn.onkeydown = (e) => { if (e.key === "Enter") gBtn.onclick(); };
nextBtn.onclick = nextQuiz;
quizBtn.onclick = () => { quizMode = !quizMode; if (quizMode) { score = 0; tries = 0; nextQuiz(); } else { reveal = true; render(); } };
vIn.oninput = () => { value = vIn.value; render(); };
pIn.oninput = () => { pattern = pIn.value; render(); };
rIn.oninput = () => { rep = rIn.value; render(); };

function render(msg) {
  vIn.value = value; pIn.value = pattern; rIn.value = rep;
  vIn.disabled = pIn.disabled = rIn.disabled = quizMode && !reveal;
  quizBtn.textContent = quizMode ? "🛠 Playground" : "🎲 Quiz me";
  guessRow.style.display = quizMode ? "flex" : "none";
  opRow.style.display = quizMode ? "none" : "flex";
  opBtns.forEach((b, i) => (b.style.outline = OPS[i] === op ? "2px solid var(--interactive-accent)" : ""));
  const needsPat = !["^^", ",,", "len"].includes(op);
  patRow.style.display = needsPat && !quizMode ? "flex" : "none";
  patLbl.textContent = op === ":-" ? "default:" : op === "sub" ? "offset:length →" : "pattern:";
  rLbl.style.display = rIn.style.display = op === "/" || op === "//" ? "" : "none";
  code.textContent = `v="${value}"   →   echo "${syntax(op, pattern, rep)}"`;
  const hide = quizMode && !reveal;
  const r = expand(value, op, pattern, rep);
  if (hide) { strip.innerHTML = ""; out.innerHTML = `Score ${score}/${tries}. What does it print? (empty output → leave the box empty)`; return; }
  let h = "", i = 0;
  const n = value.length;
  const cutAt = (k) => r.cut.find(([s, e]) => k >= s && k < e);
  while (i < n) {
    const c = cutAt(i);
    if (c) { h += `<span style="text-decoration:line-through;color:#d6336c;background:rgba(214,51,108,.12);">${esc(value.slice(c[0], c[1]))}</span>`; i = c[1]; }
    else { const j = (() => { let k = i; while (k < n && !cutAt(k)) k++; return k; })(); h += `<span style="color:#2b8a3e;">${esc(value.slice(i, j))}</span>`; i = j; }
  }
  strip.innerHTML = (n ? h : "<i style='color:var(--text-muted)'>(empty value)</i>") + `<br>→ <b>${r.result === "" ? "<i>(empty)</i>" : esc(r.result)}</b>`;
  out.innerHTML = (msg ? msg + "<br>" : "") + esc(r.how) + (quizMode ? ` · Score ${score}/${tries}` : "") +
    (op === "#" || op === "##" ? "<br>🧠 # sits LEFT of $ on the keyboard (shift-3) → cuts from the left/start." : op === "%" || op === "%%" ? "<br>🧠 % sits RIGHT of $ (shift-5) → cuts from the right/end. Doubled = greedy (longest)." : "");
}
if (quizMode) nextQuiz(); else render();
