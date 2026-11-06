// bvq-split: what a command really receives when you write $v, "$v", '$v', ${arr[@]}, "${arr[@]}", "${arr[*]}".
// Walks the expansion steps (parameter expansion → word splitting → globbing → quote removal)
// and draws the final argument boxes, using a pretend folder of files for globbing.
// input: { value?: "my file.txt", form?: "$v"|"\"$v\""|"'$v'"|"${arr[@]}"|"\"${arr[@]}\""|"\"${arr[*]}\"" = "$v",
//          arr?: ["my file.txt", "*.md", ""], ifs?: "default"|"," = "default", cmd?: "rm" }

const opts = (typeof input === "object" && input) || {};
const FILES = ["a.txt", "b.txt", "my file.txt", "notes.md"];
const FORMS = ['$v', '"$v"', "'$v'", "${arr[@]}", '"${arr[@]}"', '"${arr[*]}"'];
let value = typeof opts.value === "string" ? opts.value : "my file.txt";
let form = FORMS.includes(opts.form) ? opts.form : "$v";
let arr = Array.isArray(opts.arr) && opts.arr.length ? opts.arr.slice(0, 4).map(String) : ["my file.txt", "*.md", ""];
let ifs = opts.ifs === "," ? "," : "default";
const cmd = typeof opts.cmd === "string" ? opts.cmd : "rm";

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
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- controls ----------
const row1 = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
el("span", mono, "v=", row1);
const vIn = el("input", mono + "width:150px;", null, row1);
vIn.type = "text"; vIn.value = value;
el("span", mono + "margin-left:8px;", "arr=(", row1);
const aIns = arr.map((x) => { const i = el("input", mono + "width:90px;", null, row1); i.type = "text"; i.value = x; return i; });
el("span", mono, ")", row1);

const row2 = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;");
const formBtns = FORMS.map((f) => {
  const b = el("button", mono, `${cmd} ${f}`, row2);
  b.onclick = () => { form = f; render(); };
  return b;
});
const row3 = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:13px;");
el("span", "color:var(--text-muted);", "IFS:", row3);
const ifsSel = el("select", "", null, row3);
[["default", "default (space, tab, newline)"], [",", "IFS=,"]].forEach(([v, t]) => { const o = el("option", "", t, ifsSel); o.value = v; });
ifsSel.value = ifs;
const presets = [["file with space", "my file.txt"], ["a star", "*"], ["*.txt", "*.txt"], ["empty", ""], ["extra spaces", "  a    b  "], ["csv", "a,b,,c"]];
presets.forEach(([t, v]) => { const b = el("button", "font-size:12px;", t, row3); b.onclick = () => { vIn.value = v; if (form.includes("arr")) form = "$v"; render(); }; });

el("div", "font-size:12px;color:var(--text-muted);margin-top:8px;", `📁 files in this folder: ${FILES.map((f) => `"${f}"`).join("  ")}`);
const steps = el("div", mono + "font-size:13px;margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);line-height:1.6;");
const boxes = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;");
const verdict = el("div", "margin-top:8px;font-size:13px;min-height:1.4em;");

// ---------- the mini bash ----------
function split(s) {
  if (ifs === "default") return s.split(/[ \t\n]+/).filter((w) => w !== "");
  if (s === "") return [];
  const parts = s.split(",");
  if (parts[parts.length - 1] === "") parts.pop(); // a trailing delimiter does not make an empty last field
  return parts;
}
function globRe(p) {
  let r = "^";
  for (const c of p) r += c === "*" ? "[^/]*" : c === "?" ? "[^/]" : c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(r + "$");
}
function glob(words) {
  const out = [], notes = [];
  for (const w of words) {
    if (/[*?]/.test(w)) {
      const m = FILES.filter((f) => globRe(w).test(f));
      if (m.length) { out.push(...m); notes.push(`${w} → ${m.length} file(s)`); }
      else { out.push(w); notes.push(`${w} matches nothing → stays literal`); }
    } else out.push(w);
  }
  return { out, notes };
}
const show = (list) => list.length ? list.map((w) => `<b>&lt;${esc(w)}&gt;</b>`).join(" ") : "<i>(nothing)</i>";

