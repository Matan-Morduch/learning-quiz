// overflow-memory: why writing past the end of a buffer is a bug (educational, simplified memory layout).
// char name[8] sits right before a neighbor variable isAdmin = 0. An unchecked copy (like C's strcpy)
// keeps writing past name[7] and overwrites isAdmin. Turning on the bounds check stops at the buffer's size.
// input: { text?: the input to copy (default "HelloWorld!"), check?: bounds checking on (default false) }

const opts = (typeof input === "object" && input) || {};
const SIZE = 8;              // char name[8]
const OTHER = 3;             // a few more neighbor bytes after isAdmin
const TOTAL = SIZE + 1 + OTHER;
const INIT_TEXT = String(opts.text ?? "HelloWorld!").slice(0, 24);

// ---------- tiny DOM helpers ----------
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
const MONO = "font-family:var(--font-monospace);";

// ---------- UI ----------
el("pre", MONO + "font-size:12px;margin:0 0 8px;padding:6px 8px;border-radius:6px;background:var(--background-secondary);white-space:pre-wrap;",
  "char name[8];      // the buffer\nchar isAdmin = 0;  // its neighbor in memory (simplified layout)");
const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const inp = el("input", MONO + "width:170px;", null, controls);
inp.type = "text"; inp.value = INIT_TEXT; inp.maxLength = 24;
const copyBtn = el("button", "", "📋 Copy into name", controls);
const chkLbl = el("label", "display:flex;gap:4px;align-items:center;", null, controls);
const chk = el("input", "", null, chkLbl);
chk.type = "checkbox"; chk.checked = !!opts.check;
el("span", "", "bounds check", chkLbl);
const resetBtn = el("button", "", "↺ Clear memory", controls);

const strip = el("div", "display:flex;gap:3px;flex-wrap:wrap;margin:6px 0;");
const narr = el("div", MONO + "font-size:12px;min-height:1.4em;");
const verdict = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-weight:bold;");

// ---------- state ----------
let mem, hl, busy;
function clearMem() { mem = Array(TOTAL).fill(0); hl = -1; }

function show(b) {
  if (b === 0) return "\\0";
  return b >= 32 && b < 127 ? String.fromCharCode(b) : String(b);
}
function render() {
  let h = "";
  for (let i = 0; i < TOTAL; i++) {
    const inBuf = i < SIZE, isAdmin = i === SIZE;
    const color = inBuf ? "#3b82f6" : isAdmin ? "#d6336c" : "#9c36b5";
    const label = inBuf ? `name[${i}]` : isAdmin ? "isAdmin" : "other";
    const hot = i === hl;
    const dirty = !inBuf && mem[i] !== 0;
    h += `<div style="width:44px;text-align:center;${i === SIZE ? "margin-left:6px;" : ""}">` +
      `<div style="height:34px;line-height:32px;border:${hot ? "3px solid var(--text-normal)" : `2px solid ${color}`};border-radius:5px;${MONO}font-weight:bold;` +
      `background:${dirty ? "var(--text-error)" : "transparent"};color:${dirty ? "#fff" : "var(--text-normal)"};">${show(mem[i])}</div>` +
      `<div style="font-size:9px;color:${color};">${label}</div></div>`;
  }
  strip.innerHTML = h;
  const a = mem[SIZE];
  verdict.innerHTML = a === 0
    ? `isAdmin = 0 → <span style="color:#2b8a3e">normal user ✅</span>`
    : `isAdmin = ${a} ('${show(a)}') → nonzero means TRUE → <span style="color:var(--text-error)">ADMIN MODE 😱 and nobody set it on purpose</span>`;
}

async function copy() {
  if (busy) return;
  busy = true;
  clearMem();
  const text = inp.value;
  const checked = chk.checked;
  // bytes to write: the characters plus the terminating '\0', like a C string copy
  let bytes = [...text].map((ch) => ch.charCodeAt(0) & 0xff).concat([0]);
  let refused = 0;
  if (checked && bytes.length > SIZE) {           // safe copy: keep 7 chars + '\0'
    refused = bytes.length - SIZE;
    bytes = bytes.slice(0, SIZE - 1).concat([0]);
  }
  for (let i = 0; i < bytes.length; i++) {
    if (i < TOTAL) { mem[i] = bytes[i]; hl = i; }
    const where = i < SIZE ? `name[${i}]` : i === SIZE ? "isAdmin ⚠" : i < TOTAL ? `neighbor byte +${i - SIZE}` : "further memory ⚠";
    narr.textContent = `byte ${i + 1}/${bytes.length}: '${show(bytes[i])}' → ${where}`;
    render();
    await sleep(170);
    if (!root.isConnected) return;
  }
  hl = -1;
  const over = Math.max(0, bytes.length - SIZE);
  narr.textContent = checked
    ? (refused ? `bounds check: only ${SIZE} bytes fit (7 chars + \\0), ${refused} byte(s) refused, neighbors untouched ✅` : `fits: ${bytes.length} of ${SIZE} bytes used ✅`)
    : (over ? `unchecked copy: ${bytes.length} bytes into an ${SIZE}-byte buffer → ${over} byte(s) spilled into the neighbors 💥` : `fits: ${bytes.length} of ${SIZE} bytes used (luckily)`);
  render();
  busy = false;
}

copyBtn.onclick = copy;
chk.onchange = () => { if (!busy) copy(); };
resetBtn.onclick = () => { if (!busy) { clearMem(); narr.textContent = "memory cleared: isAdmin = 0"; render(); } };

// start already showing the result of copying the initial text (no animation)
clearMem();
{
  let bytes = [...INIT_TEXT].map((ch) => ch.charCodeAt(0) & 0xff).concat([0]);
  if (chk.checked && bytes.length > SIZE) bytes = bytes.slice(0, SIZE - 1).concat([0]);
  for (let i = 0; i < Math.min(TOTAL, bytes.length); i++) mem[i] = bytes[i];
  const over = Math.max(0, bytes.length - SIZE);
  narr.textContent = over
    ? `copied "${INIT_TEXT}" (${bytes.length} bytes with \\0) into ${SIZE} bytes → ${over} byte(s) past the end`
    : `copied "${INIT_TEXT}" (${bytes.length} bytes with \\0): fits`;
}
render();
