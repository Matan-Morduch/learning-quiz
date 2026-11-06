// bucket-index-drill: practice computing which bucket a value goes to.
// Formula: i = floor((x − min) / (max − min) × k), and if i == k (x is the maximum), use k − 1.
// input: { maxTrap: true (sometimes ask about the maximum value) }

const opts = (typeof input === "object" && input) || {};
let score = 0, done = 0, cur = null, answered = false;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

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
const scoreEl = el("div", "text-align:right;color:var(--text-muted);font-size:13px;");
const q = el("div", "font-size:17px;margin:8px 0;line-height:1.6;min-height:3em;");
const row = el("div", "display:flex;gap:6px;align-items:center;");
const inp = el("input", "width:90px;", null, row);
inp.type = "number"; inp.placeholder = "bucket #";
const check = el("button", "", "Check", row);
const next = el("button", "", "Next ▶", row);
const fb = el("div", "margin-top:8px;font-family:var(--font-monospace);font-size:13px;min-height:3em;line-height:1.6;");
el("div", "font-size:12px;color:var(--text-muted);margin-top:4px;", "Buckets are numbered from 0. Formula: ⌊(x − min) / (max − min) × k⌋, with the maximum value going into the last bucket (k − 1).");

function make() {
  const kind = rnd(0, 2);
  if (kind === 0) {                       // floats in [0, 1)
    const k = [4, 5, 10][rnd(0, 2)], x = rnd(0, 99) / 100;
    return { text: `Values are in <b>[0, 1)</b>, k = <b>${k}</b> buckets. Which bucket gets <b>${x.toFixed(2)}</b>?`,
      a: Math.floor(x * k), why: `⌊${x.toFixed(2)} × ${k}⌋ = ⌊${(x * k).toFixed(2)}⌋ = ${Math.floor(x * k)}` };
  }
  const min = [0, 10, 50][rnd(0, 2)], span = [100, 200, 40][rnd(0, 2)], max = min + span, k = [4, 5, 8, 10][rnd(0, 3)];
  const trap = opts.maxTrap !== false && Math.random() < 0.3;
  const x = trap ? max : rnd(min, max - 1);
  const raw = ((x - min) / (max - min)) * k;
  const a = Math.min(k - 1, Math.floor(raw));
  return {
    text: `Exam scores from <b>${min}</b> to <b>${max}</b>, k = <b>${k}</b> buckets. Which bucket gets <b>${x}</b>?`,
    a,
    why: `⌊(${x} − ${min}) / (${max} − ${min}) × ${k}⌋ = ⌊${raw.toFixed(2)}⌋ = ${Math.floor(raw)}` +
      (Math.floor(raw) === k ? ` → that's bucket ${k}, which doesn't exist (buckets 0…${k - 1})! The maximum goes into the LAST bucket: ${k - 1} ⚠️` : ""),
  };
}
function show() {
  cur = make(); answered = false;
  q.innerHTML = cur.text; inp.value = ""; fb.textContent = "";
  scoreEl.textContent = `✅ ${score}/${done}`;
}
function doCheck() {
  if (answered || inp.value === "") return;
  answered = true; done++;
  const ok = Number(inp.value) === cur.a;
  if (ok) score++;
  fb.innerHTML = `${ok ? "✅ Correct!" : `❌ It's bucket <b>${cur.a}</b>.`}<br>${cur.why}`;
  scoreEl.textContent = `✅ ${score}/${done}`;
}
check.onclick = doCheck;
inp.onkeydown = (e) => { if (e.key === "Enter") { answered ? show() : doCheck(); } };
next.onclick = show;
show();
