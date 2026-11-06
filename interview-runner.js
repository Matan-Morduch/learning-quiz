// Runs a candidate's Python solution against a problem's hidden tests (Interview tab, "I'm done").
//
//   const r = await require('./interview-runner').run(code, job)
//     job = { method, compare, inplace, check, timeLimitMs, tests } or { mode: 'gen' } (see interview/harness.py)
//   → { ok: all passed, passed, total, compileError?, line?, cases? (gen), results: [{i, ok, got, error, line, ms, timeout}],
//       crashed?: 'memory' | 'killed' | <stderr>, ms }
//
// Each run: a fresh temp folder with solution.py, `python3 -I interview/harness.py` with the job on
// stdin, under prlimit (CPU seconds, address space), a clean environment, and a wall-clock timeout
// that kills the whole process group. The per-test time limit is enforced inside the harness, so one
// infinite loop fails one test, not the run. It's his own code on his own server: the limits stop
// mistakes (endless loops, runaway memory), not an attacker. No network isolation yet (see the plan).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PYTHON = process.env.QUIZ_PYTHON_BIN || 'python3';
const HARNESS = path.join(__dirname, 'interview', 'harness.py');
const MEM_BYTES = 768 * 1024 * 1024;
const MAX_WALL_MS = 60000;

function run(code, job) {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-run-'));
  fs.writeFileSync(path.join(dir, 'solution.py'), code);
  const perTest = job.timeLimitMs || 2000;
  const wallMs = Math.min(job.wallMs || MAX_WALL_MS, 3000 + (job.tests || []).length * perTest + (job.mode === 'gen' ? 20000 : 0));
  const cpuSec = Math.ceil(wallMs / 1000);
  const args = [`--cpu=${cpuSec}`, `--as=${MEM_BYTES}`, '--', PYTHON, '-I', HARNESS];
  return new Promise((resolve) => {
    const proc = spawn('prlimit', args, {
      cwd: dir, detached: true, stdio: ['pipe', 'ignore', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: dir, LANG: 'C.UTF-8', PYTHONHASHSEED: '0' },
    });
    let stderr = '', killed = false;
    proc.stderr.on('data', (d) => { if (stderr.length < 8000) stderr += d; });
    const timer = setTimeout(() => { killed = true; try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }, wallMs);
    proc.stdin.on('error', () => {});
    proc.stdin.end(JSON.stringify(job));
    proc.on('close', (codeExit, signal) => {
      clearTimeout(timer);
      const tests = job.tests || [];
      const out = { ok: false, passed: 0, total: tests.length, results: [], ms: Date.now() - started };
      let lines = [];
      try { lines = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean); } catch {}
      for (const l of lines) {
        let o; try { o = JSON.parse(l); } catch { continue; }
        if (o.compileError) { out.compileError = o.compileError; out.line = o.line; }
        else if (o.cases) out.cases = o.cases;   // mode 'gen'
        else if (typeof o.i === 'number') out.results.push(o);
      }
      out.passed = out.results.filter((x) => x.ok).length;
      const finished = lines.some((l) => l.includes('"done"'));
      if (!finished && !out.compileError) {
        out.crashed = killed ? 'killed' : /MemoryError|Cannot allocate/i.test(stderr) ? 'memory'
          : signal ? `signal ${signal}` : (stderr.trim().split('\n').pop() || `exit ${codeExit}`);
        // Tests the crash never reached count as failed.
        for (let i = out.results.length; i < tests.length; i++) out.results.push({ i, ok: false, error: 'Not run (the program stopped)', notRun: true });
      }
      out.ok = !out.compileError && !out.crashed && out.passed === out.total;
      fs.rm(dir, { recursive: true, force: true }, () => {});
      resolve(out);
    });
  });
}

module.exports = { run };
