// cap-choose: game. The network between data centers breaks. For each system, should it stay
// Consistent (refuse some requests) or Available (answer, maybe with stale data)?
// input: { shuffle: true }

const opts = (typeof input === "object" && input) || {};
const CASES = [
  ["🏦 Bank account balance / money transfers", "CP", "Showing a wrong balance or letting the same money be spent twice is far worse than \"try again later\"."],
  ["🛒 Shopping cart (\"add to cart\")", "AP", "Amazon's Dynamo paper: the cart must always accept items. Merging two cart versions later is cheap; refusing sales is not."],
  ["❤️ Like counter on a social post", "AP", "If one side shows 1,203 likes and the other 1,207 for a few seconds, nobody is hurt."],
  ["🎟️ Booking the last seat on a flight", "CP", "Two people must not both get seat 14C. Better to refuse one booking than to double-sell."],
  ["🌐 DNS (domain name → IP address)", "AP", "DNS answers from caches that can be minutes old. Always answering beats being exact, and changes spread eventually."],
  ["🔐 Choosing the cluster leader / config store (etcd, ZooKeeper)", "CP", "Two leaders at once (split brain) would corrupt everything. Only the majority side may decide."],
  ["📺 YouTube view counter", "AP", "The count can lag or differ between regions for a while. It just has to add up eventually."],
  ["🆔 Registering a unique username", "CP", "If both sides accept \"alex\" during the split, two accounts end up with the same name."],
  ["💬 Chat app: \"message delivered\" status", "AP", "Keep letting people send messages during the split and sync them later. Stopping all chat would be worse."],
  ["📦 Selling the last item in stock", "CP", "Accepting two orders for one item means cancelling a customer later. (Some shops choose AP here and apologize: it's a business decision!)"],
];

let pool = opts.shuffle === false ? CASES : CASES.map((c) => [Math.random(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
let idx = 0, score = 0, done = 0, answered = false;

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
const head = el("div", "display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);");
const count = el("span", "", "", head);
const scoreEl = el("span", "", "", head);
el("div", "margin-top:6px;", "✂️ The network splits. What should this system do?");
const q = el("div", "font-size:18px;font-weight:bold;margin:8px 0;min-height:1.5em;");
const btns = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
const cp = el("button", "", "🔒 CP: refuse until sure (consistent)", btns);
const ap = el("button", "", "🟢 AP: answer anyway (available)", btns);
const next = el("button", "margin-left:auto;", "Next ▶", btns);
const fb = el("div", "margin-top:8px;min-height:3em;");

function show() {
  answered = false;
  const c = pool[idx % pool.length];
  count.textContent = `${(idx % pool.length) + 1}/${pool.length}`;
  scoreEl.textContent = `✅ ${score}/${done}`;
  q.textContent = c[0];
  fb.textContent = "";
}
function answer(g) {
  if (answered) return;
  answered = true;
  const c = pool[idx % pool.length];
  done++;
  const ok = g === c[1];
  if (ok) score++;
  fb.innerHTML = `${ok ? "✅ Yes!" : "❌ Usually not."} <b>${c[1]}</b>. ${c[2]}`;
  scoreEl.textContent = `✅ ${score}/${done}`;
}
cp.onclick = () => answer("CP");
ap.onclick = () => answer("AP");
next.onclick = () => { idx++; show(); };
show();
