// solid-detective: read a code snippet, decide which SOLID principle it breaks (S, O, L, I or D).
// input: { only?: "S"|"O"|"L"|"I"|"D" (only snippets for one principle), shuffle: true }

const opts = (typeof input === "object" && input) || {};

const CASES = [
  ["S", "class UserService:\n    def register(self, user): ...\n    def send_welcome_email(self, user): ...\n    def write_log_file(self, msg): ...\n    def export_pdf_report(self): ...",
    "One class, four reasons to change (sign-up rules, email, logging, PDFs). Split it: each job gets its own class."],
  ["O", 'def area(shape):\n    if shape.kind == "circle":\n        return 3.14 * shape.r ** 2\n    elif shape.kind == "square":\n        return shape.side ** 2\n    # new shape? edit this function again…',
    "Every new shape means editing this function. Give each shape its own area() method, so new shapes are added, not edited in."],
  ["L", "class Bird:\n    def fly(self): ...\n\nclass Ostrich(Bird):\n    def fly(self):\n        raise Exception(\"can't fly\")",
    "Ostrich can't stand in for Bird: code that calls fly() on any Bird will crash. The subclass breaks the base class's promise."],
  ["I", "class Worker(ABC):\n    def work(self): ...\n    def eat(self): ...\n\nclass Robot(Worker):\n    def work(self): ...\n    def eat(self): pass   # robots don't eat 🤖",
    "Robot is forced to implement eat(), which it doesn't need. Split into Workable and Eatable interfaces."],
  ["D", "class Checkout:\n    def __init__(self):\n        self.payments = StripeClient(api_key=\"sk_live_…\")",
    "High-level checkout logic creates a concrete, low-level payment client itself. Depend on a PaymentGateway interface and inject Stripe (or a fake in tests)."],
  ["S", "class Report:\n    def calculate_totals(self): ...\n    def to_html(self): ...\n    def save_to_disk(self, path): ...",
    "Numbers, presentation and storage are three different jobs (and three different people asking for changes). Split them."],
  ["O", 'def notify(user, channel):\n    if channel == "email": send_email(user)\n    elif channel == "sms": send_sms(user)\n    elif channel == "push": send_push(user)',
    "Adding WhatsApp means editing this working function. Use a Notifier interface with EmailNotifier, SmsNotifier… and just add a new class."],
  ["I", "class SmartDevice(ABC):\n    def turn_on(self): ...\n    def set_temperature(self, t): ...\n    def play_music(self, song): ...\n\nclass LightBulb(SmartDevice):\n    def set_temperature(self, t): raise NotImplementedError\n    def play_music(self, song): raise NotImplementedError",
    "A fat interface forces LightBulb to fake methods it can't support. Use small interfaces: Switchable, Thermostat, Speaker."],
  ["L", "class Rectangle:\n    def set_width(self, w): self.w = w\n    def set_height(self, h): self.h = h\n\nclass Square(Rectangle):\n    def set_height(self, h): self.w = self.h = h",
    "Code that sets width 5 and height 4 expects area 20, but a Square gives 16. It looks like an is-a relationship but doesn't behave like one."],
  ["D", 'class WeatherApp:\n    def __init__(self):\n        self.api = OpenWeatherHTTP("my-key")\n    # every unit test makes a real internet call 🌐',
    "The app depends directly on a concrete HTTP client. Depend on a WeatherSource abstraction and pass in the real API or a fake."],
];
const NAMES = { S: "Single Responsibility", O: "Open/Closed", L: "Liskov Substitution", I: "Interface Segregation", D: "Dependency Inversion" };

let pool = CASES.filter((c) => !opts.only || c[0] === opts.only);
if (opts.shuffle !== false) pool = pool.map((c) => [Math.random(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
let idx = 0, score = 0, done = 0, answered = false;

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
const head = el("div", "display:flex;justify-content:space-between;color:var(--text-muted);font-size:13px;");
const counter = el("span", "", "", head);
const scoreEl = el("span", "", "", head);
el("div", "margin:6px 0 2px;", "🕵️ Which principle does this code break?");
const code = el("pre", "padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;white-space:pre-wrap;overflow-x:auto;min-height:6em;");
const btns = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
const buttons = {};
for (const k of Object.keys(NAMES)) {
  buttons[k] = el("button", "font-weight:bold;", `${k}`, btns);
  buttons[k].title = NAMES[k];
  buttons[k].onclick = () => answer(k);
}
const nextBtn = el("button", "margin-left:auto;", "Next ▶", btns);
const fb = el("div", "margin-top:8px;min-height:3em;");
el("div", "margin-top:4px;font-size:12px;color:var(--text-muted);", Object.entries(NAMES).map(([k, v]) => `${k} = ${v}`).join(" · "));

function show() {
  answered = false;
  const c = pool[idx % pool.length];
  counter.textContent = `snippet ${(idx % pool.length) + 1}/${pool.length}`;
  scoreEl.textContent = `✅ ${score}/${done}`;
  code.textContent = c[1];
  fb.textContent = "";
  for (const b of Object.values(buttons)) { b.style.background = ""; b.style.color = ""; }
}
function answer(k) {
  if (answered) return;
  answered = true;
  const c = pool[idx % pool.length];
  done++;
  const ok = k === c[0];
  if (ok) score++;
  buttons[c[0]].style.background = "#2b8a3e";
  buttons[c[0]].style.color = "white";
  if (!ok) { buttons[k].style.background = "#d6336c"; buttons[k].style.color = "white"; }
  fb.innerHTML = `${ok ? "✅ Yes!" : "❌ Not quite."} It breaks <b>${c[0]} (${NAMES[c[0]]})</b>. ${c[2]}`;
  scoreEl.textContent = `✅ ${score}/${done}`;
}
nextBtn.onclick = () => { idx++; show(); };
show();
