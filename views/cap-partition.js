// cap-partition: 3 replicas (A, B, C) of one value x. Cut the network so A is alone and B+C are together,
// then write/read in CP mode (refuse when unsure → errors) or AP mode (always answer → stale reads,
// conflicts, and lost writes when the partition heals with last-write-wins).
// input: { mode: "CP"|"AP" (default "CP"), autoplay: false }

const opts = (typeof input === "object" && input) || {};
const NODES = ["A", "B", "C"];
const POS = { A: [110, 70], B: [390, 40], C: [390, 150] };

let mode = opts.mode === "AP" ? "AP" : "CP";
let nodes, partitioned, clock, cutAt = 0, nextVal, truth, stats, log, busy = false;

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

const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const cpBtn = el("button", "", "🔒 CP: consistent", top);
const apBtn = el("button", "", "🟢 AP: available", top);
const cutBtn = el("button", "margin-left:auto;", "", top);
const playBtn = el("button", "", "▶ Play the classic scenario", top);
const svgWrap = el("div", "margin-top:6px;");
const ops = el("div", "display:grid;grid-template-columns:auto repeat(3,1fr);gap:4px;align-items:center;margin-top:4px;");
const statsEl = el("div", "margin-top:8px;font-weight:bold;");
const logEl = el("div", "margin-top:6px;font-family:var(--font-monospace);font-size:12px;max-height:150px;overflow-y:auto;background:var(--background-secondary);border-radius:6px;padding:6px;");
const resetBtn = el("button", "margin-top:6px;", "↺ Reset");

el("span", "font-size:13px;color:var(--text-muted);", "client →", ops);
const writeBtns = {}, readBtns = {};
for (const n of NODES) {
  const cell = el("div", "display:flex;gap:4px;", null, ops);
  writeBtns[n] = el("button", "flex:1;", `✍️ write to ${n}`, cell);
  readBtns[n] = el("button", "flex:1;", `👀 read ${n}`, cell);
  writeBtns[n].onclick = () => !busy && write(n);
  readBtns[n].onclick = () => !busy && read(n);
}

function reset() {
  nodes = Object.fromEntries(NODES.map((n) => [n, { x: 1, t: 0 }]));
  partitioned = false; clock = 0; nextVal = 5; truth = 1;
  stats = { errors: 0, stale: 0, lost: 0 };
  log = [];
  say(`All replicas agree: x = 1. Mode: ${mode}. Try cutting the network, then write and read on different sides.`, "gray");
  render();
}

const side = (n) => (partitioned ? (n === "A" ? ["A"] : ["B", "C"]) : NODES);
const hasMajority = (n) => side(n).length >= 2;

function say(msg, color = "inherit") {
  log.unshift(`<div style="color:${color}">${msg}</div>`);
  log = log.slice(0, 12);
}

function write(n) {
  const v = nextVal; nextVal += 2; clock++;
  if (mode === "CP" && !hasMajority(n)) {
    stats.errors++;
    say(`✍️ write x=${v} to ${n} → ❌ ERROR: ${n} can't reach a majority, so it refuses (stays consistent, not available)`, "#d6336c");
    return render();
  }
  for (const m of side(n)) nodes[m] = { x: v, t: clock };
  truth = v;
  const reached = side(n).join(", ");
  say(partitioned
    ? `✍️ write x=${v} to ${n} → ✅ accepted by ${reached}${mode === "AP" && side(n).length < 3 ? ` (the other side still has old data!)` : ""}`
    : `✍️ write x=${v} to ${n} → ✅ copied to ${reached}`, partitioned && mode === "AP" ? "#e8590c" : "inherit");
  render();
}

function read(n) {
  if (mode === "CP" && !hasMajority(n)) {
    stats.errors++;
    say(`👀 read ${n} → ❌ ERROR: ${n} is cut off and might be out of date, so it refuses`, "#d6336c");
    return render();
  }
  const val = nodes[n].x;
  if (val !== truth) {
    stats.stale++;
    say(`👀 read ${n} → x = ${val} ⚠️ STALE (the latest write was x = ${truth})`, "#e8590c");
  } else say(`👀 read ${n} → x = ${val} ✅ up to date`);
  render();
}

