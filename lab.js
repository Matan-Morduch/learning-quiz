// 🧪 Lab: a live terminal inside Teach mode, either on this machine (local, the default on Linux: the
// home server is a Linux box itself) or on a lab VM over ssh (the default on a Mac).
//
// Local: a bash on this machine, started through util-linux `script`, which gives it a real pty (so
// sudo prompts, Ctrl-C and vim work) without any npm dependency. It starts in the lesson's folder under
// the lessons folder you choose in Teach → Labs (default ~/lessons).
// SSH: `ssh -tt <host>` with the learner's own ssh setup (~/.ssh/config, keys).
// Either way the browser draws it with xterm.js; output streams over Server-Sent Events, keystrokes
// come back as small POSTs.
//
// The shell is started with a tiny rc file that marks each command with OSC escape codes (the same
// trick VS Code's shell integration uses): PS0 prints "command starts", PROMPT_COMMAND prints
// "command ended" with the exit code, the command line (from history) and the working directory.
// So the server can cut the stream into { command, output, exit code } entries, which the teacher
// reads. Keystrokes are never logged (a sudo password never reaches the log or the teacher).
//
// Labs themselves are markdown files in the vault: Learning/<Subject>/Labs/<Name>.md (see README).
//
// Safety: this is a real shell, so every /api/lab request must come from the app's own page:
//  - the Host header must be localhost or the app's own public name (QUIZ_PUBLIC_URL, e.g. the
//    Tailscale name; QUIZ_LAB_HOSTS adds more), which blocks DNS rebinding;
//  - an Origin, when the browser sends one, must be that same host (no cross-site requests);
//  - POSTs need an "X-Quiz-Lab: 1" header (a plain cross-site form or fetch can't send it without a
//    CORS preflight, which this server never approves).
// The page itself is only reachable on the tailnet (tailscale serve), never the open internet.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');

const { LEARNING_DIR } = require('./config');   // QUIZ_LEARNING_DIR, else the folder above _quiz
const DATA_DIR = path.join(__dirname, 'data');
const LOG_DIR = path.join(DATA_DIR, 'lab');
const CONFIG_FILE = path.join(DATA_DIR, 'lab.json');

const BUF_LIMIT = 400 * 1024;        // chars of raw terminal output kept per terminal (replayed on reload)
const MAX_TERMS = 3;                 // live terminals at once
const IDLE_MS = 45 * 60 * 1000;      // close a terminal nobody watched or typed into for 45 minutes
const OUTPUT_KEEP = 40000;           // chars of one command's cleaned output kept in the log
const STATUS_TTL = 15 * 1000;

const HOST_RE = /^[A-Za-z0-9_][\w.@-]{0,99}$/;   // an ssh host alias / user@host, never an option ("-o…")
// The lessons folder: "~/…" or an absolute path, plain characters only (it goes into shell commands in
// single quotes), no "..", no hidden folders (keeps it away from ~/.ssh, ~/.config and the like).
const ROOT_RE = /^(?:~|\/)[\w./ -]{0,200}$/;
const DEFAULT_ROOT = '~/lessons';

// ---------- config ----------

function validRoot(r) {
  r = String(r || '').trim().replace(/\/+$/, '');
  if (!ROOT_RE.test(r) || r === '~' || r === '/') return null;
  const parts = r.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p.startsWith('.'))) return null;
  if (r.startsWith('/') && parts.length < 2) return null;   // not a top-level system folder like /etc
  return r;
}

