// quorum-lab: N replicas; a write must be confirmed by W of them, a read asks R of them and keeps the newest.
// If R + W > N, every read group overlaps every write group → reads always see the latest write.
// Worst case modeled: the N − W replicas that missed the write haven't caught up yet.
// input: { n: 3 (1–7), w: 2, r: 2 }

const opts = (typeof input === "object" && input) || {};
let N = Math.max(1, Math.min(7, opts.n ?? 3));
let W = Math.max(1, Math.min(N, opts.w ?? 2));
let R = Math.max(1, Math.min(N, opts.r ?? 2));

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
function slider(label, get, set) {
  const row = el("div", "display:flex;gap:8px;align-items:center;margin:3px 0;");
  el("span", "width:190px;", label, row);
  const inp = el("input", "flex:1;", null, row);
  inp.type = "range"; inp.min = 1; inp.step = 1;
  const out = el("b", "width:30px;font-family:var(--font-monospace);", null, row);
  inp.addEventListener("input", () => { set(Number(inp.value)); sync(); fresh(); });
  return { inp, out, get };
}
const sN = slider("N = replicas (copies)", () => N, (v) => { N = v; W = Math.min(W, N); R = Math.min(R, N); });
const sW = slider("W = must confirm a write", () => W, (v) => (W = v));
const sR = slider("R = asked on a read", () => R, (v) => (R = v));
const presets = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;");
for (const [label, n, w, r] of [["N3 W2 R2 (classic)", 3, 2, 2], ["N3 W1 R1 (fast, risky)", 3, 1, 1], ["N3 W3 R1 (read-heavy)", 3, 3, 1], ["N5 W3 R3", 5, 3, 3]]) {
  const b = el("button", "", label, presets);
  b.onclick = () => { N = n; W = w; R = r; sync(); fresh(); };
}
const rule = el("div", "padding:8px;border-radius:6px;background:var(--background-secondary);margin:6px 0;");
const ctrl = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
const wBtn = el("button", "", "✍️ Write new version", ctrl);
const rBtn = el("button", "", "👀 Read", ctrl);
const tBtn = el("button", "", "🎲 Run 1000 write+read trials", ctrl);
const row = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;");
const msg = el("div", "font-family:var(--font-monospace);font-size:13px;min-height:2.8em;");

let versions, latest, readSet = new Set(), writeSet = new Set();

function sync() {
  for (const s of [sN, sW, sR]) { s.out.textContent = s.get(); }
  sN.inp.max = 7; sW.inp.max = N; sR.inp.max = N;
  sN.inp.value = N; sW.inp.value = W; sR.inp.value = R;
  const overlap = R + W > N;
  rule.innerHTML =
    `R + W = ${R} + ${W} = <b>${R + W}</b> ${overlap ? ">" : "≤"} N = ${N} → ` +
    (overlap ? `<b style="color:#2b8a3e">every read overlaps the last write: never stale ✅</b>`
      : `<b style="color:#d6336c">a read can miss every updated replica: stale reads possible ⚠️</b>`) +
    `<br><span style="font-size:13px;color:var(--text-muted);">Writes keep working with up to <b>${N - W}</b> replica(s) down · reads with up to <b>${N - R}</b> down. ` +
    `Bigger W/R = more consistent but slower and less available. Smaller = faster, more available, riskier.</span>`;
}

function pick(k) {
  const idx = [...Array(N).keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return new Set(idx.slice(0, k));
}

function fresh() {
  versions = Array(N).fill(1); latest = 1; readSet = new Set(); writeSet = new Set();
  msg.textContent = "All replicas have version 1. Write a new version, then read.";
  draw();
}

function draw() {
  row.innerHTML = "";
  for (let i = 0; i < N; i++) {
    const up = versions[i] === latest;
    const inR = readSet.has(i), inW = writeSet.has(i);
    const b = el("div", `width:62px;text-align:center;border-radius:8px;padding:6px 0;border:3px solid ${inR ? "#9c36b5" : "transparent"};
      background:${up ? "var(--interactive-accent)" : "var(--background-secondary)"};color:${up ? "var(--text-on-accent)" : "var(--text-muted)"};`, null, row);
    el("div", "font-size:11px;", `replica ${i + 1}`, b);
    el("div", "font-weight:bold;font-family:var(--font-monospace);", `v${versions[i]}`, b);
    el("div", "font-size:10px;min-height:1.2em;", `${inW ? "✍️ wrote" : ""}${inR ? " 👀 read" : ""}`, b);
  }
}

wBtn.onclick = () => {
  latest++;
  writeSet = pick(W); readSet = new Set();
  // worst case: replicas outside the write group have NOT caught up yet
  for (const i of writeSet) versions[i] = latest;
  msg.textContent = `Wrote v${latest}: confirmed by ${W} replica(s) (${[...writeSet].map((i) => i + 1).join(", ")}). The other ${N - W} still have old data.`;
  draw();
};
rBtn.onclick = () => {
  readSet = pick(R);
  const got = Math.max(...[...readSet].map((i) => versions[i]));
  msg.innerHTML = `Asked replica(s) ${[...readSet].map((i) => i + 1).join(", ")} and kept the newest they had: v${got} → ` +
    (got === latest ? `<b style="color:#2b8a3e">up to date ✅</b>` : `<b style="color:#d6336c">STALE ⚠️ (latest is v${latest})</b>`);
  draw();
};
tBtn.onclick = () => {
  let stale = 0;
  for (let t = 0; t < 1000; t++) {
    const w = pick(W), r = pick(R);
    if (![...r].some((i) => w.has(i))) stale++;
  }
  msg.innerHTML = `1000 trials with N=${N}, W=${W}, R=${R}: <b style="color:${stale ? "#d6336c" : "#2b8a3e"}">${stale} stale reads (${(stale / 10).toFixed(1)}%)</b>` +
    (R + W > N ? " (R + W > N makes this impossible)" : " (read group and write group didn't overlap)");
};

sync();
fresh();
