// bcf-case: how `case` picks a branch. Pick a value; the patterns are tried top to bottom
// (animated) and the FIRST match wins. Patterns are globs: * ? [abc], and | means "or".
// input: { preset?: "files" | "yesno" | "order" (default "files"), value?: string (one of the preset's values) }

const opts = (typeof input === "object" && input) || {};
const PRESETS = {
  files: {
    title: "📁 File types",
    varName: "file",
    branches: [["*.jpg|*.png", "kind=image"], ["*.tar.gz|*.zip", "kind=archive"], ["*.md", "kind=markdown"], ["*", "kind=unknown"]],
    values: ["photo.png", "notes.md", "backup.tar.gz", "photo.PNG", "README"],
  },
  yesno: {
    title: "🙋 Yes / no prompt",
    varName: "ans",
    branches: [["[Yy]|[Yy][Ee][Ss]", 'echo "yes"'], ['[Nn]|[Nn][Oo]|""', 'echo "no"'], ["*", 'echo "invalid"']],
    values: ["y", "YES", "Yes", "yep", "no", ""],
  },
  order: {
    title: "🥇 First match wins",
    varName: "fruit",
    branches: [["a*", 'echo "starts with a"'], ["apple", 'echo "apple!"  # never reached for apple'], ["*", 'echo "something else"']],
    values: ["apple", "avocado", "banana"],
  },
};
let preset = PRESETS[opts.preset] ? opts.preset : "files";
let value = PRESETS[preset].values.includes(opts.value) ? opts.value : PRESETS[preset].values[0];

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const presetRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;");
const presetBtns = Object.entries(PRESETS).map(([k, p]) => {
  const b = el("button", "", p.title, presetRow);
  b.onclick = () => { if (busy) return; preset = k; value = PRESETS[k].values[0]; run(); };
  return [k, b];
});
const valRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const codeEl = el("div", mono + "font-size:13px;padding:8px;border-radius:6px;background:var(--background-secondary);");
const narr = el("div", "margin-top:8px;font-size:13px;min-height:2.6em;");

// glob → regex, the way case matches a whole string
function globToRe(p) {
  if (p === '""') return /^$/;
  let s = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") s += ".*";
    else if (c === "?") s += ".";
    else if (c === "[") { const j = p.indexOf("]", i + 1); s += p.slice(i, j + 1); i = j; }
    else s += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp("^" + s + "$");
}

let busy = false, state = [];
function draw(active) {
  presetBtns.forEach(([k, b]) => (b.style.outline = k === preset ? "2px solid var(--interactive-accent)" : ""));
  valRow.innerHTML = "";
  el("span", "color:var(--text-muted);", `${PRESETS[preset].varName} =`, valRow);
  PRESETS[preset].values.forEach((v) => {
    const b = el("button", mono + (v === value ? "outline:2px solid var(--interactive-accent);" : ""), v === "" ? '"" (Enter)' : `"${v}"`, valRow);
    b.onclick = () => { if (busy) return; value = v; run(); };
  });
  const p = PRESETS[preset];
  codeEl.innerHTML = "";
  el("div", "", `case $${p.varName} in`, codeEl);
  p.branches.forEach(([pat, body], i) => {
    const st = state[i];
    const bg = st === "match" ? "background:#2b8a3e;color:white;" : st === "test" ? "background:#e8590c;color:white;" : st === "skip" ? "opacity:0.45;" : st === "unused" ? "opacity:0.3;" : "";
    const mark = st === "match" ? "  ✅ runs" : st === "skip" ? "  ✗" : st === "unused" ? "  (not tested)" : "";
    el("div", `padding:1px 6px;border-radius:4px;white-space:pre;${bg}`, `  ${pat}) ${body} ;;${mark}`, codeEl);
  });
  el("div", "", "esac", codeEl);
  if (active != null) narr.innerHTML = active;
}

async function run() {
  busy = true;
  const p = PRESETS[preset];
  state = p.branches.map(() => "");
  draw(`Testing "${value}" against each pattern, top to bottom…`);
  for (let i = 0; i < p.branches.length; i++) {
    if (!root.isConnected) return;
    const alts = p.branches[i][0].split("|");
    state[i] = "test"; draw();
    await sleep(420);
    if (!root.isConnected) return;
    const hit = alts.find((a) => globToRe(a).test(value));
    if (hit !== undefined) {
      state[i] = "match";
      for (let k = i + 1; k < p.branches.length; k++) state[k] = "unused";
      const note = hit === "*" ? " The <code>*)</code> default catches anything that reached it." : "";
      draw(`<b>"${value}"</b> matches <code>${hit}</code> → branch ${i + 1} runs, and <code>;;</code> ends the case. Later patterns are never tested.${note}`);
      busy = false;
      return;
    }
    state[i] = "skip";
    draw(`"${value}" vs <code>${alts.join("</code> or <code>")}</code>: no match, next…`);
  }
  draw(`Nothing matched, so the case does nothing (exit code 0).`);
  busy = false;
}
run();