// { mode: 'local' | 'ssh', host, root }. Local is the default on Linux (the home server), ssh on a Mac.
function config() {
  const c = store.readJson(CONFIG_FILE, {}) || {};
  const host = HOST_RE.test(c.host || '') ? c.host : (HOST_RE.test(process.env.QUIZ_LAB_HOST || '') ? process.env.QUIZ_LAB_HOST : 'rocky');
  const envMode = ['local', 'ssh'].includes(process.env.QUIZ_LAB_MODE) ? process.env.QUIZ_LAB_MODE : null;
  const mode = ['local', 'ssh'].includes(c.mode) ? c.mode : envMode || (process.platform === 'linux' ? 'local' : 'ssh');
  const root = validRoot(c.root) || DEFAULT_ROOT;
  return { mode, host, root };
}
function setConfig(body) {
  const cur = config();
  const next = { ...cur };
  if (body.mode !== undefined) {
    if (!['local', 'ssh'].includes(body.mode)) throw Object.assign(new Error('Mode must be local or ssh'), { status: 400 });
    next.mode = body.mode;
  }
  if (body.host !== undefined) {
    if (!HOST_RE.test(String(body.host || ''))) throw Object.assign(new Error('Host must be an ssh host name or alias (letters, digits, . _ - @)'), { status: 400 });
    next.host = body.host;
    if (body.mode === undefined) next.mode = 'ssh';   // older pages only send a host
  }
  if (body.root !== undefined) {
    const r = validRoot(body.root);
    if (!r) throw Object.assign(new Error('The lessons folder must start with ~/ or /, use plain characters, and not be a hidden or top-level folder.'), { status: 400 });
    next.root = r;
  }
  store.writeJson(CONFIG_FILE, next);
  statusCache = null;
  return config();
}

// A lesson's folder id ("lessons/<slug>", stored in the lesson) → its place under the lessons folder,
// as a shell word ('~/x' is written ~/'x' so the shell still expands the ~).
const DIR_RE = /^lessons\/[a-z0-9][a-z0-9-]{0,40}$/;
function lessonPath(dir, root = config().root) {
  if (!DIR_RE.test(dir || '')) return null;
  const full = `${root}/${dir.slice('lessons/'.length)}`;
  return { display: full, shell: full.startsWith('~/') ? `~/'${full.slice(2)}'` : `'${full}'` };
}

// ---------- running commands (local or ssh) ----------

const BASE = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
// Short helper commands (status, resize, step checks) share one multiplexed connection.
const MUX = ['-o', 'ControlMaster=auto', '-o', 'ControlPath=/tmp/quizlab-%C', '-o', 'ControlPersist=600'];

