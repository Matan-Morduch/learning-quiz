// conflict-resolve: an AP shopping cart on two replicas diverges during a partition (A adds Mug, B removes Pen).
// When the network heals, settle the conflict with last-write-wins (loses a write; fooled by clock skew),
// merge (union: nothing added is lost, but a removed item comes back), or ask the user (like git).
// input: { strategy: "lww"|"merge"|"ask" (default "lww"), skew: false, autoplay: false }

const opts = (typeof input === "object" && input) || {};
let strategy = ["lww", "merge", "ask"].includes(opts.strategy) ? opts.strategy : "lww";
let skew = !!opts.skew;
let stage = 4;          // 0 synced, 1 cut, 2 A edits, 3 B edits, 4 healed (start at the end: the answer is visible)
let userPick = null;    // for "ask": "A" | "B" | "both"
let busy = false;

const START = ["📕 Book", "🖊️ Pen"];
const A_CART = ["📕 Book", "🖊️ Pen", "☕ Mug"];   // phone: added Mug at 10:01 (real time)
const B_CART = ["📕 Book"];                         // laptop: removed Pen at 10:02 (real time)
const INTENT = ["📕 Book", "☕ Mug"];               // what the user actually wanted

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

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;");
const btns = {
  lww: el("button", "", "🕐 Last write wins", bar),
  merge: el("button", "", "🔀 Merge", bar),
  ask: el("button", "", "🙋 Ask the user", bar),
};
const skewLbl = el("label", "font-size:13px;display:flex;gap:4px;align-items:center;", null, bar);
const skewBox = el("input", "", null, skewLbl);
skewBox.type = "checkbox";
el("span", "", "laptop clock 5 min slow", skewLbl);
const playBtn = el("button", "", "▶ Replay", bar);

const board = el("div", "display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;");
const result = el("div", "margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);min-height:3em;");
const askRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;");
const note = el("div", "margin-top:6px;font-size:13px;color:var(--text-muted);min-height:1.4em;");

const stampA = () => "10:01";
const stampB = () => (skew ? "09:57" : "10:02");

function card(title, items, stamp, color, highlight) {
  const list = items.map((x) => `<div style="padding:2px 6px;margin:2px 0;border-radius:4px;background:${highlight && highlight(x) ? color + "33" : "transparent"}">${x}</div>`).join("");
  return `<div style="flex:1;min-width:140px;border:2px solid ${color};border-radius:8px;padding:6px;">
    <div style="font-weight:bold;">${title}</div>
    <div style="font-size:12px;color:var(--text-muted);min-height:1.3em;">${stamp || "&nbsp;"}</div>${list || '<div style="color:var(--text-faint)">(empty)</div>'}</div>`;
}

function mergeCarts() { return START.concat(A_CART.filter((x) => !START.includes(x))); } // union, keep order

function render() {
  for (const k in btns) btns[k].style.outline = k === strategy ? "2px solid var(--interactive-accent)" : "none";
  skewBox.checked = skew;
  const aItems = stage >= 2 ? A_CART : START;
  const bItems = stage >= 3 ? B_CART : START;
  const aStamp = stage >= 2 ? `+ ☕ Mug at ${stampA()} (phone clock)` : "";
  const bStamp = stage >= 3 ? `− 🖊️ Pen at ${stampB()} (laptop clock)${skew ? " ⏰" : ""}` : "";
  const link = stage === 0 || stage === 4 ? `<div style="align-self:center;font-size:20px;">🔗</div>`
    : `<div style="align-self:center;font-size:20px;color:#d6336c;">✂️</div>`;
  board.innerHTML = card("📱 Replica A (phone)", aItems, aStamp, "#3b82f6", (x) => stage >= 2 && x === "☕ Mug")
    + link + card("💻 Replica B (laptop)", bItems, bStamp, "#9c36b5");
  askRow.innerHTML = "";
  const steps = ["Both replicas agree: [Book, Pen]", "✂️ Network cut: the replicas can't talk (AP: both keep accepting)",
    "📱 A: you add a Mug. Accepted on A only", "💻 B: you remove the Pen (1 min later, real time). Accepted on B only"];
  if (stage < 4) { result.innerHTML = steps[stage]; note.textContent = ""; return; }

  // healed: settle the conflict
  let final = null, msg = "";
  if (strategy === "lww") {
    const bWins = !skew; // 10:02 > 10:01, but with skew 09:57 < 10:01
    final = bWins ? B_CART : A_CART;
    msg = bWins
      ? `Timestamps: B ${stampB()} > A ${stampA()} → keep B's whole cart. <b style="color:#d6336c">☕ Mug is LOST</b> (you added it, it vanished silently).`
      : `Timestamps: A ${stampA()} > B ${stampB()} → keep A's cart. But B's edit really happened <i>later</i>: the slow clock made LWW pick the wrong winner. <b style="color:#d6336c">Your "remove Pen" is LOST</b>.`;
  } else if (strategy === "merge") {
    final = mergeCarts();
    msg = `Union of both carts (clocks don't matter). <b style="color:#2b8a3e">☕ Mug kept</b>, but <b style="color:#e8590c">🖊️ Pen came back</b>: the merge can't tell "removed on B" from "never touched". (Amazon's cart does this.)`;
  } else {
    if (!userPick) {
      msg = `⚠️ CONFLICT: both versions kept, nothing decided automatically. Like a <b>git merge conflict</b>, you choose:`;
      for (const [k, label] of [["A", "Keep A's cart"], ["B", "Keep B's cart"], ["both", "Combine: Book + Mug"]]) {
        const b = el("button", "", label, askRow);
        b.onclick = () => { if (!busy) { userPick = k; render(); } };
      }
    } else {
      final = userPick === "A" ? A_CART : userPick === "B" ? B_CART : INTENT;
      msg = userPick === "both" ? `You combined them by hand: exactly what you meant. Correct, but it needed a human (slow).`
        : `You picked ${userPick}'s version: correct only if that's what you meant. A human had to decide.`;
    }
  }
  const lostAdds = final ? INTENT.filter((x) => !final.includes(x)).length : 0;
  const zombies = final ? final.filter((x) => !INTENT.includes(x)).length : 0;
  result.innerHTML = `🩹 Healed. ${msg}` + (final ? `<div style="margin-top:6px;font-family:var(--font-monospace);">final cart = [${final.join(", ")}]</div>` : "");
  note.textContent = final ? `vs what you meant [Book, Mug]: added items lost = ${lostAdds} · removed items back = ${zombies}` : "";
}

async function play() {
  if (busy) return;
  busy = true; userPick = null;
  for (stage = 0; stage <= 4; stage++) {
    render();
    if (stage < 4) { await sleep(1000); if (!root.isConnected) return; }
  }
  stage = 4;
  busy = false;
  render();
}

for (const k in btns) btns[k].onclick = () => { if (!busy) { strategy = k; userPick = null; render(); } };
skewBox.onchange = () => { if (busy) { skewBox.checked = skew; return; } skew = skewBox.checked; userPick = null; render(); };
playBtn.onclick = play;
render();
if (opts.autoplay) play();
