// bsm-pipestatus: what is $? after a pipeline, with and without pipefail, and what's in PIPESTATUS.
// Click a stage to cycle its exit code. Game mode: a random pipeline, guess both answers.
// input: { codes?: [stage exit codes] = [1, 0], game?: false }

const opts = (typeof input === "object" && input) || {};
const CMDS = ["grep ERROR app.log", "sort", "uniq -c", "head -n 5"];
const CYCLE = [0, 1, 2, 141];
let codes = Array.isArray(opts.codes) && opts.codes.length ? opts.codes.slice(0, 4).map((x) => Number(x) || 0) : [1, 0];
let game = !!opts.game, revealed = !game, score = 0, rounds = 0;

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

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const addBtn = el("button", "", "➕ stage", bar);
const rmBtn = el("button", "", "➖ stage", bar);
const gameBtn = el("button", "", "🎲 Game: random pipeline", bar);
const hint = el("div", "font-size:12px;color:var(--text-muted);margin-bottom:6px;", "Click a stage to change its exit code (0 ok · 1 · 2 · 141 = killed by SIGPIPE).");
const pipe = el("div", "display:flex;gap:4px;flex-wrap:wrap;align-items:center;font-family:var(--font-monospace);font-size:13px;");
const guessRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;");
const gNo = el("input", "width:5em;", null, guessRow); gNo.placeholder = "$? no pf";
const gPf = el("input", "width:5em;", null, guessRow); gPf.placeholder = "$? pf";
const checkBtn = el("button", "", "Check", guessRow);
const result = el("div", "margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:13px;min-height:3em;");

const lastStatus = () => codes[codes.length - 1];
function pfStatus() {
  for (let i = codes.length - 1; i >= 0; i--) if (codes[i] !== 0) return codes[i];
  return 0;
}

function render() {
  pipe.innerHTML = "";
  codes.forEach((c, i) => {
    if (i) el("span", "color:var(--text-muted);font-weight:bold;", "|", pipe);
    const b = el("button", `font-family:var(--font-monospace);border:2px solid ${!revealed ? "var(--background-modifier-border)" : c ? "#d6336c" : "#2b8a3e"};`, null, pipe);
    b.textContent = `${CMDS[i]}  → ${c}`;
    b.onclick = () => { if (game) return; codes[i] = CYCLE[(CYCLE.indexOf(c) + 1) % CYCLE.length]; render(); };
  });
  guessRow.style.display = game ? "flex" : "none";
  addBtn.disabled = rmBtn.disabled = game;
  if (!revealed) { result.textContent = "Guess $? without pipefail, and with pipefail."; return; }
  const no = lastStatus(), pf = pfStatus();
  let rightmost = -1;
  for (let i = codes.length - 1; i >= 0; i--) if (codes[i] !== 0) { rightmost = i; break; }
  result.innerHTML =
    `without pipefail: $? = <b>${no}</b>   ← only the last command (${CMDS[codes.length - 1]}) counts<br>` +
    `with pipefail:    $? = <b>${pf}</b>   ← ${rightmost < 0 ? "every stage succeeded" : `rightmost non-zero stage (${CMDS[rightmost]})`}<br>` +
    `PIPESTATUS = (${codes.join(" ")})   ← every stage, read it right after the pipeline` +
    (no === 0 && pf !== 0 ? `<br><span style="color:#d6336c">⚠️ a stage failed but plain $? says 0: this is why pipefail exists</span>` : "") +
    (game ? `<br>score: ${score}/${rounds}` : "");
}

function newRound() {
  const n = 2 + Math.floor(Math.random() * 3);
  codes = Array.from({ length: n }, () => (Math.random() < 0.55 ? 0 : CYCLE[1 + Math.floor(Math.random() * 3)]));
  revealed = false; gNo.value = ""; gPf.value = "";
  render();
}

addBtn.onclick = () => { if (codes.length < 4) { codes.push(0); render(); } };
rmBtn.onclick = () => { if (codes.length > 1) { codes.pop(); render(); } };
gameBtn.onclick = () => { game = true; newRound(); gameBtn.textContent = "🎲 Next round"; };
checkBtn.onclick = () => {
  if (revealed) return newRound();
  const ok = Number(gNo.value) === lastStatus() && Number(gPf.value) === pfStatus() && gNo.value !== "" && gPf.value !== "";
  rounds++; if (ok) score++;
  revealed = true; render();
  result.innerHTML = (ok ? "✅ correct!<br>" : "❌ not quite<br>") + result.innerHTML;
};
if (game) newRound(); else render();
