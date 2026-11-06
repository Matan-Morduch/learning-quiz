// serverless-cost: pay-per-use pricing vs a fixed monthly server, with the break-even point.
// Prices: AWS Lambda x86 list prices (us-east-1): $0.20 per 1M requests + $0.0000166667 per GB-second.
// Free tier: 1M requests + 400,000 GB-s per month. Prices change: check the current pricing page.
// input: { requests: 3000000 (per month), ms: 200, memory: 128 (MB), server: 30 ($/month), freeTier: true }

const opts = (typeof input === "object" && input) || {};
const PER_M_REQ = 0.2, PER_GBS = 0.0000166667, FREE_REQ = 1e6, FREE_GBS = 400000;
let st = { requests: 3e6, ms: 200, memory: 128, server: 30, freeTier: true, ...opts };

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
const fmtN = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${Math.round(n)}`);
const money = (x) => (x < 0.01 && x > 0 ? "<$0.01" : `$${x.toFixed(2)}`);
function slider(label, key, min, max, step, fmt, log = false) {
  const row = el("div", "display:flex;gap:8px;align-items:center;margin:2px 0;");
  el("span", "width:170px;", label, row);
  const inp = el("input", "flex:1;", null, row);
  Object.assign(inp, { type: "range", min: log ? Math.log10(min) : min, max: log ? Math.log10(max) : max, step: log ? 0.01 : step });
  inp.value = log ? Math.log10(st[key]) : st[key];
  const out = el("b", "width:110px;font-family:var(--font-monospace);font-size:13px;", null, row);
  const upd = () => (out.textContent = fmt(st[key]));
  inp.oninput = () => { st[key] = log ? Math.round(10 ** Number(inp.value)) : Number(inp.value); upd(); draw(); };
  upd();
}
slider("📨 Requests / month", "requests", 1e4, 1e9, 0, fmtN, true);
slider("⏱️ Avg duration", "ms", 10, 3000, 10, (v) => `${v} ms`);
slider("🧠 Memory", "memory", 128, 3008, 64, (v) => `${v} MB`);
slider("🖥️ Server instead", "server", 5, 300, 5, (v) => `$${v}/month`);
const ftRow = el("label", "display:block;margin:4px 0;font-size:13px;");
const ft = el("input", "", null, ftRow);
ft.type = "checkbox"; ft.checked = st.freeTier;
ftRow.appendChild(document.createTextNode(" include the monthly free tier (1M requests + 400,000 GB-s)"));
ft.onchange = () => { st.freeTier = ft.checked; draw(); };
const math = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12.5px;line-height:1.6;");
const svgWrap = el("div", "margin-top:6px;");
const verdict = el("div", "margin-top:4px;");

function cost(req) {
  const gbs = req * (st.ms / 1000) * (st.memory / 1024);
  const billReq = st.freeTier ? Math.max(0, req - FREE_REQ) : req;
  const billGbs = st.freeTier ? Math.max(0, gbs - FREE_GBS) : gbs;
  return { gbs, reqCost: (billReq / 1e6) * PER_M_REQ, gbsCost: billGbs * PER_GBS, total: (billReq / 1e6) * PER_M_REQ + billGbs * PER_GBS };
}

function draw() {
  const c = cost(st.requests);
  math.innerHTML =
    `compute = ${fmtN(st.requests)} × ${st.ms / 1000} s × ${(st.memory / 1024).toFixed(3)} GB = <b>${fmtN(c.gbs)} GB-s</b> → ${money(c.gbsCost)}<br>` +
    `requests = ${fmtN(st.requests)}${st.freeTier ? " − 1M free" : ""} → ${money(c.reqCost)}<br>` +
    `<b>serverless ≈ ${money(c.total)}/month</b> vs <b>server $${st.server}/month</b> (paid even at zero traffic)`;

  // break-even: find requests/month where serverless == server (monotonic → bisection on log scale)
  let lo = 3, hi = 11;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (cost(10 ** mid).total < st.server) lo = mid; else hi = mid; }
  const breakEven = 10 ** lo;

  const W = 600, H = 170, x0 = 50, x1 = 590, y0 = 145, y1 = 12, lx0 = 4, lx1 = 9;
  const maxC = Math.max(st.server * 3, 1);
  const X = (req) => x0 + ((Math.log10(req) - lx0) / (lx1 - lx0)) * (x1 - x0);
  const Y = (v) => y0 - (Math.min(v, maxC) / maxC) * (y0 - y1);
  let line = "";
  for (let k = 0; k <= 200; k++) { const r = 10 ** (lx0 + (k / 200) * (lx1 - lx0)); line += `${k ? "L" : "M"}${X(r).toFixed(1)} ${Y(cost(r).total).toFixed(1)} `; }
  let svg = `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" font-family="sans-serif" font-size="11">`;
  svg += `<line x1="${x0}" x2="${x1}" y1="${Y(st.server)}" y2="${Y(st.server)}" stroke="#e8590c" stroke-width="2" stroke-dasharray="6 4"/>`;
  svg += `<text x="${x0 + 4}" y="${Y(st.server) - 4}" fill="#e8590c" font-weight="bold">server $${st.server}/mo</text>`;
  svg += `<path d="${line}" fill="none" stroke="#3b82f6" stroke-width="3"/>`;
  if (breakEven < 1e9 && breakEven > 1e4) {
    svg += `<line x1="${X(breakEven)}" x2="${X(breakEven)}" y1="${y1}" y2="${y0}" stroke="#9c36b5" stroke-dasharray="3 3"/>`;
    svg += `<text x="${X(breakEven) + 4}" y="${y1 + 10}" fill="#9c36b5" font-weight="bold">break-even ≈ ${fmtN(breakEven)}/mo</text>`;
  }
  svg += `<circle cx="${X(st.requests)}" cy="${Y(c.total)}" r="6" fill="#3b82f6" stroke="white" stroke-width="2"/>`;
  svg += `<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" stroke="gray"/>`;
  for (let e = 4; e <= 9; e++) svg += `<text x="${X(10 ** e)}" y="${y0 + 14}" text-anchor="middle" fill="gray">${fmtN(10 ** e)}</text>`;
  svg += `<text x="${x0 - 4}" y="${y0}" text-anchor="end" fill="gray">$0</text><text x="${x0 - 4}" y="${y1 + 6}" text-anchor="end" fill="gray">$${maxC}</text>`;
  svg += `<text x="${x1}" y="${y0 - 4}" text-anchor="end" fill="#3b82f6">serverless cost ↗</text></svg>`;
  svgWrap.innerHTML = svg;

  const avgRate = st.requests / (30 * 86400);
  verdict.innerHTML = (c.total < st.server ? `✅ Serverless is cheaper at this volume.` : `🖥️ A server is cheaper at this volume.`) +
    ` Break-even ≈ <b>${fmtN(breakEven)} requests/month</b> (≈ ${(breakEven / (30 * 86400)).toFixed(1)} req/s on average). You're at ≈ ${avgRate.toFixed(2)} req/s.` +
    ` <span style="color:var(--text-muted);font-size:12px">Ignores extras like API gateway, data transfer, and whether one server could even handle your peak.</span>`;
}
draw();