function render() {
  value = vIn.value; arr = aIns.map((i) => i.value); ifs = ifsSel.value;
  formBtns.forEach((b, i) => { b.style.outline = FORMS[i] === form ? "2px solid var(--interactive-accent)" : ""; });
  const L = [];
  const shownArr = `(${arr.map((x) => `"${x}"`).join(" ")})`;
  let args;
  if (form === "'$v'") {
    L.push(`1. single quotes: <b>nothing</b> expands, not even $v`);
    args = ["$v"];
    L.push(`2–3. no splitting, no globbing`);
  } else if (form === '"$v"') {
    L.push(`1. parameter expansion: $v → ${esc(value) === "" ? "<i>(empty)</i>" : esc(value)}`);
    L.push(`2–3. inside double quotes: <b>no</b> word splitting, <b>no</b> globbing`);
    args = [value];
  } else if (form === '"${arr[@]}"') {
    L.push(`1. arr=${esc(shownArr)} → each element becomes its own word, exactly as stored`);
    L.push(`2–3. quoted: no splitting, no globbing (empty elements survive)`);
    args = arr.slice();
  } else if (form === '"${arr[*]}"') {
    const j = ifs === "default" ? " " : ",";
    const joined = arr.join(j);
    L.push(`1. "\${arr[*]}" joins all elements with the first IFS character ("${j}") → ${esc(joined)}`);
    L.push(`2–3. quoted: one word, no globbing`);
    args = [joined];
  } else {
    const src = form === "$v" ? [value] : arr;
    L.push(form === "$v" ? `1. parameter expansion: $v → ${value === "" ? "<i>(empty)</i>" : esc(value)}` : `1. arr=${esc(shownArr)}: every element is expanded, then each is split`);
    const words = src.flatMap(split);
    L.push(`2. word splitting on IFS (${ifs === "default" ? "spaces/tabs/newlines" : "commas"}) → ${show(words)}`);
    const g = glob(words);
    L.push(`3. globbing: ${g.notes.length ? g.notes.map(esc).join("; ") : "no * or ? → nothing to do"}`);
    args = g.out;
  }
  L.push(`4. quote removal → the command gets <b>${args.length}</b> argument${args.length === 1 ? "" : "s"}`);
  steps.innerHTML = L.join("<br>");

  boxes.innerHTML = `<span style="${mono}font-weight:bold;">${esc(cmd)}</span>` + (args.length ? args.map((a, i) =>
    `<span style="${mono}padding:4px 8px;border-radius:6px;border:2px solid ${a === "" ? "#d6336c" : "var(--interactive-accent)"};">` +
    `<span style="font-size:10px;color:var(--text-muted);">$${i + 1} </span>${a === "" ? "<i style='color:#d6336c'>empty</i>" : esc(a)}</span>`).join("")
    : `<span style="color:#d6336c;${mono}">(no arguments at all)</span>`);

  const intended = form.includes("arr") ? arr.length : 1;
  const ok = (form === '"$v"' || form === '"${arr[@]}"');
  verdict.innerHTML = ok
    ? `✅ Quoted: what you stored is exactly what ${esc(cmd)} gets.`
    : form === "'$v'" ? `🧷 Single quotes are fully literal: ${esc(cmd)} gets the text <code>$v</code>, not the value.`
    : form === '"${arr[*]}"' ? `🔗 "\${arr[*]}" glues everything into one string. Good for printing, wrong for passing ${intended} separate items.`
    : args.length !== intended || args.some((a, i) => form === "$v" && a !== value)
      ? `❌ Unquoted: you meant ${intended} item${intended === 1 ? "" : "s"} but ${esc(cmd)} gets ${args.length}. Add double quotes.`
      : `😐 Unquoted, and it happened to work this time. A space or * in the value would break it.`;
}
vIn.oninput = render;
aIns.forEach((i) => (i.oninput = render));
ifsSel.onchange = render;
render();
