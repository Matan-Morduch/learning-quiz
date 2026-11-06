// bvq-order: the order bash expands a command line, one stage at a time.
// brace → tilde → parameter/command/arithmetic → word splitting → globbing → quote removal → arguments.
// Presets include the classic trap: v="{1..3}"; echo $v prints {1..3} because braces ran before $v existed.
// input: { preset?: "mix"|"space"|"brace-trap"|"quotes" = "mix", step?: 0 }

const opts = (typeof input === "object" && input) || {};
const STAGES = ["typed", "1. brace", "2. tilde", "3. $ expansions", "4. word splitting", "5. globbing", "6. quote removal"];
// each preset: ctx line + one entry per stage: [text shown, what happened]. Stage 4+ text uses │ between words.
const PRESETS = {
  mix: {
    title: 'echo ~/{a,b}_$USER "$(date +%Y)" *.txt',
    ctx: "USER=matan · HOME=/home/matan · files here: a.txt b.txt",
    rows: [
      ['echo ~/{a,b}_$USER "$(date +%Y)" *.txt', "what you typed"],
      ['echo ~/a_$USER ~/b_$USER "$(date +%Y)" *.txt', "{a,b} copies the word once per item"],
      ['echo /home/matan/a_$USER /home/matan/b_$USER "$(date +%Y)" *.txt', "~ at the start of a word → $HOME"],
      ['echo /home/matan/a_matan /home/matan/b_matan "2026" *.txt', "$USER → matan, $(date +%Y) runs date → 2026"],
      ['echo │ /home/matan/a_matan │ /home/matan/b_matan │ "2026" │ *.txt', "split into words (the quoted 2026 is protected)"],
      ['echo │ /home/matan/a_matan │ /home/matan/b_matan │ "2026" │ a.txt │ b.txt', "*.txt → matching file names"],
      ["echo │ /home/matan/a_matan │ /home/matan/b_matan │ 2026 │ a.txt │ b.txt", "the quote characters themselves disappear"],
    ],
  },
  space: {
    title: 'f="my file.txt"; rm $f',
    ctx: 'f="my file.txt" · files here: "my file.txt"',
    rows: [
      ["rm $f", "what you typed"],
      ["rm $f", "no braces"],
      ["rm $f", "no ~"],
      ["rm my file.txt", "$f → my file.txt (unquoted!)"],
      ["rm │ my │ file.txt", "the space inside the value splits it into 2 words 💥"],
      ["rm │ my │ file.txt", "no * or ? → nothing to glob"],
      ["rm │ my │ file.txt", "rm gets 2 args: 'my' and 'file.txt' (both don't exist)"],
    ],
  },
  "brace-trap": {
    title: 'v="{1..3}"; echo $v',
    ctx: 'v="{1..3}"',
    rows: [
      ["echo $v", "what you typed"],
      ["echo $v", "no braces in the TYPED line yet: $v hasn't been expanded"],
      ["echo $v", "no ~"],
      ["echo {1..3}", "$v → {1..3}, but brace expansion already ran (stage 1)"],
      ["echo │ {1..3}", "no spaces to split on"],
      ["echo │ {1..3}", "no * or ? → nothing to glob"],
      ["echo │ {1..3}", "prints {1..3}, not 1 2 3. Braces only work when typed"],
    ],
  },
  quotes: {
    title: `echo "$HOME" '$HOME' ~ "~"`,
    ctx: "HOME=/home/matan",
    rows: [
      [`echo "$HOME" '$HOME' ~ "~"`, "what you typed"],
      [`echo "$HOME" '$HOME' ~ "~"`, "no braces"],
      [`echo "$HOME" '$HOME' /home/matan "~"`, "only the UNQUOTED ~ expands"],
      [`echo "/home/matan" '$HOME' /home/matan "~"`, "$ expands inside double quotes, not inside single"],
      [`echo │ "/home/matan" │ '$HOME' │ /home/matan │ "~"`, "split on the unquoted spaces"],
      [`echo │ "/home/matan" │ '$HOME' │ /home/matan │ "~"`, "no * or ?"],
      ["echo │ /home/matan │ $HOME │ /home/matan │ ~", "quotes removed → 4 args"],
    ],
  },
};
let preset = PRESETS[opts.preset] ? opts.preset : "mix";
let step = Math.max(0, Math.min(6, opts.step ?? 0));

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

const pre = el("div", "display:flex;gap:4px;flex-wrap:wrap;");
const preBtns = Object.keys(PRESETS).map((k) => { const b = el("button", mono + "font-size:12px;", PRESETS[k].title, pre); b.onclick = () => { preset = k; step = 0; render(); }; return b; });
const ctx = el("div", "font-size:12px;color:var(--text-muted);margin-top:6px;");
const rail = el("div", "display:flex;gap:3px;flex-wrap:wrap;margin-top:8px;");
const line = el("div", mono + "font-size:14px;margin-top:10px;padding:10px;border-radius:6px;background:var(--background-secondary);word-break:break-all;min-height:1.6em;");
const note = el("div", "margin-top:6px;font-size:13px;min-height:1.4em;");
const ctl = el("div", "display:flex;gap:6px;margin-top:8px;");
const back = el("button", "", "◀ Back", ctl);
const fwd = el("button", "", "Next stage ▶", ctl);
const play = el("button", "", "▶ Play all", ctl);
let busy = false;

function render() {
  const P = PRESETS[preset];
  preBtns.forEach((b, i) => (b.style.outline = Object.keys(PRESETS)[i] === preset ? "2px solid var(--interactive-accent)" : ""));
  ctx.textContent = P.ctx;
  rail.innerHTML = STAGES.map((s, i) => `<span style="font-size:11px;padding:3px 6px;border-radius:5px;${i === step ? "background:var(--interactive-accent);color:var(--text-on-accent);" : i < step ? "color:var(--text-muted);text-decoration:line-through;" : "color:var(--text-faint);border:1px dashed var(--background-modifier-border);"}">${s}</span>`).join("");
  const [text, why] = P.rows[step];
  const changed = step > 0 && text !== P.rows[step - 1][0];
  if (step >= 4) {
    const words = text.split(" │ ");
    line.innerHTML = words.map((w, i) => `<span style="display:inline-block;margin:2px;padding:2px 6px;border-radius:5px;border:2px solid ${i === 0 ? "gray" : "var(--interactive-accent)"};">${esc(w)}</span>`).join("") +
      (step === 6 ? `<div style="margin-top:6px;color:var(--text-muted);">command: <b>${esc(words[0])}</b>, ${words.length - 1} argument(s)</div>` : "");
  } else line.textContent = text;
  note.innerHTML = `${changed ? "✏️" : "·"} <b>${STAGES[step]}</b>: ${esc(why)}`;
  back.disabled = step === 0 || busy; fwd.disabled = step === 6 || busy;
}
back.onclick = () => { if (step > 0) { step--; render(); } };
fwd.onclick = () => { if (step < 6) { step++; render(); } };
play.onclick = () => {
  if (busy) return;
  busy = true; step = 0; render();
  const tick = () => {
    if (!root.isConnected) return;
    if (step >= 6) { busy = false; render(); return; }
    step++; render();
    setTimeout(tick, 1100);
  };
  setTimeout(tick, 900);
};
render();
