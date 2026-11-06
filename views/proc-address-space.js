// proc-address-space: where code, globals, heap and stack live in a process's address space.
// Click a C line to light up the region it uses (with a real address from where.c on arm64 Linux).
// Buttons grow the stack (function call) and the heap (malloc) into the free space between them.
// input: { focus?: "code"|"data"|"heap"|"stack"|"pointer" (default none) }

const opts = (typeof input === "object" && input) || {};

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

const REGIONS = {
  stack: { name: "Stack", col: "#2b8a3e", addr: "0xffffcecb7114", note: "locals, function arguments, return addresses" },
  heap: { name: "Heap", col: "#e8590c", addr: "0xaaaaf142f2a0", note: "memory from malloc / new" },
  data: { name: "Static data", col: "#9c36b5", addr: "0xaaaad5210058", note: "globals and static variables" },
  code: { name: "Code", col: "#3b82f6", addr: "0xaaaad51f0864", note: "the instructions" },
};
const LINES = [
  { key: "data", code: "int global = 42;", why: "A global lives in static data for the whole run." },
  { key: "data", code: "static int calls = 0;   // inside f()", why: "static locals live with the globals, not on the stack, so they keep their value between calls." },
  { key: "code", code: "int main(int argc, char *argv[]) { … }", why: "The function's instructions are in the code region (read + execute, not writable)." },
  { key: "stack", code: "int local = 7;          // inside main", why: "An ordinary local variable lives in main's stack frame." },
  { key: "pointer", code: "char *buf = malloc(100);", why: "Two places! The pointer variable buf (8 bytes) is on the stack. The 100 bytes it points to are on the heap." },
  { key: "stack", code: "argv[0]  (\"./where\")", why: "The OS puts argc/argv on the stack before main() runs." },
];

const wrap = el("div", "display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;");
const svgWrap = el("div", "flex:1 1 260px;min-width:240px;", null, wrap);
const list = el("div", "flex:1 1 260px;display:flex;flex-direction:column;gap:4px;", null, wrap);
const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;");
const narr = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);min-height:2.4em;");

let focus = ["code", "data", "heap", "stack", "pointer"].includes(opts.focus) ? opts.focus : null;
let stackH = 40, heapH = 40, busy = false;
const TOP = 10, BOTTOM = 290, CODE_H = 36, DATA_H = 36;

function draw() {
  const lit = (k) => focus === k || (focus === "pointer" && (k === "stack" || k === "heap"));
  const codeY = BOTTOM - CODE_H, dataY = codeY - DATA_H, heapY = dataY - heapH, freeY = TOP + stackH;
  const seg = (k, y, h) => {
    const r = REGIONS[k];
    return `<rect x="70" y="${y}" width="150" height="${h}" rx="4" fill="${r.col}" fill-opacity="${lit(k) ? 0.95 : 0.45}" stroke="${lit(k) ? "var(--text-normal)" : "none"}" stroke-width="3"/>` +
      `<text x="145" y="${y + h / 2 + 5}" text-anchor="middle" font-weight="bold" fill="white">${r.name}</text>` +
      (lit(k) ? `<text x="228" y="${y + h / 2 + 4}" font-family="monospace" font-size="11" fill="${r.col}">${r.addr}</text>` : "");
  };
  const freeH = heapY - freeY;
  svgWrap.innerHTML = `<svg viewBox="0 0 330 300" width="100%" style="max-width:340px" font-family="sans-serif" font-size="13">
<text x="62" y="22" text-anchor="end" fill="gray" font-size="11">high</text>
<text x="62" y="288" text-anchor="end" fill="gray" font-size="11">low</text>
${seg("stack", TOP, stackH)}
<rect x="70" y="${freeY}" width="150" height="${Math.max(0, freeH)}" fill="none" stroke="gray" stroke-dasharray="5 4"/>
<text x="145" y="${freeY + freeH / 2 + 5}" text-anchor="middle" fill="gray">${freeH > 18 ? "free ↕" : ""}</text>
${seg("heap", heapY, heapH)}
${seg("data", dataY, DATA_H)}
${seg("code", codeY, CODE_H)}
</svg>`;
  [...list.children].forEach((b, i) => {
    const on = LINES[i].key === focus && b.dataset.picked === "1";
    b.style.outline = on ? "2px solid var(--interactive-accent)" : "none";
  });
}

LINES.forEach((ln) => {
  const b = el("button", "text-align:left;font-family:var(--font-monospace);font-size:12px;white-space:normal;height:auto;padding:4px 8px;", ln.code, list);
  b.onclick = () => {
    [...list.children].forEach((c) => (c.dataset.picked = "0"));
    b.dataset.picked = "1";
    focus = ln.key;
    narr.innerHTML = (ln.key === "pointer" ? "🟩 + 🟧 " : "") + ln.why;
    draw();
  };
});

async function grow(which) {
  if (busy) return;
  const free = BOTTOM - CODE_H - DATA_H - heapH - (TOP + stackH);
  if (free < 24) { narr.textContent = "💥 Stack and heap would collide. Real systems stop this: a stack overflow, or malloc returning NULL."; return; }
  busy = true; focus = which;
  for (let i = 0; i < 10; i++) {
    if (!root.isConnected) return;
    if (which === "stack") stackH += 2; else heapH += 2;
    draw();
    await new Promise((r) => setTimeout(r, 30));
  }
  narr.textContent = which === "stack" ? "Function call: a new stack frame. The stack grows DOWN toward lower addresses." : "malloc(): the heap grows UP toward higher addresses.";
  busy = false;
}
el("button", "", "📞 Call a function", bar).onclick = () => grow("stack");
el("button", "", "🧱 malloc()", bar).onclick = () => grow("heap");
el("button", "", "↺ Reset", bar).onclick = () => { if (busy) return; stackH = 40; heapH = 40; focus = null; narr.textContent = "Click a line of C."; draw(); };

narr.textContent = focus ? `${focus === "pointer" ? "Stack + Heap" : REGIONS[focus].name}: ${focus === "pointer" ? "the pointer on the stack, the bytes on the heap" : REGIONS[focus].note}.` : "Click a line of C to see where it lives.";
draw();
