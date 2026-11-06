// ring-buffer: a ring buffer is a plain array + read/write indexes that wrap around.
// The ring on top and the array underneath are the SAME memory. Enqueue/dequeue/peek,
// the three full-vs-empty strategies, reject vs overwrite, grow ×2 (unwrap copy), and
// optional deque ops (push_front / pop_back). Click a filled array cell to see its k.
// input: {
//   cap?: 2–16 slots (default 8; strategy "free" rounds up to a power of 2),
//   strategy?: "count" | "slot" | "free"  (default "count"),
//   policy?: "reject" | "overwrite"  (default "reject"),
//   deque?: boolean, adds push_front / pop_back (default false),
//   fill?: items enqueued at the start (default 0, capped at the usable capacity),
//   start?: index where read/write begin, so a fill can start already wrapped (default 0)
// }

const opts = (typeof input === "object" && input) || {};
const STRATS = { count: "1: count variable", slot: "2: leave one slot empty", free: "3: free-running counters + mask" };
let strategy = STRATS[opts.strategy] ? opts.strategy : "count";
let policy = opts.policy === "overwrite" ? "overwrite" : "reject";
const DEQUE = !!opts.deque;
const CAP0 = Math.max(2, Math.min(16, Math.round(Number(opts.cap) || 8)));
const FILL0 = Math.max(0, Math.round(Number(opts.fill) || 0));
const START0 = Math.max(0, Math.round(Number(opts.start) || 0));
const MAXCAP = 32;

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

// ---------- UI ----------
const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const stratSel = el("select", "", null, top);
for (const k in STRATS) { const o = el("option", "", "Strategy " + STRATS[k], stratSel); o.value = k; }
stratSel.value = strategy;
const policySel = el("select", "", null, top);
for (const [v, t] of [["reject", "When full: reject"], ["overwrite", "When full: overwrite oldest"]]) { const o = el("option", "", t, policySel); o.value = v; }
policySel.value = policy;

const ops = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;");
const enqBtn = el("button", "", "➕ Enqueue", ops);
const deqBtn = el("button", "", "➖ Dequeue", ops);
const peekBtn = el("button", "", "👀 Peek", ops);
const pfBtn = DEQUE ? el("button", "", "⬅️ push_front", ops) : null;
const pbBtn = DEQUE ? el("button", "", "↩️ pop_back", ops) : null;
const growBtn = el("button", "", "🌱 Grow ×2", ops);
const resetBtn = el("button", "", "↺ Reset", ops);

const ringWrap = el("div", "text-align:center;");
const oldWrap = el("div", "");
const arrWrap = el("div", "");
const vars = el("div", "font-family:var(--font-monospace);font-size:12px;margin-top:8px;line-height:1.6;");
const logEl = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:2.5em;line-height:1.6;");

// ---------- state ----------
let cap, data, read, write, count, next, busy = false, flash = {}, flashId = 0, growOld = null;
const isPow2 = (n) => (n & (n - 1)) === 0;
const mask = () => cap - 1;
const bits = () => Math.max(1, Math.log2(cap));
const bin = (n, w) => n.toString(2).padStart(w, "0");
const slot = (i) => (strategy === "free" ? i & mask() : i);
function size() {
  if (strategy === "count") return count;
  if (strategy === "slot") return (write - read + cap) % cap;
  return write - read;
}
const usable = () => (strategy === "slot" ? cap - 1 : cap);
const isEmpty = () => size() === 0;
const isFull = () => size() === usable();
const letter = () => String.fromCharCode(65 + (next++ % 26));

