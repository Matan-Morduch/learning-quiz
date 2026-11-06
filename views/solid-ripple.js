// solid-ripple: a change request arrives. Which files do you have to edit, and what breaks,
// in a design that ignores a SOLID principle vs one that follows it?
// input: { scenario: "srp"|"ocp"|"isp"|"dip" (default "srp"), design: "before"|"after" (default "before") }

const opts = (typeof input === "object" && input) || {};

// Each module: [name, one-line job]. `edit` = modules you must open and change. `risk` = modules that
// weren't part of the request but can break (or must be re-tested) because of the edit.
const SCENARIOS = {
  srp: {
    title: "S · Single Responsibility",
    change: "Accounting changes how overtime is paid.",
    before: {
      modules: [["Employee", "calculate_pay() · report_hours() · save()"], ["regular_hours()", "helper shared by pay AND the HR report"], ["HR report", "uses Employee.report_hours()"], ["Database", "uses Employee.save()"]],
      edit: ["Employee", "regular_hours()"], risk: ["HR report", "Database"],
      code: "class Employee:\n    def calculate_pay(self): ...   # Accounting\n    def report_hours(self): ...    # HR\n    def save(self): ...            # DBAs\n    def regular_hours(self): ...   # shared! 💣",
      story: "You tweak regular_hours() for the pay rule, and HR's hours report silently changes too. Three teams depend on one class, so every change risks the other two.",
    },
    after: {
      modules: [["PayCalculator", "calculate_pay(): Accounting's rules"], ["HourReporter", "report_hours(): HR's rules"], ["EmployeeRepository", "save(): DB code"], ["Employee", "just the data"]],
      edit: ["PayCalculator"], risk: [],
      code: "class Employee: ...            # data only\nclass PayCalculator: ...       # Accounting\nclass HourReporter: ...        # HR\nclass EmployeeRepository: ...  # DBAs",
      story: "Only PayCalculator changes. HR's code isn't even opened. One reason to change per class.",
    },
  },
  ocp: {
    title: "O · Open/Closed",
    change: "Add a new Student discount.",
    before: {
      modules: [["DiscountCalculator", "if/elif for every customer type"], ["Regular (branch)", "inside the same if/elif"], ["VIP (branch)", "inside the same if/elif"], ["Checkout", "calls DiscountCalculator"]],
      edit: ["DiscountCalculator"], risk: ["Regular (branch)", "VIP (branch)", "Checkout"],
      code: 'def discount(customer, total):\n    if customer.type == "regular": return total * 0.00\n    elif customer.type == "vip":   return total * 0.20\n    elif customer.type == "student": return total * 0.10  # ← edit old, tested code',
      story: "To add one type you edit working, tested code. A typo in the new elif can break VIP checkout, so everything has to be re-tested.",
    },
    after: {
      modules: [["Discount (interface)", "amount(total)"], ["RegularDiscount", "0%"], ["VipDiscount", "20%"], ["StudentDiscount ✨", "NEW class, 10%"], ["Checkout", "uses any Discount"]],
      edit: [], add: ["StudentDiscount ✨"], risk: [],
      code: "class Discount(Protocol):\n    def amount(self, total: float) -> float: ...\n\nclass StudentDiscount:          # ← NEW file, nothing else touched\n    def amount(self, total): return total * 0.10",
      story: "You ADD a class and edit nothing. Open for extension, closed for modification.",
    },
  },
  isp: {
    title: "I · Interface Segregation",
    change: "The fax method needs a new 'resolution' parameter.",
    before: {
      modules: [["Machine (interface)", "print() · scan() · fax()"], ["AllInOnePrinter", "really does all three"], ["SimplePrinter", "print() only, fax() raises error"], ["ScannerApp", "scan() only, fax() raises error"]],
      edit: ["Machine (interface)", "AllInOnePrinter", "SimplePrinter", "ScannerApp"], risk: [],
      code: "class Machine(ABC):\n    def print(self, doc): ...\n    def scan(self, doc): ...\n    def fax(self, doc, resolution): ...   # every class must follow",
      story: "SimplePrinter and ScannerApp never fax, but they're forced to implement fax(), so they must change too. 4 files for one fax change.",
    },
    after: {
      modules: [["Printer", "print()"], ["Scanner", "scan()"], ["Fax", "fax()"], ["AllInOnePrinter", "Printer + Scanner + Fax"], ["SimplePrinter", "Printer only"], ["ScannerApp", "Scanner only"]],
      edit: ["Fax", "AllInOnePrinter"], risk: [],
      code: "class Printer(Protocol): def print(self, doc): ...\nclass Scanner(Protocol): def scan(self, doc): ...\nclass Fax(Protocol):     def fax(self, doc, resolution): ...",
      story: "Only classes that actually fax are touched. Small, focused interfaces: nobody depends on methods they don't use.",
    },
  },
  dip: {
    title: "D · Dependency Inversion",
    change: "Switch from MySQL to PostgreSQL (and write a unit test without a real DB).",
    before: {
      modules: [["OrderService", "business rules + creates MySQLDatabase()"], ["MySQLDatabase", "low-level detail"], ["ReportService", "also creates MySQLDatabase()"], ["Tests", "need a running MySQL 😩"]],
      edit: ["OrderService", "ReportService"], add: ["PostgresDatabase"], risk: ["Tests"],
      code: "class OrderService:\n    def __init__(self):\n        self.db = MySQLDatabase()   # high-level knows the low-level detail",
      story: "The business logic imports the database directly. Changing the database means editing business code, and tests can't run without a real DB.",
    },
    after: {
      modules: [["OrderRepository (interface)", "save(order) · find(id)"], ["OrderService", "depends on the interface only"], ["MySQLRepository", "implements it"], ["PostgresRepository ✨", "NEW, implements it"], ["FakeRepository", "in-memory, for tests"], ["main.py (wiring)", "picks which one to plug in"]],
      edit: ["main.py (wiring)"], add: ["PostgresRepository ✨"], risk: [],
      code: "class OrderService:\n    def __init__(self, repo: OrderRepository):   # injected\n        self.repo = repo\n\n# main.py\nservice = OrderService(PostgresRepository())  # ← the only line that changes",
      story: "Business code never changes. Plug a different implementation into the same interface, like a USB device into a laptop. Tests use FakeRepository.",
    },
  },
};

