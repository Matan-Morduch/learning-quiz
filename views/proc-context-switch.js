// proc-context-switch: what a context switch saves and restores.
// The CPU's registers (PC, SP, FP, a general register) belong to the running process. A switch copies them into
// the old process's PCB, flips the states, and loads the new process's saved registers. Step-by-step animation.
// input: { from?: "A"|"B" (default "A", the process running at the start) }

const opts = (typeof input === "object" && input) || {};

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

const REGS = ["PC", "SP", "FP", "R1"];
const START = {
  A: { PC: "0x400744", SP: "0x7ff0a0", FP: "0x7ff0c0", R1: "17" },
  B: { PC: "0x401b20", SP: "0x7fe3d8", FP: "0x7fe400", R1: "250" },
};
let running, pcb, cpu, hl, busy;

const bar = el("div", "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;");
const swBtn = el("button", "", "🔀 Context switch", bar);
const runBtn = el("button", "", "⚙️ Run a bit", bar);
const resetBtn = el("button", "", "↺ Reset", bar);
const board = el("div", "display:flex;gap:10px;flex-wrap:wrap;");
const narr = el("div", "margin-top:8px;padding:8px;border-radius:6px;background:var(--background-secondary);font-family:var(--font-monospace);font-size:12px;min-height:2.6em;");

function reset() {
  running = opts.from === "B" ? "B" : "A";
  const other = running === "A" ? "B" : "A";
  pcb = { A: { state: "", regs: { ...START.A } }, B: { state: "", regs: { ...START.B } } };
  pcb[running].state = "Running"; pcb[other].state = "Ready";
  cpu = { ...START[running] };
  pcb[running].regs = { PC: "—", SP: "—", FP: "—", R1: "—" }; // live values are in the CPU, not saved yet
  hl = {}; busy = false;
  narr.textContent = `${running} is Running: its registers are in the CPU right now. ${other}'s registers are saved in its PCB.`;
  draw();
}

function regTable(title, regs, color, hlKey, sub) {
  let h = `<div style="flex:1 1 160px;border:2px solid ${color};border-radius:8px;padding:6px;">
    <div style="font-weight:bold;color:${color};">${title}</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">${sub}</div>`;
  REGS.forEach((r) => {
    const on = hl[hlKey + r];
    h += `<div style="display:flex;justify-content:space-between;font-family:var(--font-monospace);font-size:12px;padding:1px 4px;border-radius:4px;background:${on ? "#d6336c" : "transparent"};color:${on ? "white" : "var(--text-normal)"};transition:background .2s;"><span>${r}</span><span>${regs[r]}</span></div>`;
  });
  return h + "</div>";
}
function draw() {
  const col = (p) => (pcb[p].state === "Running" ? "#3b82f6" : "gray");
  board.innerHTML =
    regTable("🖥️ CPU registers", cpu, "#2b8a3e", "cpu", `belong to ${running}`) +
    regTable("📋 PCB of A", pcb.A.regs, col("A"), "A", `state: <b>${pcb.A.state}</b>`) +
    regTable("📋 PCB of B", pcb.B.regs, col("B"), "B", `state: <b>${pcb.B.state}</b>`);
}

runBtn.onclick = () => {
  if (busy) return;
  const pc = parseInt(cpu.PC, 16) + 8;
  cpu.PC = "0x" + pc.toString(16);
  cpu.R1 = String(+cpu.R1 + 1);
  narr.textContent = `${running} runs 2 instructions: PC moved to ${cpu.PC}, R1 = ${cpu.R1}. Only the CPU copy changes.`;
  draw();
};

swBtn.onclick = async () => {
  if (busy) return;
  busy = true;
  const old = running, nxt = running === "A" ? "B" : "A";
  const say = (t) => { narr.textContent = t; draw(); };
  say(`1. ⏰ Timer interrupt: the OS takes over from ${old}.`);
  await sleep(700); if (!root.isConnected) return;
  for (const r of REGS) {
    hl = { ["cpu" + r]: 1, [old + r]: 1 };
    pcb[old].regs[r] = cpu[r];
    say(`2. Save ${old}'s ${r} = ${cpu[r]} into PCB ${old}.`);
    await sleep(450); if (!root.isConnected) return;
  }
  hl = {};
  pcb[old].state = "Ready";
  say(`3. ${old}: Running → Ready (descheduled).`);
  await sleep(700); if (!root.isConnected) return;
  running = nxt;
  for (const r of REGS) {
    hl = { ["cpu" + r]: 1, [nxt + r]: 1 };
    cpu[r] = pcb[nxt].regs[r];
    pcb[nxt].regs[r] = "—";
    say(`4. Load ${nxt}'s saved ${r} = ${cpu[r]} into the CPU.`);
    await sleep(450); if (!root.isConnected) return;
  }
  hl = {};
  pcb[nxt].state = "Running";
  say(`5. ${nxt}: Ready → Running. It continues at PC = ${cpu.PC}, exactly where it stopped. Memory didn't move: only registers were swapped.`);
  busy = false;
};
resetBtn.onclick = () => { if (!busy) reset(); };
reset();