// move read or write by ±1 and return the narration
function step(name, d) {
  const old = name === "read" ? read : write;
  let v, msg;
  if (strategy === "free") {
    v = old + d;
    const s = v & mask();
    msg = `${name} = ${old} ${d > 0 ? "+" : "−"} 1 = ${v} → slot ${v} & ${mask()} = ` +
      (v >= 0 ? `${bin(v, bits() + 1)} & ${bin(mask(), bits() + 1)} = ` : "") + `${s}`;
  } else if (d > 0) {
    v = (old + 1) % cap;
    msg = `${name} = (${old} + 1) % ${cap} = ${v}${v === 0 ? "  ↩ wrapped!" : ""}`;
  } else {
    v = (old - 1 + cap) % cap;
    msg = `${name} = (${old} − 1 + ${cap}) % ${cap} = ${v}${old === 0 ? "  ↩ wrapped backward!" : ""}`;
  }
  if (name === "read") read = v; else write = v;
  return msg;
}
function fullReason() {
  if (strategy === "count") return `count == cap (${count} == ${cap})`;
  if (strategy === "slot") return `(write + 1) % cap == read → (${write} + 1) % ${cap} == ${read}`;
  return `write − read == cap → ${write} − ${read} == ${cap}`;
}
function emptyReason() {
  if (strategy === "count") return "count == 0";
  if (strategy === "slot") return `read == write (${read} == ${write})`;
  return `write − read == 0 (${write} − ${read})`;
}
function setFlash(map) {
  flash = map;
  const id = ++flashId;
  setTimeout(() => { if (root.isConnected && id === flashId) { flash = {}; render(); } }, 700);
}

function reset() {
  cap = CAP0;
  let note = "";
  if (strategy === "free" && !isPow2(cap)) {
    let p = 1; while (p < cap) p *= 2;
    note = `Strategy 3 needs a power of 2: cap ${cap} → ${p}. `;
    cap = p;
  }
  data = Array(cap).fill(null);
  read = write = strategy === "free" ? START0 : START0 % cap;
  count = 0; next = 0; growOld = null; flash = {};
  const n = Math.min(FILL0, usable());
  for (let i = 0; i < n; i++) { data[slot(write)] = letter(); step("write", 1); count++; }
  if (FILL0 > n) note += `Asked for ${FILL0} items, but only ${n} fit. `;
  if (isEmpty()) note += `Empty: ${emptyReason()}.` + (strategy === "slot" ? ` This strategy holds at most cap − 1 = ${cap - 1}.` : "");
  else if (isFull()) note += `Enqueued ${n}: FULL. ${fullReason()}` + (slot(read) === slot(write) ? ` (and read == write, same as empty!)` : "");
  else note += `Enqueued ${n} items: ${size()}/${usable()} used.`;
  logEl.innerHTML = note;
  render();
}

function enqueue() {
  if (busy) return;
  const lines = [];
  if (isFull()) {
    if (policy === "reject") { logEl.innerHTML = `💥 FULL: write rejected. ${fullReason()}`; setFlash({ [slot(read)]: "var(--text-error)" }); return render(); }
    const lost = data[slot(read)];
    data[slot(read)] = null;
    lines.push(`♻️ full → overwrite: dropped oldest <b>${lost}</b>, ${step("read", 1)}`);
    count--;
  }
  const x = letter(), s = slot(write);
  data[s] = x;
  lines.push(`data[${s}] = <b>${x}</b>`, step("write", 1));
  count++;
  if (isFull()) lines.push(`now FULL: ${fullReason()}`);
  logEl.innerHTML = lines.join("<br>");
  setFlash({ [s]: "#2b8a3e" });
  render();
}
function dequeue() {
  if (busy) return;
  if (isEmpty()) { logEl.innerHTML = `🫙 EMPTY: nothing to dequeue. ${emptyReason()}`; return render(); }
  const s = slot(read), x = data[s];
  data[s] = null;
  const msg = step("read", 1);
  count--;
  logEl.innerHTML = `dequeued <b>${x}</b> from data[${s}]. Nothing shifted.<br>${msg}`;
  setFlash({ [s]: "var(--text-error)" });
  render();
}
function peek() {
  if (busy) return;
  if (isEmpty()) { logEl.innerHTML = `🫙 EMPTY: nothing to peek at. ${emptyReason()}`; return; }
  logEl.innerHTML = `oldest item is <b>${data[slot(read)]}</b> at data[${slot(read)}] (not removed)`;
  setFlash({ [slot(read)]: "#3b82f6" });
  render();
}
function pushFront() {
  if (busy) return;
  const lines = [];
  if (isFull()) {
    if (policy === "reject") { logEl.innerHTML = `💥 FULL: push_front rejected. ${fullReason()}`; return render(); }
    const m = step("write", -1);
    lines.push(`♻️ full → overwrite: dropped newest <b>${data[slot(write)]}</b>, ${m}`);
    data[slot(write)] = null;
    count--;
  }
  lines.push(step("read", -1));
  const x = letter(), s = slot(read);
  data[s] = x; count++;
  lines.push(`data[${s}] = <b>${x}</b> (new front)`);
  logEl.innerHTML = lines.join("<br>");
  setFlash({ [s]: "#9c36b5" });
  render();
}
function popBack() {
  if (busy) return;
  if (isEmpty()) { logEl.innerHTML = `🫙 EMPTY: nothing to pop. ${emptyReason()}`; return render(); }
  const msg = step("write", -1);
  const s = slot(write), x = data[s];
  data[s] = null; count--;
  logEl.innerHTML = `${msg}<br>popped newest <b>${x}</b> from data[${s}]`;
  setFlash({ [s]: "var(--text-error)" });
  render();
}