let scenario = SCENARIOS[opts.scenario] ? opts.scenario : "srp";
let design = opts.design === "after" ? "after" : "before";
let applied = false;

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
const top = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
const sel = el("select", "", null, top);
for (const [k, s] of Object.entries(SCENARIOS)) {
  const o = el("option", "", s.title, sel);
  o.value = k;
}
sel.value = scenario;
const beforeBtn = el("button", "", "❌ Without the principle", top);
const afterBtn = el("button", "", "✅ With the principle", top);
const request = el("div", "margin:10px 0 6px;padding:8px;border-left:4px solid #e8590c;background:var(--background-secondary);border-radius:4px;");
const applyBtn = el("button", "margin-bottom:8px;", "📨 Apply the change request");
const boxes = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
const stats = el("div", "margin-top:8px;font-weight:bold;min-height:1.4em;");
const story = el("div", "margin-top:4px;color:var(--text-muted);min-height:2.8em;");
const code = el("pre", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;white-space:pre-wrap;overflow-x:auto;");

function render() {
  const S = SCENARIOS[scenario];
  const D = S[design];
  beforeBtn.style.fontWeight = design === "before" ? "bold" : "normal";
  afterBtn.style.fontWeight = design === "after" ? "bold" : "normal";
  beforeBtn.style.outline = design === "before" ? "2px solid #d6336c" : "none";
  afterBtn.style.outline = design === "after" ? "2px solid #2b8a3e" : "none";
  request.innerHTML = `<b>Change request:</b> ${S.change}`;
  boxes.innerHTML = "";
  const all = [...D.modules];
  for (const name of D.add || []) if (!all.find((m) => m[0] === name)) all.push([name, "NEW"]);
  for (const [name, job] of all) {
    const isEdit = applied && D.edit.includes(name);
    const isAdd = applied && (D.add || []).includes(name);
    const isRisk = applied && D.risk.includes(name);
    const hidden = !applied && (D.add || []).includes(name); // new files only exist after the change
    if (hidden) continue;
    const border = isEdit ? "#e8590c" : isAdd ? "#2b8a3e" : isRisk ? "#d6336c" : "var(--background-modifier-border)";
    const tag = isEdit ? "✏️ edited" : isAdd ? "➕ added" : isRisk ? "💥 at risk" : "untouched";
    const b = el("div", `flex:1 1 150px;border:2px solid ${border};border-radius:8px;padding:6px 8px;transition:border-color .3s;`, null, boxes);
    el("div", "font-weight:bold;font-family:var(--font-monospace);font-size:13px;", name, b);
    el("div", "font-size:12px;color:var(--text-muted);", job, b);
    el("div", `font-size:11px;margin-top:3px;color:${border === "var(--background-modifier-border)" ? "var(--text-faint)" : border};font-weight:bold;`, tag, b);
  }
  if (applied) {
    const e = D.edit.length, a = (D.add || []).length, r = D.risk.length;
    stats.innerHTML = `✏️ existing files edited: <span style="color:#e8590c">${e}</span> · ➕ new files: <span style="color:#2b8a3e">${a}</span> · 💥 other code at risk: <span style="color:#d6336c">${r}</span>`;
    story.textContent = D.story;
    applyBtn.textContent = "↺ Undo";
  } else {
    stats.textContent = "";
    story.textContent = "Predict first: which boxes will you have to touch? Then apply the change.";
    applyBtn.textContent = "📨 Apply the change request";
  }
  code.textContent = D.code;
}

sel.onchange = () => { scenario = sel.value; applied = false; render(); };
beforeBtn.onclick = () => { design = "before"; applied = false; render(); };
afterBtn.onclick = () => { design = "after"; applied = false; render(); };
applyBtn.onclick = () => { applied = !applied; render(); };
render();
