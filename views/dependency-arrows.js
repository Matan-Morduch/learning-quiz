// dependency-arrows: why Dependency Inversion is called "inversion".
// Two layers (business on top, details below). Without DIP the arrow crossing the line points DOWN
// (OrderService imports MySQLDatabase). With DIP the business side owns an interface and the detail
// implements it, so the crossing arrow points UP. Plug in MySQL / Postgres / Fake and count business edits.
// input: { design: "before"|"after" (default "before"), plug: "mysql"|"postgres"|"fake" (default "mysql") }

const opts = (typeof input === "object" && input) || {};
let design = opts.design === "after" ? "after" : "before";
const PLUGS = {
  mysql: { before: "MySQLDatabase", after: "MySQLRepository", note: "production" },
  postgres: { before: "PostgresDatabase", after: "PostgresRepository", note: "production" },
  fake: { before: "FakeDatabase", after: "FakeRepository", note: "tests: a list in memory" },
};
let plug = PLUGS[opts.plug] ? opts.plug : "mysql";
let edits = 0;
let busy = false;
let msg = "";

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
const uid = "da" + Math.random().toString(36).slice(2, 8);

const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const flipBtn = el("button", "", "", top);
el("span", "margin-left:6px;color:var(--text-muted);font-size:12px;", "plug in:", top);
const plugBtns = {};
for (const [k, p] of Object.entries(PLUGS)) plugBtns[k] = el("button", "", k === "fake" ? "🧪 Fake" : k === "mysql" ? "MySQL" : "PostgreSQL", top);