async function grow() {
  if (busy) return;
  if (cap * 2 > MAXCAP) { logEl.textContent = `Max size here is ${MAXCAP}.`; return; }
  busy = true;
  const n = size(), oldCap = cap, oldData = data.slice(), oldRead = read;
  const before = oldData.map((x) => x ?? "·").join(" ");
  const src = [];
  for (let k = 0; k < n; k++) src.push(strategy === "free" ? (read + k) & (oldCap - 1) : (read + k) % oldCap);
  growOld = { data: oldData, cap: oldCap, hl: -1 };
  cap = oldCap * 2;
  data = Array(cap).fill(null);
  for (let k = 0; k < n; k++) {
    growOld.hl = src[k];
    data[k] = oldData[src[k]];
    flash = { [k]: "#2b8a3e" };
    logEl.innerHTML = `copy ${k + 1}/${n}: k = ${k} → old[(${oldRead} + ${k}) ${strategy === "free" ? "& " + (oldCap - 1) : "% " + oldCap}] = old[${src[k]}] = <b>${data[k]}</b> → new[${k}]`;
    render();
    await sleep(Math.max(150, 1600 / Math.max(1, n)));
    if (!root.isConnected) return;
  }
  growOld = null; flash = {};
  read = 0; write = n; count = n;
  logEl.innerHTML = `old (cap ${oldCap}, read = ${oldRead}): [${before}]<br>copied ${n} items oldest → newest (unwrapped)<br>` +
    `new (cap ${cap}): [${data.map((x) => x ?? "·").join(" ")}] · read = 0, write = ${n}`;
  busy = false;
  render();
}

// ---------- drawing ----------
function cellsHtml(values, c, markers, hl, clickable) {
  const w = c <= 16 ? 32 : 20;
  let h = `<div style="display:flex;gap:2px;flex-wrap:wrap;margin-top:4px;">`;
  for (let i = 0; i < c; i++) {
    const v = values[i], filled = v != null;
    const bg = hl[i] || (filled ? "var(--interactive-accent)" : "transparent");
    h += `<div data-i="${i}" style="width:${w}px;text-align:center;${clickable ? "cursor:pointer;" : ""}">
      <div data-i="${i}" style="height:30px;line-height:26px;border:${markers[i] || "1px solid var(--background-modifier-border)"};border-radius:4px;font-weight:bold;
        background:${bg};color:${filled || hl[i] ? "var(--text-on-accent)" : "var(--text-faint)"};transition:background .2s;box-sizing:border-box;">${filled ? v : "·"}</div>
      <div data-i="${i}" style="font-size:10px;color:var(--text-muted)">${i}</div></div>`;
  }
  return h + "</div>";
}

