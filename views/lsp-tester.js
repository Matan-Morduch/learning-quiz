// lsp-tester: Liskov Substitution. Run the SAME client code with the base class and with each subclass.
// A subclass that makes the client fail breaks LSP, even though it "is-a" base class on paper.
// input: { case: "rectangle"|"bird"|"account"|"logger" (default "rectangle") }

const opts = (typeof input === "object" && input) || {};

// Each case: client code + for each class, the trace lines it produces and whether the client's expectation holds.
const CASES = {
  rectangle: {
    title: "Rectangle ← Square",
    client: "def test(r: Rectangle):\n    r.set_width(5)\n    r.set_height(4)\n    assert r.area() == 20",
    classes: {
      Rectangle: { ok: true, trace: ["set_width(5) → width=5, height=0", "set_height(4) → width=5, height=4", "area() = 5 × 4 = 20 ✅"] },
      Square: { ok: false, trace: ["set_width(5) → width=5, height=5 (a square keeps sides equal)", "set_height(4) → width=4, height=4", "area() = 4 × 4 = 16 ❌ expected 20"] },
    },
    why: "Mathematically a square IS a rectangle, but a Square object doesn't behave like a Rectangle object: setting the height secretly changes the width. The client's reasonable expectation breaks.",
    fix: "Don't inherit. Make Rectangle and Square separate classes that both implement a Shape with area(), or make shapes immutable (no setters).",
  },
  bird: {
    title: "Bird ← Penguin",
    client: "def migrate(birds: list[Bird]):\n    for b in birds:\n        b.fly()",
    classes: {
      Sparrow: { ok: true, trace: ["fly() → 🐦 flies away ✅"] },
      Eagle: { ok: true, trace: ["fly() → 🦅 soars ✅"] },
      Penguin: { ok: false, trace: ["fly() → raise NotImplementedError(\"penguins can't fly\") ❌ crash"] },
    },
    why: "Bird promised fly(). Penguin 'is a bird' in biology, but it can't keep that promise, so any code looping over birds crashes when a penguin shows up.",
    fix: "Split the hierarchy: Bird (eat, lay eggs) and FlyingBird(Bird) with fly(). Penguin extends Bird only, so migrate() asks for list[FlyingBird].",
  },
  account: {
    title: "Account ← PremiumAccount",
    client: "def pay_coffee(acc: Account):\n    acc.withdraw(4)    # any amount ≤ balance is allowed",
    classes: {
      Account: { ok: true, trace: ["withdraw(4) → balance 100 → 96 ✅"] },
      SavingsAccount: { ok: true, trace: ["withdraw(4) → balance 100 → 96 ✅ (also logs it: extra behavior is fine)"] },
      PremiumAccount: { ok: false, trace: ["withdraw(4) → raise ValueError(\"minimum withdrawal is 100\") ❌"] },
    },
    why: "The subclass is STRICTER about its input (a stronger precondition) than the base class promised. Callers written for Account suddenly get errors.",
    fix: "A subclass may accept MORE than the base (weaker preconditions) and promise MORE (stronger guarantees), never less. Put the minimum rule somewhere else, or don't make it a subclass.",
  },
  logger: {
    title: "Logger ← FileLogger / ConsoleLogger (a good one)",
    client: 'def run(log: Logger):\n    log.info("started")\n    # expects: no crash, message recorded somewhere',
    classes: {
      Logger: { ok: true, trace: ['info("started") → recorded ✅'] },
      FileLogger: { ok: true, trace: ['info("started") → appended to app.log ✅'] },
      ConsoleLogger: { ok: true, trace: ['info("started") → printed to the terminal ✅'] },
    },
    why: "Every subclass keeps the promise ('record the message, don't crash'), just in a different way. That's LSP done right: swap them freely.",
    fix: "Nothing to fix. This is what substitutable subclasses look like.",
  },
};

let key = CASES[opts.case] ? opts.case : "rectangle";
let busy = false;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sel = el("select", "", null);
for (const [k, c] of Object.entries(CASES)) { const o = el("option", "", c.title, sel); o.value = k; }
sel.value = key;
el("div", "font-size:12px;color:var(--text-muted);margin-top:8px;", "Client code (written for the BASE class):");
const client = el("pre", "margin:4px 0;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;white-space:pre-wrap;");
const runRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;");
const trace = el("div", "font-family:var(--font-monospace);font-size:13px;min-height:4.5em;padding:6px 0;");
const results = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:4px 0;");
const why = el("div", "margin-top:6px;");
const fixBtn = el("button", "margin-top:6px;", "🔧 Show the fix");
const fix = el("div", "margin-top:6px;color:var(--text-muted);display:none;");
let tested = {};

function render() {
  const C = CASES[key];
  client.textContent = C.client;
  runRow.innerHTML = "";
  el("span", "align-self:center;font-size:13px;", "Run it with:", runRow);
  for (const name of Object.keys(C.classes)) {
    const b = el("button", "", `▶ ${name}`, runRow);
    b.onclick = () => run(name);
  }
  results.innerHTML = "";
  for (const [name, r] of Object.entries(C.classes)) {
    if (!(name in tested)) continue;
    el("span", `padding:2px 8px;border-radius:999px;font-size:12px;font-weight:bold;color:white;background:${r.ok ? "#2b8a3e" : "#d6336c"};`, `${name}: ${r.ok ? "substitutable ✅" : "breaks LSP ❌"}`, results);
  }
  const allTested = Object.keys(C.classes).every((n) => n in tested);
  why.innerHTML = allTested ? `<b>Why:</b> ${C.why}` : `<span style="color:var(--text-muted)">Run the client with every class. Predict first: which one breaks it?</span>`;
  fix.textContent = C.fix;
}

async function run(name) {
  if (busy) return;
  busy = true;
  const r = CASES[key].classes[name];
  trace.innerHTML = `<div style="color:var(--text-muted)">test(${name}()):</div>`;
  for (const line of r.trace) {
    await sleep(550);
    if (!root.isConnected) return;
    const bad = line.includes("❌");
    trace.innerHTML += `<div style="color:${bad ? "#d6336c" : "inherit"}">→ ${line}</div>`;
  }
  tested[name] = true;
  busy = false;
  render();
}

sel.onchange = () => { key = sel.value; tested = {}; trace.innerHTML = ""; fix.style.display = "none"; render(); };
fixBtn.onclick = () => { fix.style.display = fix.style.display === "none" ? "block" : "none"; };
render();
