// responsibility-stack: who manages what in each hosting model.
// Five layers (code, scaling, runtime, OS + patches, servers/network/power). Pick a model and the
// layers the cloud takes over slide from the "You" column to the "Cloud" column.
// input: { model: "onprem"|"iaas"|"paas"|"faas" (default "faas") }

const opts = (typeof input === "object" && input) || {};
const LAYERS = [
  { name: "🧑‍💻 Your code", chore: "write and deploy it" },
  { name: "📈 Scaling", chore: "add/remove servers as traffic changes" },
  { name: "🐍 Runtime (Python, Node…)", chore: "install and upgrade it" },
  { name: "🛡️ OS + security patches", chore: "patch it, reboot it" },
  { name: "🔌 Servers, network, power", chore: "buy, rack, cool, replace" },
];
// youCount = how many layers from the top you still manage (layers are handed over bottom-up)
const MODELS = {
  onprem: { label: "🏢 On-premises", you: 5, analogy: "🚗 own a car", eg: "your own machines" },
  iaas: { label: "🖥️ VMs (IaaS)", you: 4, analogy: "🚙 rent a car", eg: "AWS EC2" },
  paas: { label: "📦 Containers / PaaS", you: 2, analogy: "somewhere in between", eg: "Heroku, Google Cloud Run" },
  faas: { label: "⚡ Serverless (FaaS)", you: 1, analogy: "🚕 take a taxi", eg: "AWS Lambda" },
};
const ORDER = ["onprem", "iaas", "paas", "faas"];
let model = MODELS[opts.model] ? opts.model : "faas";
let busy = false;

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

const controls = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;");
const btns = {};
ORDER.forEach((k) => {
  const b = el("button", "", MODELS[k].label, controls);
  b.onclick = () => { if (!busy) { model = k; render(); } };
  btns[k] = b;
});
const tourBtn = el("button", "", "▶ Walk left → right", controls);

const heads = el("div", "display:flex;justify-content:space-between;font-weight:bold;font-size:13px;margin-bottom:4px;");
el("div", "width:48%;text-align:center;color:#e8590c;", "👤 YOU manage", heads);
el("div", "width:48%;text-align:center;color:#3b82f6;", "☁️ CLOUD manages", heads);

const ROW = 40;
const stage = el("div", `position:relative;height:${LAYERS.length * ROW}px;border-radius:6px;background:var(--background-secondary);`);
el("div", "position:absolute;left:50%;top:4px;bottom:4px;border-left:2px dashed var(--background-modifier-border);", null, stage);
const boxes = LAYERS.map((L, i) => {
  const b = el("div", `position:absolute;top:${i * ROW + 4}px;height:${ROW - 8}px;width:47%;box-sizing:border-box;border-radius:6px;padding:0 8px;display:flex;align-items:center;font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;transition:left 0.6s ease, background 0.6s ease;`, L.name, stage);
  return b;
});
const narrate = el("div", "margin-top:10px;padding:8px;border-radius:6px;background:var(--background-secondary);line-height:1.5;");

function render() {
  const m = MODELS[model];
  ORDER.forEach((k) => {
    btns[k].style.fontWeight = k === model ? "bold" : "normal";
    btns[k].style.outline = k === model ? "2px solid var(--interactive-accent)" : "none";
  });
  LAYERS.forEach((L, i) => {
    const mine = i < m.you;
    boxes[i].style.left = mine ? "1.5%" : "51.5%";
    boxes[i].style.background = mine ? "rgba(232,89,12,0.85)" : "rgba(59,130,246,0.25)";
    boxes[i].style.color = mine ? "white" : "var(--text-normal)";
  });
  const handed = LAYERS.slice(m.you).map((L) => L.name.replace(/^\S+\s/, ""));
  const chores = LAYERS.slice(0, m.you).map((L) => L.chore);
  narrate.innerHTML =
    `<b>${m.label}</b> (${m.eg}) = <b>${m.analogy}</b><br>` +
    `You manage <b>${m.you} of ${LAYERS.length}</b> layers: ${chores.join("; ")}.<br>` +
    (handed.length ? `<span style="color:#3b82f6">Cloud handles: ${handed.join(", ")}.</span>` : `<span style="color:var(--text-muted)">Cloud handles: nothing, it's all yours.</span>`);
}

tourBtn.onclick = () => {
  if (busy) return;
  busy = true;
  tourBtn.disabled = true;
  let k = 0;
  const step = () => {
    if (!root.isConnected) return;
    if (k >= ORDER.length) { busy = false; tourBtn.disabled = false; return; }
    model = ORDER[k++];
    render();
    setTimeout(step, 1600);
  };
  step();
};

render();