function render() {
  const empty = isEmpty(), full = isFull();
  const rs = slot(read), ws = slot(write), showIdx = !growOld;
  const reserved = strategy === "slot" && full && showIdx ? ws : -1;
  // ring
  const cx = 160, cy = 150, R = cap <= 8 ? 90 : cap <= 16 ? 105 : 115, r = cap <= 8 ? 24 : cap <= 16 ? 16 : 9;
  let s = `<svg viewBox="0 0 320 300" width="100%" style="max-width:300px" font-family="sans-serif">`;
  for (let i = 0; i < cap; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / cap;
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    const filled = data[i] != null;
    const isR = showIdx && i === rs && !empty, isW = showIdx && i === ws && !full;
    const stroke = isR ? "#2b8a3e" : isW ? "#e8590c" : i === reserved ? "#d6336c" : "var(--text-faint)";
    const fill = flash[i] || (filled ? "var(--interactive-accent)" : "none");
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${isR || isW || i === reserved ? 4 : 1.5}"${i === reserved ? ' stroke-dasharray="4 3"' : ""}/>`;
    if (r >= 15) s += `<text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="middle" font-size="${r >= 20 ? 17 : 12}" font-weight="bold" fill="${filled ? "var(--text-on-accent)" : "var(--text-faint)"}">${filled ? data[i] : i === reserved ? "🚫" : "·"}</text>`;
    const lx = cx + (R + r + 12) * Math.cos(a), ly = cy + (R + r + 12) * Math.sin(a) + 4;
    const tag = (showIdx && i === rs ? "R" : "") + (showIdx && i === ws ? "W" : "");
    if (tag) s += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="12" font-weight="bold" fill="${tag === "W" ? "#e8590c" : "#2b8a3e"}">${tag === "RW" ? "R=W" : tag}</text>`;
  }
  const label = growOld ? "copying…" : empty ? "EMPTY" : full ? "FULL" : `${size()}/${usable()}`;
  s += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="18" font-weight="bold" fill="var(--text-normal)">${label}</text></svg>`;
  ringWrap.innerHTML = s;

  // memory (old array while growing)
  oldWrap.innerHTML = growOld
    ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">old array (cap ${growOld.cap}):</div>` +
      cellsHtml(growOld.data, growOld.cap, {}, { [growOld.hl]: "#e8590c" }, false)
    : "";
  const markers = {};
  if (showIdx) {
    if (!empty) markers[rs] = "3px solid #2b8a3e";
    if (!full) markers[ws] = markers[ws] || "3px solid #e8590c";
    if (reserved >= 0) markers[reserved] = "3px dashed #d6336c";
  }
  arrWrap.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">${growOld ? `new array (cap ${cap}):` : "what's really in memory (a plain array), click an item:"}</div>` +
    cellsHtml(data, cap, markers, flash, !growOld);

  if (growOld) { vars.innerHTML = ""; return; }
  const common = `<span style="color:#2b8a3e">● read = ${read}</span> · <span style="color:#e8590c">● write = ${write}</span> · cap = ${cap}`;
  const same = rs === ws ? `<br>read == write → ${strategy === "count" ? `count = ${count} decides: <b>${empty ? "EMPTY" : "FULL"}</b>` : strategy === "free" ? `slots match, but write − read = ${size()} decides: <b>${empty ? "EMPTY" : "FULL"}</b>` : "<b>EMPTY</b> (full never gets here)"}` : "";
  if (strategy === "count") vars.innerHTML = `${common} · count = ${count}${same}`;
  else if (strategy === "slot") vars.innerHTML = `${common} · size = (write − read + cap) % cap = (${write} − ${read} + ${cap}) % ${cap} = ${size()} · usable = ${cap - 1}${same}`;
  else vars.innerHTML = `${common} · mask = ${mask()} (${bin(mask(), bits())}) · size = write − read = ${size()}<br>slots: read & ${mask()} = ${rs}, write & ${mask()} = ${ws}${same}`;
}

arrWrap.onclick = (e) => {
  if (busy || growOld) return;
  const t = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
  if (!t) return;
  const i = Number(t.getAttribute("data-i"));
  if (data[i] == null) { logEl.innerHTML = `data[${i}] is a free slot (not part of the queue).`; return; }
  const k = (i - slot(read) + cap) % cap;
  const f = strategy === "free" ? `(read + k) & ${mask()} = (${read} + ${k}) & ${mask()}` : `(read + k) % cap = (${read} + ${k}) % ${cap}`;
  logEl.innerHTML = `<b>${data[i]}</b> is item k = ${k} (k = 0 is the oldest)${k === size() - 1 ? ", the newest" : ""}<br>slot = ${f} = ${i}`;
  setFlash({ [i]: "#9c36b5" });
  render();
};

stratSel.onchange = () => { if (busy) { stratSel.value = strategy; return; } strategy = stratSel.value; reset(); };
policySel.onchange = () => { policy = policySel.value; logEl.innerHTML = `When full: ${policy === "reject" ? "refuse the write" : "drop the oldest, then write"}.`; };
enqBtn.onclick = enqueue;
deqBtn.onclick = dequeue;
peekBtn.onclick = peek;
if (pfBtn) pfBtn.onclick = pushFront;
if (pbBtn) pbBtn.onclick = popBack;
growBtn.onclick = grow;
resetBtn.onclick = () => { if (!busy) reset(); };

reset();