function toggleCut() {
  if (!partitioned) {
    partitioned = true;
    cutAt = clock;
    say(`✂️ Network partition! A can't talk to B and C. ${mode === "CP" ? "CP: the side without a majority (A) will refuse requests." : "AP: every node keeps answering, even if it's out of date."}`, "#9c36b5");
  } else {
    partitioned = false;
    // Heal: the two sides exchange data. Writes made DURING the partition have t > cutAt.
    const aWrote = nodes.A.t > cutAt, bcWrote = nodes.B.t > cutAt;
    const winner = nodes.A.t > nodes.B.t ? nodes.A : nodes.B; // last-write-wins: newest timestamp
    if (aWrote && bcWrote) {
      const loser = winner === nodes.A ? nodes.B : nodes.A;
      stats.lost++;
      say(`🩹 Healed. CONFLICT: both sides accepted different writes (A: x=${nodes.A.x}, B/C: x=${nodes.B.x}). Last-write-wins keeps x = ${winner.x}, so x = ${loser.x} is LOST 💀`, "#d6336c");
    } else {
      say(`🩹 Healed. The out-of-date side catches up: everyone now has x = ${winner.x}`, "#2b8a3e");
    }
    for (const n of NODES) nodes[n] = { ...winner };
    truth = winner.x;
  }
  render();
}

function render() {
  cpBtn.style.outline = mode === "CP" ? "2px solid #3b82f6" : "none";
  apBtn.style.outline = mode === "AP" ? "2px solid #2b8a3e" : "none";
  cutBtn.textContent = partitioned ? "🩹 Heal the network" : "✂️ Cut the network";
  let s = `<svg viewBox="0 0 500 200" width="100%" style="max-width:520px" font-family="sans-serif" font-size="13">`;
  const link = (a, b, cut) => {
    const [x1, y1] = POS[a], [x2, y2] = POS[b];
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${cut ? "#d6336c" : "gray"}" stroke-width="${cut ? 2 : 3}" ${cut ? 'stroke-dasharray="6 6"' : ""}/>`;
    if (cut) s += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 5}" text-anchor="middle" font-size="18">✂️</text>`;
  };
  link("A", "B", partitioned); link("A", "C", partitioned); link("B", "C", false);
  for (const n of NODES) {
    const [x, y] = POS[n];
    const refused = mode === "CP" && !hasMajority(n);
    const stale = nodes[n].x !== truth;
    const color = refused ? "#d6336c" : stale ? "#e8590c" : "#3b82f6";
    s += `<circle cx="${x}" cy="${y}" r="30" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="3"/>`;
    s += `<text x="${x}" y="${y - 4}" text-anchor="middle" font-weight="bold" fill="currentColor">${n}</text>`;
    s += `<text x="${x}" y="${y + 13}" text-anchor="middle" fill="currentColor" font-family="monospace">x=${nodes[n].x}</text>`;
    if (refused) s += `<text x="${x}" y="${y + 48}" text-anchor="middle" fill="#d6336c" font-size="11">refusing (no majority)</text>`;
    else if (stale) s += `<text x="${x}" y="${y + 48}" text-anchor="middle" fill="#e8590c" font-size="11">out of date</text>`;
  }
  s += `</svg>`;
  svgWrap.innerHTML = s;
  statsEl.innerHTML = `❌ errors (unavailable): <span style="color:#d6336c">${stats.errors}</span> · ⚠️ stale reads (inconsistent): <span style="color:#e8590c">${stats.stale}</span> · 💀 lost writes: <span style="color:#d6336c">${stats.lost}</span>`;
  logEl.innerHTML = log.join("");
}

async function play() {
  if (busy) return;
  busy = true;
  reset();
  const steps = [() => toggleCut(), () => write("A"), () => read("B"), () => write("B"), () => read("A"), () => toggleCut()];
  for (const step of steps) {
    await sleep(1100);
    if (!root.isConnected) return;
    step();
  }
  say(`🎬 Done. Now switch to ${mode === "CP" ? "AP" : "CP"} and play it again: same failure, opposite trade-off.`, "gray");
  render();
  busy = false;
}

cpBtn.onclick = () => { if (!busy) { mode = "CP"; reset(); } };
apBtn.onclick = () => { if (!busy) { mode = "AP"; reset(); } };
cutBtn.onclick = () => !busy && toggleCut();
playBtn.onclick = play;
resetBtn.onclick = () => !busy && reset();
reset();
if (opts.autoplay) play();