// The local shell gets a plain login-like environment, not the server's (which carries QUIZ_* settings,
// library paths and maybe keys). Its ~/.bashrc then sets up the rest as in any terminal.
function shellEnv() {
  const e = process.env;
  const env = { HOME: os.homedir(), USER: e.USER || os.userInfo().username, LOGNAME: e.LOGNAME || os.userInfo().username,
    SHELL: '/bin/bash', PATH: e.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: e.LANG || 'C.UTF-8', TERM: 'xterm-256color' };
  if (e.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = e.XDG_RUNTIME_DIR;
  return env;
}

function exec(cmd, { timeout = 15000, cfg = config() } = {}) {
  return new Promise((resolve) => {
    const done = (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : (err.killed ? 124 : 255)) : 0;
      resolve({ code, stdout: stdout || '', stderr: stderr || '', timedOut: !!(err && err.killed) });
    };
    const opts = { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' };
    if (cfg.mode === 'local') execFile('bash', ['-c', cmd], { ...opts, cwd: os.homedir(), env: shellEnv() }, done);
    else execFile('ssh', [...BASE, ...MUX, cfg.host, cmd], opts, done);
  });
}

let statusCache = null, statusInflight = null;
const sudoKnown = new Map();   // "mode:host" → '1' | '0'
// Is the machine reachable (ssh: without a password)? Plus what the teacher should know about it.
async function status(force) {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL) return statusCache.value;
  if (statusInflight) return statusInflight;
  const cfg = config();
  const base = { mode: cfg.mode, host: cfg.mode === 'local' ? 'local' : cfg.host, root: cfg.root };
  // Whether sudo needs a password is asked once per machine and server start: every `sudo -n` that
  // fails writes "a password is required" to the system log, and status is checked often.
  const sudoKey = `${cfg.mode}:${cfg.host}`;
  const sudoCheck = sudoKnown.has(sudoKey) ? `echo S=${sudoKnown.get(sudoKey)}` : 'if sudo -n true 2>/dev/null; then echo S=1; else echo S=0; fi';
  statusInflight = exec('echo "H=$(hostname)"; echo "U=$(whoami)"; . /etc/os-release 2>/dev/null; echo "O=$PRETTY_NAME"; ' + sudoCheck, { timeout: 9000, cfg })
    .then((r) => {
      const kv = Object.fromEntries(r.stdout.split('\n').map((l) => l.match(/^(\w)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
      if (r.code === 0 && kv.S) sudoKnown.set(sudoKey, kv.S);
      const value = r.code === 0 && kv.H
        ? { ok: true, ...base, hostname: kv.H, user: kv.U || '', os: kv.O || '', sudo: kv.S === '1' }
        : { ok: false, ...base, error: cfg.mode === 'local' ? `The local shell didn't start (exit ${r.code}). ${(r.stderr || '').trim().split('\n').pop() || ''}` : friendlySshError(r) };
      statusCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => { statusInflight = null; });
  return statusInflight;
}

function friendlySshError(r) {
  const e = (r.stderr || '').trim();
  if (r.timedOut || /timed out/i.test(e)) return 'The VM did not answer. Is it running?';
  if (/Could not resolve hostname/i.test(e)) return `ssh doesn't know the host "${config().host}". Check ~/.ssh/config.`;
  if (/Permission denied/i.test(e)) return 'ssh needs a password for this host. Set up key login (ssh-copy-id) so the app can connect.';
  if (/Connection refused/i.test(e)) return 'The VM is up but sshd refused the connection.';
  if (/Host key verification failed/i.test(e)) return 'The VM\'s host key changed or is unknown. Connect once with ssh in a terminal to accept it.';
  return e.split('\n').pop() || `ssh exited with code ${r.code}`;
}

// ---------- the shell's command markers ----------

// Runs in the VM. Sources the learner's own ~/.bashrc first, so the prompt and aliases are his.
const RC = String.raw`[ -f ~/.bashrc ] && . ~/.bashrc
HISTCONTROL=; HISTIGNORE=
__quizlab_prompt() {
  local ec=$? c
  c=$(HISTTIMEFORMAT= builtin history 1 | sed -E 's/^ *[0-9]+\*? *//')
  printf '\e]633;D;%s;%s;%s\a' "$ec" "$(printf %s "$c" | base64 -w0)" "$(printf %s "$PWD" | base64 -w0)"
}
PS0=$'\e]633;C\a'
PROMPT_COMMAND=__quizlab_prompt
printf '\e]633;T;%s;%s\a' "$(tty)" "$$"
`;
const RC_B64 = Buffer.from(RC).toString('base64');
const MARK = '\x1b]633;';

const b64d = (s) => { try { return Buffer.from(String(s || ''), 'base64').toString('utf8'); } catch { return ''; } };

// Terminal bytes → readable text: drop escape codes, apply backspaces and carriage-return overwrites.
function cleanTerm(s) {
  s = String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')            // OSC
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')                       // CSI (colours, cursor moves)
    .replace(/\x1b[()][0-9A-Za-z]/g, '')                           // charset
    .replace(/\x1b[@-Z\\-_]/g, '');                                 // other 2-byte escapes
  while (/[^\x08\n]\x08/.test(s)) s = s.replace(/[^\x08\n]\x08/g, '');
  s = s.replace(/\x08/g, '');
  return s.split('\n').map((line) => {
    line = line.replace(/\r+$/, '');
    const i = line.lastIndexOf('\r');
    return (i >= 0 ? line.slice(i + 1) : line).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  }).join('\n').replace(/\n+$/, '');
}

// Keep the head and the tail of a long text, with a note about what was cut.
function clipMiddle(s, max) {
  if (s.length <= max) return { text: s, cut: 0 };
  const head = s.slice(0, Math.floor(max * 0.65));
  const tail = s.slice(s.length - Math.floor(max * 0.35));
  const cutLines = s.slice(head.length, s.length - tail.length).split('\n').length;
  return { text: `${head}\n[… ${cutLines} lines cut …]\n${tail}`, cut: cutLines };
}

// ---------- the command log (data/lab/<owner>.jsonl) ----------

const logs = new Map();   // owner → [entries]
const logFile = (owner) => path.join(LOG_DIR, `${owner}.jsonl`);
function commands(owner) {
  if (!logs.has(owner)) {
    let list = [];
    try {
      list = fs.readFileSync(logFile(owner), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {}
    logs.set(owner, list);
  }
  return logs.get(owner);
}
function addCommand(owner, entry) {
  const list = commands(owner);
  entry.id = (list.length ? list[list.length - 1].id : 0) + 1;
  list.push(entry);
  if (list.length > 1000) list.splice(0, list.length - 1000);
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(logFile(owner), JSON.stringify(entry) + '\n'); }
  catch (e) { console.error('[lab] log write failed:', e.message); }
  return entry;
}
const lastId = (owner) => { const l = commands(owner); return l.length ? l[l.length - 1].id : 0; };
const commandsAfter = (owner, id) => commands(owner).filter((c) => c.id > (id || 0));
const summary = (c) => ({ id: c.id, ts: c.ts, cmd: c.cmd, exit: c.exit, cwd: c.cwd, ms: c.ms, lines: c.lines, cut: c.cut || 0,
  preview: c.output.split('\n').slice(0, 3).join('\n').slice(0, 300) });

// ---------- one live terminal ----------

class Term {
  constructor(owner, cfg, { cols = 100, rows = 30, dir = null } = {}) {
    this.owner = owner; this.cfg = cfg;
    this.buf = ''; this.total = 0;               // raw output; buf holds [total - buf.length, total)
    this.listeners = new Set();
    this.alive = true; this.exitInfo = null;
    this.tty = null; this.pid = null; this.cwd = null;
    this.tail = ''; this.cur = null;
    this.lastActive = Date.now();
    this.size = { cols: clampInt(cols, 20, 400, 100), rows: clampInt(rows, 5, 200, 30) };
    // A lesson's terminal starts in its lesson folder (made if missing). lessonPath only accepts DIR_RE ids.
    const lp = lessonPath(dir, cfg.root);
    const cd = lp ? `mkdir -p ${lp.shell} && cd ${lp.shell}; ` : 'cd ~; ';
    const start = `stty rows ${this.size.rows} cols ${this.size.cols} 2>/dev/null; ${cd}mkdir -p ~/.cache && ` +
      `printf %s ${RC_B64} | base64 -d > ~/.cache/quizlab.bashrc && exec bash --rcfile ~/.cache/quizlab.bashrc -i`;
    // Local: `script` runs the shell on a fresh pty (-q quiet, -f flush at once, -e pass on the exit code).
    // Its own process group, so closing the terminal also ends whatever runs in it.
    this.proc = cfg.mode === 'local'
      ? spawn('script', ['-qfec', start, '/dev/null'], { cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'], env: shellEnv(), detached: true })
      : spawn('ssh', ['-tt', ...BASE, '-o', 'ControlPath=none', cfg.host, start], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TERM: 'xterm-256color' } });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdin.on('error', () => {});
    this.proc.stdout.on('data', (d) => this.onOut(d));
    this.proc.stderr.on('data', (d) => this.onOut(d.replace(/\r?\n/g, '\r\n')));
    this.proc.on('error', (e) => this.onExit(null, e.message));
    this.proc.on('exit', (code, sig) => this.onExit(code, sig));
  }

  emit(ev) { for (const fn of this.listeners) { try { fn(ev); } catch {} } }

  onOut(d) {
    const o = this.total;
    this.buf += d; this.total += d.length;
    if (this.buf.length > BUF_LIMIT) this.buf = this.buf.slice(this.buf.length - BUF_LIMIT);
    this.emit({ type: 'data', o, d });
    this.parse(d);
  }

  onExit(code, why) {
    if (this.exitInfo) return;
    this.alive = false;
    this.exitInfo = { code, why: why || null, at: new Date().toISOString() };
    const what = this.cfg.mode === 'local' ? 'shell' : 'ssh';
    this.onOut(`\r\n\x1b[2m[${this.closing ? 'closed' : 'disconnected'}${code ? ` (${what} exit ${code})` : ''}]\x1b[0m\r\n`);
    this.emit({ type: 'exit', ...this.exitInfo });
  }

  // Cut the stream at the OSC 633 markers; text between "C" and "D" is one command's output.
  parse(d) {
    let s = this.tail + d, i = 0;
    this.tail = '';
    for (;;) {
      const j = s.indexOf(MARK, i);
      if (j < 0) {
        let keep = 0;   // the end may be the start of a marker split across chunks
        for (let n = Math.min(MARK.length - 1, s.length - i); n > 0; n--) if (s.endsWith(MARK.slice(0, n))) { keep = n; break; }
        this.capture(s.slice(i, s.length - keep));
        this.tail = s.slice(s.length - keep);
        return;
      }
      this.capture(s.slice(i, j));
      const k = s.indexOf('\x07', j);
      if (k < 0) { this.tail = s.length - j < 4096 ? s.slice(j) : ''; return; }
      this.marker(s.slice(j + MARK.length, k));
      i = k + 1;
    }
  }

  capture(x) {
    const c = this.cur;
    if (!c || !x) return;
    if (c.head.length < 200000) { c.head += x; return; }
    c.dropped += x.length;
    c.rest = (c.rest + x).slice(-100000);
  }

  marker(body) {
    const p = body.split(';');
    if (p[0] === 'T') {
      if (/^\/dev\/pts\/\d+$/.test(p[1] || '')) this.tty = p[1];
      if (/^\d+$/.test(p[2] || '')) this.pid = Number(p[2]);
      this.resize(this.size.cols, this.size.rows, true);
    } else if (p[0] === 'C') {
      this.cur = { start: Date.now(), head: '', rest: '', dropped: 0 };
    } else if (p[0] === 'D') {
      this.cwd = b64d(p[3]) || this.cwd;
      const c = this.cur;
      this.cur = null;
      if (!c) return;   // a prompt with no command before it (start-up, an empty Enter)
      const raw = c.dropped ? `${c.head}\n[… ${c.dropped} characters of output not kept …]\n${c.rest}` : c.head;
      const clean = cleanTerm(raw);
      const { text, cut } = clipMiddle(clean, OUTPUT_KEEP);
      const entry = addCommand(this.owner, {
        ts: new Date(c.start).toISOString(), cmd: b64d(p[2]).trim(), exit: Number(p[1]), cwd: this.cwd,
        ms: Date.now() - c.start, lines: clean ? clean.split('\n').length : 0, output: text, cut,
      });
      this.emit({ type: 'cmd', cmd: summary(entry) });
    }
  }

  input(data) {
    if (!this.alive) throw Object.assign(new Error('The terminal is disconnected. Reconnect first.'), { status: 409 });
    this.lastActive = Date.now();
    this.proc.stdin.write(data);
  }

  // The remote pty can't see our window size (ssh has no local tty here), so set it with stty on the
  // pty itself; the kernel then sends SIGWINCH to whatever runs in the foreground.
  resize(cols, rows, now) {
    this.size = { cols: clampInt(cols, 20, 400, this.size.cols), rows: clampInt(rows, 5, 200, this.size.rows) };
    if (!this.tty || !this.alive) return;
    clearTimeout(this.rt);
    this.rt = setTimeout(() => exec(`stty -F ${this.tty} rows ${this.size.rows} cols ${this.size.cols}`, { cfg: this.cfg }), now ? 0 : 150);
  }

  kill() {
    try { this.cfg.mode === 'local' ? process.kill(-this.proc.pid, 'SIGHUP') : this.proc.kill(); } catch {}
  }

  // Input stops at once; onExit (when the process ends) marks it closed and tells the browser.
  close() {
    if (!this.alive || this.closing) return;
    this.closing = true;
    this.alive = false;
    try { this.proc.stdin.end(); } catch {}
    setTimeout(() => this.kill(), 1500).unref();
  }
}

function clampInt(v, lo, hi, dflt) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }

const terms = new Map();   // owner → Term
setInterval(() => {
  for (const [id, t] of terms) {
    if (!t.alive && !t.listeners.size) terms.delete(id);
    else if (t.alive && !t.listeners.size && Date.now() - t.lastActive > IDLE_MS) { t.close(); terms.delete(id); }
  }
}, 60 * 1000).unref();
const killAll = () => { for (const t of terms.values()) t.kill(); terms.clear(); };
process.on('exit', killAll);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.once(sig, () => { killAll(); if (!process.listenerCount(sig)) process.kill(process.pid, sig); });
}

function openTerm(owner, size) {
  let t = terms.get(owner);
  // Reattaching (a reload, another window): the shell keeps its old size, so take this window's,
  // or readline wraps at the wrong column and typing overwrites the line.
  if (t && t.alive) { if (size && size.cols && size.rows) t.resize(size.cols, size.rows, true); return t; }
  const live = [...terms.entries()].filter(([, x]) => x.alive);
  if (live.length >= MAX_TERMS) {
    const idle = live.filter(([, x]) => !x.listeners.size).sort((a, b) => a[1].lastActive - b[1].lastActive);
    if (!idle.length) throw Object.assign(new Error(`${MAX_TERMS} lab terminals are already open`), { status: 409 });
    idle[0][1].close(); terms.delete(idle[0][0]);
  }
  t = new Term(owner, config(), size);
  // Keep the old output (a reconnect continues the same scrollback).
  const old = terms.get(owner);
  if (old) { t.buf = old.buf; t.total = old.total; }
  terms.set(owner, t);
  return t;
}

// ---------- lab files: Learning/<Subject>/Labs/<Name>.md ----------

function subjectDirs() {
  return (fs.existsSync(LEARNING_DIR) ? fs.readdirSync(LEARNING_DIR, { withFileTypes: true }) : [])
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')).map((d) => d.name);
}

function labPath(rel) {
  rel = String(rel || '');
  if (!/^[^/]+\/Labs\/[^/]+\.md$/.test(rel) || rel.split('/').some((p) => p === '..' || p.startsWith('.'))) return null;
  const full = path.resolve(LEARNING_DIR, rel);
  return full.startsWith(LEARNING_DIR + path.sep) && fs.existsSync(full) ? full : null;
}

// A lab file: frontmatter (subject, task, tags), "# Title", a "Goal:" line, "Source note: [[…]]",
// then one "## Step title" per step with "%% step: id %%", the instructions, and optional
// "> [!hint]-" and "> [!check]-" callouts (the check holds one command the app runs to verify).
function parseLab(rel) {
  const full = labPath(rel);
  if (!full) return null;
  const text = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
  const fm = fmMatch ? fmMatch[1] : '';
  const meta = Object.fromEntries(fm.split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]));
  const body = text.slice(fmMatch ? fmMatch[0].length : 0);
  const [intro, ...chunks] = body.split(/^## /m);
  const title = ((intro.match(/^# (.+)$/m) || [, ''])[1] || path.basename(rel, '.md')).trim();
  const goal = ((intro.match(/^Goal:\s*(.+)$/m) || [, ''])[1] || '').trim();
  const note = ((intro.match(/Source note:\s*\[\[([^\]|#]+)/) || [, ''])[1] || '').trim() || null;
  const steps = chunks.map((chunk, i) => {
    const lines = chunk.split('\n');
    const stitle = lines[0].trim();
    const id = ((chunk.match(/%%\s*step:\s*([\w-]+)\s*%%/) || [, ''])[1]) || `step-${i + 1}`;
    const callout = (kind) => {
      const m = chunk.match(new RegExp(`^>\\s*\\[!${kind}\\][-+]?.*\\n((?:>.*(?:\\n|$))*)`, 'mi'));
      return m ? m[1].split('\n').map((l) => l.replace(/^> ?/, '')).join('\n').trim() : null;
    };
    const hint = callout('hint');
    const checkRaw = callout('check');
    const check = checkRaw ? ((checkRaw.match(/```(?:bash|sh)?\n([\s\S]*?)```/) || [, checkRaw])[1]).trim() : null;
    // The instructions: everything except the id line and the hint/check callouts.
    const kept = [];
    let inCallout = false;
    for (const l of lines.slice(1)) {
      if (/^>\s*\[!(?:hint|check)\]/i.test(l)) { inCallout = true; continue; }
      if (inCallout && l.startsWith('>')) continue;
      inCallout = false;
      if (/^\s*%%.*%%\s*$/.test(l)) continue;
      kept.push(l);
    }
    const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { id, title: stitle, text, hint, check };
  });
  return { id: rel, subject: meta.subject || rel.split('/')[0], title, goal, note, task: meta.task || null, steps, raw: body.trim() };
}

function listLabs() {
  const out = [];
  for (const s of subjectDirs()) {
    const dir = path.join(LEARNING_DIR, s, 'Labs');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && !x.startsWith('.'))) {
      try { const l = parseLab(`${s}/Labs/${f}`); if (l) out.push(l); } catch (e) { console.error('[lab] bad lab file', f, e.message); }
    }
  }
  return out;
}

// The lab whose frontmatter `task:` (or title) matches a task text from another app (the NVIDIA plan).
function findLabForTask(task) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const t = norm(task);
  if (!t) return null;
  return listLabs().find((l) => (l.task && (norm(l.task) === t || t.includes(norm(l.task)) || norm(l.task).includes(t))) || norm(l.title) === t) || null;
}

// Runs a lab step's check command (from the vault file, never from the model). Its output is evidence for the teacher.
async function runCheck(cmd) {
  const r = await exec(cmd, { timeout: 20000 });
  const out = cleanTerm(`${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`);
  return { cmd, exit: r.code, output: clipMiddle(out, 3000).text, timedOut: r.timedOut };
}

// ---------- http ----------

// Host names the page may be served under: localhost, plus the app's public name (QUIZ_PUBLIC_URL,
// e.g. https://homebox.tailnet.ts.net/quiz) and any in QUIZ_LAB_HOSTS (comma separated).
function allowedHosts() {
  const out = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  try { if (process.env.QUIZ_PUBLIC_URL) out.add(new URL(process.env.QUIZ_PUBLIC_URL).hostname.toLowerCase()); } catch {}
  for (const h of String(process.env.QUIZ_LAB_HOSTS || '').split(',')) if (h.trim()) out.add(h.trim().toLowerCase());
  return out;
}

function guard(req) {
  const allowed = allowedHosts();
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!allowed.has(host)) return 'lab requests must come from this app\'s own address';
  const origin = req.headers.origin;
  if (origin) {
    let h = '';
    try { h = new URL(origin).hostname.toLowerCase(); } catch {}
    if (!allowed.has(h)) return 'cross-site request refused';
  }
  if (req.method !== 'GET' && req.headers['x-quiz-lab'] !== '1') return 'missing X-Quiz-Lab header';
  return null;
}

let ctx = null;

async function readJson(req) {
  let body;
  try { body = await ctx.readBody(req); } catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function stream(req, res, t, since) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const write = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} };
  res.write('retry: 2000\n\n');
  const start = t.total - t.buf.length;
  let from = Number.isFinite(since) && since >= 0 ? since : start;
  if (from < start || from > t.total) { write({ type: 'reset' }); from = start; }
  if (from < t.total) write({ type: 'data', o: from, d: t.buf.slice(from - start) });
  write({ type: 'state', alive: t.alive, total: t.total, cwd: t.cwd, exit: t.exitInfo });
  const fn = (ev) => write(ev);
  t.listeners.add(fn);
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
  const done = () => { clearInterval(beat); t.listeners.delete(fn); t.lastActive = Date.now(); };
  req.on('close', done);
  res.on('error', done);
}

async function handle(req, res, url, c) {
  ctx = ctx || c;
  const p = url.pathname;
  if (!p.startsWith('/api/lab/') && p !== '/api/lab') return false;
  const send = ctx.send;
  const bad = guard(req);
  if (bad) return send(res, 403, { error: bad }), true;
  try {
    if (req.method === 'GET' && p === '/api/lab/status') {
      return send(res, 200, await status(url.searchParams.get('force') === '1')), true;
    }
    if (req.method === 'POST' && p === '/api/lab/config') {
      const cfg = setConfig(await readJson(req));
      return send(res, 200, { ...cfg, status: await status(true) }), true;
    }
    const m = p.match(/^\/api\/lab\/term\/([\w-]{1,80})\/([\w-]+)(?:\/(\d+))?$/);
    if (!m) return send(res, 404, { error: 'not found' }), true;
    const [, owner, action, num] = m;

    if (req.method === 'GET' && action === 'stream') {
      const t = terms.get(owner);
      if (!t) return send(res, 404, { error: 'no terminal' }), true;   // the browser then shows Reconnect
      stream(req, res, t, Number(url.searchParams.get('since')));
      return true;
    }
    if (req.method === 'GET' && action === 'commands') {
      const t = terms.get(owner);
      return send(res, 200, { commands: commands(owner).slice(-200).map(summary), alive: !!(t && t.alive) }), true;
    }
    if (req.method === 'GET' && action === 'command' && num) {
      const cmd = commands(owner).find((x) => x.id === Number(num));
      return cmd ? send(res, 200, cmd) : send(res, 404, { error: 'no such command' }), true;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    const body = await readJson(req);
    if (action === 'open') {
      const st = await status();
      if (!st.ok) return send(res, 503, { error: st.error, status: st }), true;
      const t = openTerm(owner, body);
      const lp = lessonPath(body.dir, t.cfg.root);
      return send(res, 200, { alive: t.alive, total: t.total, status: st, dirPath: lp ? lp.shell : null }), true;
    }
    const t = terms.get(owner);
    if (action === 'input') {
      if (!t) return send(res, 409, { error: 'The terminal is not open' }), true;
      const data = typeof body.data === 'string' ? body.data : '';
      if (data.length > 65536) return send(res, 413, { error: 'too much input at once' }), true;
      t.input(data);
      return send(res, 200, { ok: true }), true;
    }
    if (action === 'resize') {
      if (t) t.resize(body.cols, body.rows);
      return send(res, 200, { ok: true }), true;
    }
    if (action === 'close') {
      if (t) { t.close(); }
      return send(res, 200, { ok: true }), true;
    }
    return send(res, 404, { error: 'unknown action' }), true;
  } catch (e) {
    if (!e.status) console.error('[lab]', e);
    return send(res, e.status || 500, { error: e.message }), true;
  }
}

module.exports = {
  init(c) { ctx = c; },
  handle,
  status, exec, config, lessonPath, listLabs, parseLab, findLabForTask, runCheck,
  commands, commandsAfter, lastId, isLive: (owner) => !!(terms.get(owner) && terms.get(owner).alive),
  // for tests
  cleanTerm, clipMiddle, Term, guard,
};
