// sig-mask: decode a /proc/<pid>/status signal mask (SigCgt / SigIgn / SigBlk / SigPnd).
// Hex → binary → set bits → signals, using bit (N − 1) = signal N.
// input: { hex?: hex mask without 0x (default "4002"), field?: "SigCgt"|"SigIgn"|"SigBlk"|"SigPnd" (default "SigCgt") }

const opts = (typeof input === "object" && input) || {};
const NAMES = ["", "HUP", "INT", "QUIT", "ILL", "TRAP", "ABRT", "BUS", "FPE", "KILL", "USR1", "SEGV", "USR2",
  "PIPE", "ALRM", "TERM", "STKFLT", "CHLD", "CONT", "STOP", "TSTP", "TTIN", "TTOU", "URG", "XCPU", "XFSZ",
  "VTALRM", "PROF", "WINCH", "IO", "PWR", "SYS"];
const FIELD = { SigCgt: "caught (has a handler)", SigIgn: "ignored", SigBlk: "blocked", SigPnd: "pending" };

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

const row = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-family:var(--font-monospace);");
const fieldSel = el("select", "", null, row);
for (const f of Object.keys(FIELD)) { const o = el("option", "", f + ":", fieldSel); o.value = f; }
fieldSel.value = FIELD[opts.field] ? opts.field : "SigCgt";
const inp = el("input", "width:170px;font-family:var(--font-monospace);", null, row);
inp.type = "text";
inp.value = String(opts.hex ?? "4002").replace(/^0x/i, "").padStart(16, "0");
const presets = el("div", "display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;");
for (const [label, f, h] of [["graceful.c SigCgt", "SigCgt", "4002"], ["ignore.c SigIgn", "SigIgn", "4000"],
                               ["started with & from a script: SigIgn", "SigIgn", "4006"], ["USR1+USR2 SigCgt", "SigCgt", "a00"]]) {
  const b = el("button", "", label, presets);
  b.onclick = () => { fieldSel.value = f; inp.value = h.padStart(16, "0"); draw(); };
}
const bitsEl = el("div", "margin-top:10px;display:flex;flex-wrap:wrap;gap:2px;");
const out = el("div", "margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);font-size:13px;line-height:1.6;");

function draw() {
  const raw = inp.value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{1,16}$/i.test(raw)) { out.textContent = "Type up to 16 hex digits (0–9, a–f)."; bitsEl.innerHTML = ""; return; }
  const v = BigInt("0x" + raw);
  const set = [];
  for (let i = 0n; i < 64n; i++) if ((v >> i) & 1n) set.push(Number(i));
  // show the low 20 bits (signals 1–20), MSB on the left
  let h = "";
  for (let b = 19; b >= 0; b--) {
    const on = set.includes(b);
    h += `<div style="width:26px;text-align:center;font-family:var(--font-monospace);">
      <div style="font-size:9px;color:var(--text-faint);">bit ${b}</div>
      <div style="height:24px;line-height:24px;border-radius:4px;font-weight:bold;border:1px solid var(--background-modifier-border);${on ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "color:var(--text-faint);"}">${on ? 1 : 0}</div>
      <div style="font-size:9px;color:${on ? "var(--text-normal)" : "var(--text-faint)"};">${NAMES[b + 1]}</div></div>`;
  }
  bitsEl.innerHTML = h;
  const list = set.map((b) => `bit ${b} → signal <b>${b + 1}</b> (SIG${NAMES[b + 1] || "RT" + (b + 1)})`);
  out.innerHTML = `0x${raw.replace(/^0+(?=.)/, "")} = binary <span style="font-family:var(--font-monospace)">${v.toString(2)}</span><br>` +
    (set.length ? list.join("<br>") + `<br>→ these signals are <b>${FIELD[fieldSel.value]}</b>. Rule: <b>bit (N − 1) = signal N</b>.`
                : `no bits set: no signals are ${FIELD[fieldSel.value]}.`);
}
inp.oninput = draw;
fieldSel.onchange = draw;
draw();