const svgWrap = el("div", "margin-top:8px;");
const narr = el("div", "margin-top:6px;font-weight:bold;min-height:1.4em;");
const sub = el("div", "color:var(--text-muted);min-height:1.4em;font-family:var(--font-monospace);font-size:12px;");
const code = el("pre", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;white-space:pre-wrap;overflow-x:auto;");

// Geometry (viewBox units). Detail box sits under OrderService (before) or under the interface (after).
const W = 640, H = 280;
const SVC = { x: 40, y: 45, w: 200, h: 50 };
const IFC = { x: 380, y: 45, w: 220, h: 50 };
const DET_Y = 185, DET_W = 220, DET_H = 50;
const SHIFT = IFC.x - 30; // before: x=30 (under service); after: x=380 (under interface)

svgWrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:640px;font-family:var(--font-monospace);">
  <defs>
    <marker id="${uid}r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d6336c"/></marker>
    <marker id="${uid}b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3b82f6"/></marker>
    <marker id="${uid}g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2b8a3e"/></marker>
  </defs>
  <rect x="5" y="5" width="${W - 10}" height="125" rx="8" fill="var(--background-secondary)"/>
  <text x="15" y="24" font-size="12" fill="var(--text-muted)">HIGH LEVEL · business rules</text>
  <line x1="5" y1="142" x2="${W - 5}" y2="142" stroke="var(--text-faint)" stroke-dasharray="6 5"/>
  <text x="15" y="${H - 10}" font-size="12" fill="var(--text-muted)">LOW LEVEL · details (DB, email, files)</text>
  <g><rect x="${SVC.x}" y="${SVC.y}" width="${SVC.w}" height="${SVC.h}" rx="6" fill="var(--background-primary)" stroke="var(--interactive-accent)" stroke-width="2"/>
     <text x="${SVC.x + SVC.w / 2}" y="${SVC.y + 30}" text-anchor="middle" font-size="14" font-weight="bold" fill="var(--text-normal)">OrderService</text></g>
  <g data-k="ifc" style="transition:opacity .4s;"><rect x="${IFC.x}" y="${IFC.y}" width="${IFC.w}" height="${IFC.h}" rx="6" fill="var(--background-primary)" stroke="#9c36b5" stroke-width="2" stroke-dasharray="5 3"/>
     <text x="${IFC.x + IFC.w / 2}" y="${IFC.y + 22}" text-anchor="middle" font-size="13" font-weight="bold" fill="var(--text-normal)">OrderRepository</text>
     <text x="${IFC.x + IFC.w / 2}" y="${IFC.y + 40}" text-anchor="middle" font-size="11" fill="#9c36b5">interface · owned by business</text></g>
  <g data-k="det" style="transition:transform .6s;"><rect x="30" y="${DET_Y}" width="${DET_W}" height="${DET_H}" rx="6" fill="var(--background-primary)" stroke="#e8590c" stroke-width="2"/>
     <text data-k="detName" x="${30 + DET_W / 2}" y="${DET_Y + 22}" text-anchor="middle" font-size="13" font-weight="bold" fill="var(--text-normal)"></text>
     <text data-k="detNote" x="${30 + DET_W / 2}" y="${DET_Y + 40}" text-anchor="middle" font-size="11" fill="var(--text-muted)"></text></g>
  <g data-k="a1" style="transition:opacity .4s;"><line x1="140" y1="97" x2="140" y2="182" stroke="#d6336c" stroke-width="3" marker-end="url(#${uid}r)"/>
     <text x="150" y="150" font-size="12" fill="#d6336c">imports + creates ⬇</text></g>
  <g data-k="a2" style="transition:opacity .4s;"><line x1="242" y1="70" x2="376" y2="70" stroke="#3b82f6" stroke-width="3" marker-end="url(#${uid}b)"/>
     <text x="309" y="62" text-anchor="middle" font-size="12" fill="#3b82f6">uses</text></g>
  <g data-k="a3" style="transition:opacity .4s;"><line x1="490" y1="183" x2="490" y2="99" stroke="#2b8a3e" stroke-width="3" marker-end="url(#${uid}g)"/>
     <text x="500" y="150" font-size="12" fill="#2b8a3e">implements ⬆</text></g>
</svg>`;
const q = (k) => svgWrap.querySelector(`[data-k="${k}"]`);

function layout() {
  const after = design === "after";
  q("ifc").style.opacity = after ? 1 : 0;
  q("a1").style.opacity = after ? 0 : 1;
  q("a2").style.opacity = after ? 1 : 0;
  q("a3").style.opacity = after ? 1 : 0;
  q("det").style.transform = after ? `translate(${SHIFT}px,0)` : "translate(0px,0)";
}

function render() {
  const P = PLUGS[plug];
  const name = P[design];
  q("detName").textContent = name;
  q("detNote").textContent = P.note;
  flipBtn.textContent = design === "before" ? "🔄 Apply DIP (invert)" : "↩ Undo DIP";
  for (const [k, b] of Object.entries(plugBtns)) b.style.fontWeight = k === plug ? "bold" : "normal";
  if (design === "before") {
    narr.innerHTML = `Arrow crossing the line points <span style="color:#d6336c">DOWN ⬇</span>: OrderService → ${name}`;
    code.textContent = `class OrderService:\n    def __init__(self):\n        self.db = ${name}()   # business code names the detail`;
  } else {
    narr.innerHTML = `Arrow crossing the line points <span style="color:#2b8a3e">UP ⬆</span>: ${name} → OrderRepository`;
    code.textContent = `class OrderService:                     # never changes\n    def __init__(self, repo: OrderRepository):\n        self.repo = repo\n\n# main.py (wiring)\nservice = OrderService(${name}())`;
  }
  sub.textContent = msg || `OrderService edits so far: ${edits}`;
}

async function flip() {
  if (busy) return;
  busy = true;
  msg = "";
  edits = 0;
  const toAfter = design === "before";
  // stage 1: fade out the old arrows
  if (toAfter) q("a1").style.opacity = 0; else { q("a2").style.opacity = 0; q("a3").style.opacity = 0; }
  await sleep(400);
  if (!root.isConnected) return;
  // stage 2: move the detail box (under the interface, or back under the service)
  design = toAfter ? "after" : "before";
  q("det").style.transform = toAfter ? `translate(${SHIFT}px,0)` : "translate(0px,0)";
  if (!toAfter) q("ifc").style.opacity = 0;
  await sleep(600);
  if (!root.isConnected) return;
  // stage 3: show the new arrows
  layout();
  render();
  busy = false;
}

function choose(k) {
  if (busy || k === plug) return;
  const old = PLUGS[plug][design];
  plug = k;
  const name = PLUGS[plug][design];
  if (design === "before") {
    edits++;
    msg = `✏️ edited OrderService: ${old}() → ${name}() · OrderService edits so far: ${edits}`;
  } else {
    msg = `➕ main.py passes ${name}() · OrderService edits so far: ${edits}`;
  }
  render();
}

flipBtn.onclick = flip;
for (const k of Object.keys(PLUGS)) plugBtns[k].onclick = () => choose(k);
layout();
render();
