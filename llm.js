'use strict';
// 🤖 One AI layer for the whole app. Every feature talks to "the AI" through here, and Settings → AI picks
// which engine answers, for the whole app or per area (Teach, Interview, Grading):
//   claude      Claude Code CLI on the Claude subscription (`claude -p --input-format stream-json`)
//   gemini-cli  Gemini CLI signed in with a Google account (Google AI Pro/Ultra subscription or the free tier),
//               one long-lived `gemini --acp` process per conversation (JSON-RPC over stdio)
//   gemini-api  Gemini API with an AI Studio key (pay per use; usage counted against a monthly cap)
//
// Models are chosen by tier, so one Settings choice works on every engine:
//   opus → Claude Opus / Gemini Pro · sonnet → Claude Sonnet / Gemini Flash · haiku → Claude Haiku / Gemini Flash-Lite
//
// Library:
//   const llm = require('./llm');
//   const chat = new llm.Chat({ area: 'teach', tier: 'opus', system });   // or { engine } to pin one
//   const { text, firstMs, totalMs } = await chat.send(content, { onText(delta) });   // turns run in order
//   chat.close();  chat.closed;  chat.busy;  chat.engine;  chat.label  ("Gemini Pro")
//   await llm.ask(prompt, { area, tier, system, timeoutMs, signal })   → reply text (one-shot)
//   llm.available(area) · llm.whyUnavailable(area) · llm.engineFor(area)
// `content` is a string or Anthropic-style blocks: {type:'text'}, {type:'image', source:{type:'base64', media_type, data}},
// {type:'document', source:{type:'base64', media_type:'application/pdf', data}}. Each engine converts them.
//
// Routes (writes need the `x-quiz-settings: 1` header, like prefs and voice):
//   GET  /api/llm                 → status of every engine + which engine each area uses
//   POST /api/llm/key {apiKey}    → check the Gemini API key with Google, then save it ('' removes it)
//   POST /api/llm/cap {usd}       → monthly Gemini API cap
//   POST /api/llm/test {engine}   → a tiny round trip ("Reply OK"), to check sign-in / key / install
// Secrets and usage: data/ai.json (gitignored with the rest of data/).

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CLAUDE_BIN, findBin, expandHome } = require('./config');

const prefs = (() => { try { return require('./prefs'); } catch { return null; } })();
const pref = (k, d) => { try { return (prefs && prefs.get(k)) ?? d; } catch { return d; } };

const ENGINES = ['claude', 'gemini-cli', 'gemini-api'];
const AREAS = ['teach', 'interview', 'grader'];
const ENGINE_LABEL = { claude: 'Claude', 'gemini-cli': 'Gemini', 'gemini-api': 'Gemini API' };
const TIER_NAMES = {
  claude: { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' },
  gemini: { opus: 'Pro', sonnet: 'Flash', haiku: 'Flash-Lite' },
};
const GEMINI_TIER = { opus: 'pro', sonnet: 'flash', haiku: 'flash-lite' };
const DEFAULT_TIMEOUT = 3 * 60 * 1000;

const isGemini = (e) => e === 'gemini-cli' || e === 'gemini-api';
const tierOf = (t) => (t in GEMINI_TIER ? t : 'opus');
function engineFor(area) {
  const v = area ? pref(`ai.${area}`, 'default') : 'default';
  const e = v && v !== 'default' ? v : pref('ai.engine', 'claude');
  return ENGINES.includes(e) ? e : 'claude';
}
// "Claude Opus", "Gemini Flash": what the app shows.
const modelLabel = (engine, tier) => `${isGemini(engine) ? 'Gemini' : 'Claude'} ${TIER_NAMES[isGemini(engine) ? 'gemini' : 'claude'][tierOf(tier)]}`;

// ---------- data/ai.json: Gemini key, cap, usage ----------

const DATA_DIR = path.join(__dirname, 'data');
const CONF_FILE = path.join(DATA_DIR, 'ai.json');
let conf = null;
function loadConf() {
  if (!conf) { try { conf = JSON.parse(fs.readFileSync(CONF_FILE, 'utf8')) || {}; } catch { conf = {}; } }
  conf.gemini ||= {}; conf.usage ||= {};
  return conf;
}
function saveConf() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONF_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(loadConf(), null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CONF_FILE);
}
const geminiKey = () => process.env.QUIZ_GEMINI_API_KEY || loadConf().gemini.apiKey || '';
const capUsd = () => { const c = Number(loadConf().gemini.capUsd); return Number.isFinite(c) && c >= 0 ? c : 10; };
const month = () => new Date().toISOString().slice(0, 7);
function monthUsage() { return loadConf().usage[month()] || { usd: 0, calls: 0, in: 0, out: 0 }; }

// ---------- engine: Claude Code CLI ----------

let claudeOk = null, claudeAt = 0;
function claudeAvailable() {
  if (claudeOk === null || (!claudeOk && Date.now() - claudeAt > 60 * 1000)) {
    const r = spawnSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8', timeout: 15000 });
    claudeOk = r.status === 0; claudeAt = Date.now();
  }
  return claudeOk;
}

class ClaudeProc {
  constructor({ system, tier }) {
    this.model = tierOf(tier);
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
      '--system-prompt', system || '', '--model', this.model];
    if (process.env.QUIZ_AI_EFFORT) args.push('--effort', process.env.QUIZ_AI_EFFORT);
    this.buf = ''; this.stderr = ''; this.cur = null; this.dead = false;
    // Detached: a kill reaches the whole group (the CLI can be a wrapper script that starts the real binary).
    this.proc = spawn(CLAUDE_BIN, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], ...SPAWN_OPTS });
    this.proc.stdout.setEncoding('utf8');   // a multi-byte char split across chunks must not be mangled
    this.proc.stdout.on('data', (d) => this.onData(d));
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    // Writing to a process that already died raises EPIPE: unhandled, it would crash the whole server.
    this.proc.stdin.on('error', () => {});
    this.proc.on('error', (e) => this.die(e));
    this.proc.on('exit', (code) => this.die(new Error(`Claude exited (code ${code}). ${this.stderr.slice(-300)}`)));
  }
  die(err) { this.dead = true; const c = this.cur; this.cur = null; if (c) c.reject(err); }
  onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line || !this.cur) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'stream_event') {
        const e = ev.event || {};
        if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' && e.delta.text) this.cur.onText(e.delta.text);
      } else if (ev.type === 'result') {
        const c = this.cur; this.cur = null;
        ev.is_error ? c.reject(new Error(ev.result || 'Claude returned an error')) : c.resolve(ev.result || '');
      }
    }
  }
  turn(content, onText) {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('Claude process has stopped'));
      this.cur = { resolve, reject, onText };
      this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    });
  }
  close() { try { this.proc.stdin.end(); } catch {} setTimeout(() => this.kill(), 5000).unref(); }
  kill(sig = 'SIGTERM') {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return;
    try { process.kill(-this.proc.pid, sig); } catch { try { this.proc.kill(sig); } catch {} }
  }
}

// ---------- engine: Gemini CLI (`gemini --acp`) ----------
// Isolated from his own Gemini CLI setup: our workspace settings (they win over ~/.gemini/settings.json) turn off every tool,
// MCP server, extension, skill and GEMINI.md memory; GEMINI_SYSTEM_MD swaps in the feature's system prompt.
// The Google sign-in is shared with his normal `gemini` (~/.gemini/oauth_creds.json).

const GEMINI_DIRS = [
  path.join(os.homedir(), '.local', 'share', 'gemini-cli', 'node_modules', '.bin'),   // tools/gemini/install.sh
  path.join(os.homedir(), '.npm-global', 'bin'), path.join(os.homedir(), '.local', 'bin'),
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),   // Windows: npm install -g
];
const geminiBin = () => (process.env.QUIZ_GEMINI_BIN ? expandHome(process.env.QUIZ_GEMINI_BIN) : findBin('gemini', GEMINI_DIRS));
const geminiHome = () => process.env.GEMINI_CLI_HOME || os.homedir();
// QUIZ_GEMINI_CLI_KEY: run the CLI on an API key instead of the Google sign-in (also how the tests run it).
const cliKey = () => process.env.QUIZ_GEMINI_CLI_KEY || '';
const geminiSignedIn = () => !!cliKey() || fs.existsSync(path.join(geminiHome(), '.gemini', 'oauth_creds.json'));
const CONF_DIR = path.join(os.tmpdir(), 'quiz-gemini');          // our settings + system prompts
const WORK_DIR = path.join(CONF_DIR, 'learning-quiz-ai');        // its working folder: empty (it lists it to the model)
// The CLI records every conversation (attachments included) in ~/.gemini/tmp/<folder name>/chats. That folder
// is ours alone, and the records carry their own ids, so: when no Gemini conversation is open, all go; while
// some are, the ones untouched for 10 minutes go (a record is only appended to, never read back).
const RECORD_DIR = () => path.join(geminiHome(), '.gemini', 'tmp', path.basename(WORK_DIR), 'chats');
const cliLive = new Set();
function dropRecordings() {
  try {
    for (const f of fs.readdirSync(RECORD_DIR())) {
      const full = path.join(RECORD_DIR(), f);
      if (!cliLive.size || Date.now() - fs.statSync(full).mtimeMs > 10 * 60000) fs.rmSync(full, { force: true });
    }
  } catch {}
}

let geminiVersion = null;

// How to run the CLI: its JS entry with this node. The bin is a symlink to it (npm on Mac/Linux), or on
// Windows a gemini.cmd shim next to node_modules/@google/gemini-cli (node won't spawn a .cmd without a shell).
// A systemd service has a thin PATH, so running node directly also avoids "node not found".
function geminiCommand(bin, args) {
  try { const real = fs.realpathSync(bin); if (/\.m?js$/.test(real)) return [process.execPath, [real, ...args]]; } catch {}
  try {
    const pkgDir = path.join(path.dirname(bin), 'node_modules', '@google', 'gemini-cli');
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const entry = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin || {}).gemini;
    if (entry) return [process.execPath, [path.join(pkgDir, entry), ...args]];
  } catch {}
  return [bin, args];
}
// Child processes get their own process group (so a kill takes their children too); Windows has no
// groups, and there `detached` would open a console window.
const SPAWN_OPTS = process.platform === 'win32' ? { windowsHide: true } : { detached: true };

// Every tool the CLI knows (0.66), excluded by name: `tools.core` alone no longer stops it declaring them.
const GEMINI_TOOLS = ['update_topic', 'list_directory', 'read_file', 'read_many_files', 'grep_search', 'search_file_content', 'glob', 'replace',
  'write_file', 'web_fetch', 'run_shell_command', 'list_background_processes', 'read_background_output', 'google_web_search', 'enter_plan_mode',
  'exit_plan_mode', 'invoke_agent', 'activate_skill', 'save_memory', 'write_todos', 'ask_user'];
function geminiSetup() {
  // Workspace settings (they win over his ~/.gemini/settings.json). A system settings file would win over
  // everything, but the CLI only reads one owned by root.
  fs.mkdirSync(path.join(WORK_DIR, '.gemini'), { recursive: true });
  const settings = path.join(WORK_DIR, '.gemini', 'settings.json');
  const want = JSON.stringify({
    security: { auth: { selectedType: cliKey() ? 'gemini-api-key' : 'oauth-personal' } },
    tools: { core: ['none'], exclude: GEMINI_TOOLS },
    skills: { enabled: false },
    context: { fileName: ['QUIZ-NO-CONTEXT.md'] },
    mcpServers: {},
    telemetry: { enabled: false },
    privacy: { usageStatisticsEnabled: false },
    general: { checkpointing: { enabled: false }, topicUpdateNarration: false },
    experimental: { topicUpdateNarration: false },
  }, null, 2);
  try { if (fs.readFileSync(settings, 'utf8') === want) return settings; } catch {}
  fs.writeFileSync(settings, want);
  return settings;
}
function systemFile(system) {
  fs.mkdirSync(CONF_DIR, { recursive: true });
  const f = path.join(CONF_DIR, `system-${crypto.createHash('sha1').update(system || '').digest('hex').slice(0, 16)}.md`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, system || 'You are a helpful assistant.');
  return f;
}
// Our blocks → ACP content blocks. The CLI passes image/audio data straight through as inlineData, so a PDF
// goes the same way (Gemini reads PDFs natively).
function toAcp(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if ((b.type === 'image' || b.type === 'document') && b.source && b.source.type === 'base64') {
      return { type: 'image', mimeType: b.source.media_type, data: b.source.data };
    }
    return { type: 'text', text: typeof b.text === 'string' ? b.text : '' };
  });
}
// Gemini errors come wrapped in JSON inside JSON: pull out the human sentence.
function readableError(msg) {
  let s = String(msg || 'Gemini returned an error');
  for (let i = 0; i < 4; i++) {
    const m = s.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!m) break;
    try { s = JSON.parse(`"${m[1]}"`); } catch { s = m[1]; }
  }
  if (/RESOURCE_EXHAUSTED|quota|exhausted your capacity|429/i.test(s)) s = `Gemini usage limit reached: ${s.slice(0, 200)}`;
  return s.slice(0, 400);
}

class GeminiCliProc {
  constructor({ system, tier }) {
    const bin = geminiBin();
    if (!bin) throw new Error('Gemini CLI is not installed (npm install -g @google/gemini-cli, or tools/gemini/install.sh)');
    if (!geminiSignedIn()) throw new Error('Gemini CLI is not signed in (Settings → AI shows how)');
    this.model = GEMINI_TIER[tierOf(tier)];
    this.buf = ''; this.stderr = ''; this.cur = null; this.dead = false;
    this.rpcs = new Map(); this.nextId = 1;
    const env = { ...process.env, GEMINI_SYSTEM_MD: systemFile(system),
      GEMINI_CLI_NO_RELAUNCH: 'true', NO_BROWSER: 'true', GEMINI_CLI_TRUST_WORKSPACE: 'true' };
    delete env.GEMINI_API_KEY; delete env.GOOGLE_API_KEY;   // the CLI engine is the Google sign-in, never a stray key
    if (cliKey()) env.GEMINI_API_KEY = cliKey();
    // The bin is a symlink to a node script: run it with this node (a systemd service has a thin PATH).
    geminiSetup();
    if (!cliLive.size) dropRecordings();
    const [cmd, args] = geminiCommand(bin, ['--acp', '--skip-trust', '-m', this.model, '-e', 'none', '--allowed-mcp-server-names', 'none']);
    this.proc = spawn(cmd, args, { cwd: WORK_DIR, env, stdio: ['pipe', 'pipe', 'pipe'], ...SPAWN_OPTS });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => this.onData(d));
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-3000); });
    this.proc.stdin.on('error', () => {});
    this.proc.on('error', (e) => this.die(e));
    cliLive.add(this);
    this.proc.on('exit', () => { cliLive.delete(this); dropRecordings(); });
    this.proc.on('exit', (code) => this.die(new Error(`Gemini CLI exited (code ${code}). ${this.stderr.split('\n').filter((l) => /error/i.test(l)).slice(-2).join(' ').slice(0, 300)}`)));
    // Handshake. A sign-in that expired makes the CLI wait for a code on the terminal: the timeout catches it.
    this.ready = (async () => {
      await this.rpc('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } }, 60000);
      const s = await this.rpc('session/new', { cwd: WORK_DIR, mcpServers: [] }, 60000);
      this.sessionId = s.sessionId;
    })();
    this.ready.catch(() => {});
  }
  die(err) {
    if (this.dead) return;
    this.dead = true;
    for (const w of this.rpcs.values()) { clearTimeout(w.timer); w.reject(err); }
    this.rpcs.clear();
    const c = this.cur; this.cur = null; if (c) c.reject(err);
  }
  rpc(method, params, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('Gemini CLI has stopped'));
      const id = this.nextId++;
      const w = { resolve, reject, method };
      if (timeoutMs) w.timer = setTimeout(() => { this.rpcs.delete(id); reject(new Error(`Gemini CLI did not answer (${method}). If its sign-in expired, sign in again (Settings → AI).`)); this.kill(); }, timeoutMs);
      this.rpcs.set(id, w);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  reply(id, result, error) { try { this.proc.stdin.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n'); } catch {} }
  onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line.startsWith('{')) continue;   // a sign-in prompt or other terminal text, not protocol
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id != null) {   // the agent asks us something: we grant nothing
        if (m.method === 'session/request_permission') this.reply(m.id, { outcome: { outcome: 'cancelled' } });
        else this.reply(m.id, null, { code: -32601, message: 'not supported' });
      } else if (m.method === 'session/update') {
        const u = (m.params && m.params.update) || {};
        if (u.sessionUpdate === 'agent_message_chunk' && u.content && u.content.type === 'text' && this.cur) {
          this.cur.text += u.content.text;
          this.cur.onText(u.content.text);
        }
      } else if (m.id != null && this.rpcs.has(m.id)) {
        const w = this.rpcs.get(m.id); this.rpcs.delete(m.id); clearTimeout(w.timer);
        m.error ? w.reject(new Error(readableError(m.error.message || JSON.stringify(m.error)))) : w.resolve(m.result || {});
      }
    }
  }
  async turn(content, onText) {
    await this.ready;
    return new Promise((resolve, reject) => {
      this.cur = { text: '', onText, reject };
      this.rpc('session/prompt', { sessionId: this.sessionId, prompt: toAcp(content) }).then((r) => {
        const c = this.cur; this.cur = null;
        if (!c) return;
        if (r.stopReason === 'cancelled') reject(new Error('Gemini cancelled the reply'));
        else if (!c.text.trim() && r.stopReason === 'refusal') reject(new Error('Gemini refused to answer'));
        else resolve(c.text);
      }, (e) => { this.cur = null; reject(e); });
    });
  }
  close() { try { this.proc.stdin.end(); } catch {} setTimeout(() => this.kill(), 3000).unref(); }
  kill(sig = 'SIGTERM') {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return;
    try { process.kill(-this.proc.pid, sig); } catch { try { this.proc.kill(sig); } catch {} }
  }
}

// ---------- engine: Gemini API (AI Studio key) ----------
// Stateless HTTP: the conversation is kept here and sent whole each turn (Gemini caches the repeated start).

const API_BASE = () => (process.env.QUIZ_GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
// USD per million tokens (input, output incl. thinking). Estimates for the cap; Google's bill is the truth.
const PRICE = { pro: [2, 12], flash: [0.5, 3], 'flash-lite': [0.1, 0.4] };
const FALLBACK_MODEL = { pro: 'gemini-pro-latest', flash: 'gemini-flash-latest', 'flash-lite': 'gemini-flash-lite-latest' };
function apiModel(t) {
  const env = process.env[`QUIZ_GEMINI_MODEL_${t.replace('-', '_').toUpperCase()}`];
  return env || (loadConf().gemini.models || {})[t] || FALLBACK_MODEL[t];
}
// The newest model of each tier among what the key can use (from Google's model list).
function pickModels(names) {
  const out = {};
  for (const t of ['pro', 'flash', 'flash-lite']) {
    if (names.includes(`gemini-${t}-latest`)) { out[t] = `gemini-${t}-latest`; continue; }
    const re = new RegExp(`^gemini-(\\d+(?:\\.\\d+)?)-${t}(-preview)?$`);
    const hits = names.map((n) => { const m = n.match(re); return m && { n, v: Number(m[1]), pre: !!m[2] }; }).filter(Boolean)
      .sort((a, b) => b.v - a.v || a.pre - b.pre);
    if (hits.length) out[t] = hits[0].n;
  }
  return out;
}
async function listModels(key) {
  const r = await fetch(`${API_BASE()}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(readableError((j.error && j.error.message) || `Google said ${r.status}`)), { status: 400 });
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
}
function toParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((b) => {
    if ((b.type === 'image' || b.type === 'document') && b.source && b.source.type === 'base64') return { inlineData: { mimeType: b.source.media_type, data: b.source.data } };
    return { text: typeof b.text === 'string' ? b.text : '' };
  }).filter((p) => p.inlineData || p.text);
}
function recordUsage(tier, u) {
  if (!u) return;
  const inTok = u.promptTokenCount || 0, outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  const [pi, po] = PRICE[tier] || PRICE.pro;
  const c = loadConf(), m = (c.usage[month()] ||= { usd: 0, calls: 0, in: 0, out: 0 });
  m.calls++; m.in += inTok; m.out += outTok; m.usd = Math.round((m.usd + (inTok * pi + outTok * po) / 1e6) * 10000) / 10000;
  for (const k of Object.keys(c.usage).sort().slice(0, -12)) delete c.usage[k];   // keep a year
  try { saveConf(); } catch (e) { console.error('[llm] usage save:', e.message); }
}

class GeminiApiChat {
  constructor({ system, tier }) {
    if (!geminiKey()) throw new Error('No Gemini API key (add one in Settings → AI)');
    this.tier = GEMINI_TIER[tierOf(tier)];
    this.model = apiModel(this.tier);
    this.system = system || '';
    this.history = [];
    this.dead = false;
    this.ac = null;
  }
  async turn(content, onText) {
    if (this.dead) throw new Error('Gemini conversation is closed');
    if (monthUsage().usd >= capUsd()) throw new Error(`Gemini API monthly cap reached ($${capUsd()}). Raise it in Settings → AI.`);
    const user = { role: 'user', parts: toParts(content) };
    this.ac = new AbortController();
    const body = { contents: [...this.history, user] };
    if (this.system) body.systemInstruction = { parts: [{ text: this.system }] };
    const r = await fetch(`${API_BASE()}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey() }, body: JSON.stringify(body), signal: this.ac.signal,
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(readableError(t || `Gemini API said ${r.status}`)); }
    let text = '', buf = '', usage = null, finish = null;
    const dec = new TextDecoder();
    const handle = (line) => {
      if (!line.startsWith('data:')) return;
      let j; try { j = JSON.parse(line.slice(5).trim()); } catch { return; }
      if (j.usageMetadata) usage = j.usageMetadata;
      const c = (j.candidates || [])[0];
      if (!c) return;
      if (c.finishReason) finish = c.finishReason;
      for (const p of (c.content && c.content.parts) || []) if (p.text && !p.thought) { text += p.text; onText(p.text); }
    };
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    }
    handle(buf.trim());
    recordUsage(this.tier, usage);
    if (!text.trim() && finish && finish !== 'STOP') throw new Error(`Gemini stopped without an answer (${finish})`);
    this.history.push(user, { role: 'model', parts: [{ text }] });
    return text;
  }
  close() { this.dead = true; }
  kill() { this.dead = true; try { this.ac && this.ac.abort(); } catch {} }
}

// ---------- one conversation, any engine ----------

const IMPL = { claude: ClaudeProc, 'gemini-cli': GeminiCliProc, 'gemini-api': GeminiApiChat };
const live = new Set();

class Chat {
  constructor({ area = null, engine = null, tier = 'opus', system = '', turnTimeoutMs = DEFAULT_TIMEOUT, name = 'AI' } = {}) {
    this.engine = ENGINES.includes(engine) ? engine : engineFor(area);
    this.tier = tierOf(tier);
    this.label = modelLabel(this.engine, this.tier);
    this.name = name;
    this.turnTimeoutMs = turnTimeoutMs;
    this.closed = false;
    this.busy = false;
    this.queue = Promise.resolve();
    this.impl = new IMPL[this.engine]({ system, tier: this.tier });   // throws when the engine can't start
    live.add(this);
  }
  // One user message → the whole reply. onText(delta) gets the reply as it streams. Turns run one at a time.
  send(content, { onText } = {}) {
    const run = async () => {
      if (this.closed || this.impl.dead) throw new Error(`${this.name} has stopped`);
      this.busy = true;
      const sentAt = Date.now();
      let firstAt = null;
      const feed = (d) => { if (firstAt === null) firstAt = Date.now(); if (onText) { try { onText(d); } catch (e) { console.error(`[llm] ${this.name} text handler:`, e.message); } } };
      let timer;
      // A turn that runs out of time is killed, never left running: its late reply would be taken as the
      // answer to the NEXT turn. The next turn starts a fresh conversation.
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { this.closed = true; this.impl.kill(); reject(new Error(`${this.label} took too long to reply`)); }, this.turnTimeoutMs); });
      try {
        const text = await Promise.race([this.impl.turn(content, feed), timeout]);
        return { text, firstMs: firstAt ? firstAt - sentAt : null, totalMs: Date.now() - sentAt };
      } finally { clearTimeout(timer); this.busy = false; if (this.impl.dead) this.closed = true; }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  async ask(content, opts) { return (await this.send(content, opts)).text; }
  close() { if (!live.has(this)) return; this.closed = true; live.delete(this); this.impl.close(); }
  kill() { this.closed = true; live.delete(this); this.impl.kill(); }
}

// One prompt, one reply, no conversation kept. signal (AbortSignal): aborting kills it and rejects with AbortError.
async function ask(prompt, { area = null, engine = null, tier, system = '', timeoutMs = DEFAULT_TIMEOUT, signal } = {}) {
  const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
  if (signal && signal.aborted) throw abortError();
  const chat = new Chat({ area, engine, tier: tier || defaultTier(area), system, turnTimeoutMs: timeoutMs });
  let onAbort;
  try {
    const aborted = new Promise((_, reject) => { onAbort = () => { chat.kill(); setTimeout(() => chat.impl.kill && chat.impl.kill('SIGKILL'), 2000).unref(); reject(abortError()); }; if (signal) signal.addEventListener('abort', onAbort, { once: true }); });
    const r = await Promise.race([chat.send(prompt), aborted]);
    return r.text;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    chat.close();
  }
}

// The Settings tier for an area: Teach → teacher.model, everything else → teacher.graderModel.
const defaultTier = (area) => tierOf(process.env.QUIZ_AI_MODEL || pref(area === 'teach' ? 'teacher.model' : 'teacher.graderModel', 'opus'));

function engineStatus(e) {
  if (e === 'claude') return claudeAvailable() ? { ok: true } : { ok: false, why: 'Claude Code CLI not found' };
  if (e === 'gemini-cli') {
    if (!geminiBin()) return { ok: false, why: 'Gemini CLI is not installed' };
    if (!geminiSignedIn()) return { ok: false, why: 'Gemini CLI is not signed in' };
    return { ok: true };
  }
  if (!geminiKey()) return { ok: false, why: 'No Gemini API key' };
  if (monthUsage().usd >= capUsd()) return { ok: false, why: `Gemini API monthly cap reached ($${capUsd()})` };
  return { ok: true };
}
const available = (area) => engineStatus(engineFor(area)).ok;
const whyUnavailable = (area) => { const s = engineStatus(engineFor(area)); return s.ok ? null : s.why; };

// Kill every AI process when the server goes away. `node --watch` restarts send SIGTERM, which skips 'exit'
// handlers, so handle the signals too; the last module to handle a signal re-raises it.
const killAll = () => { for (const c of live) { try { c.impl.kill(); } catch {} } live.clear(); };
process.on('exit', killAll);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.once(sig, () => { killAll(); if (!process.listenerCount(sig)) { try { process.kill(process.pid, sig); } catch { process.exit(0); } } });
}

// ---------- routes ----------

function status() {
  const c = loadConf();
  const bin = geminiBin();
  if (bin && geminiVersion === null) {
    const [cmd, args] = geminiCommand(bin, ['--version']);
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, env: { ...process.env, GEMINI_CLI_NO_RELAUNCH: 'true' } });
    geminiVersion = r.status === 0 ? r.stdout.trim() : '';
  }
  const key = geminiKey();
  return {
    engine: pref('ai.engine', 'claude'),
    areas: Object.fromEntries(AREAS.map((a) => [a, { pref: pref(`ai.${a}`, 'default'), engine: engineFor(a), model: modelLabel(engineFor(a), defaultTier(a)) }])),
    engines: {
      claude: { ...engineStatus('claude'), bin: CLAUDE_BIN },
      'gemini-cli': { ...engineStatus('gemini-cli'), installed: !!bin, signedIn: geminiSignedIn(), version: geminiVersion || null, bin: bin || null,
        loginCmd: bin ? `${bin.replace(os.homedir(), '~')}` : null },
      'gemini-api': { ...engineStatus('gemini-api'), hasKey: !!key, fromEnv: !!process.env.QUIZ_GEMINI_API_KEY, keyHint: key ? `…${key.slice(-4)}` : null,
        capUsd: capUsd(), usage: { month: month(), ...monthUsage() }, models: { pro: apiModel('pro'), flash: apiModel('flash'), 'flash-lite': apiModel('flash-lite') } },
    },
    tiers: TIER_NAMES,
  };
}

async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (p !== '/api/llm' && !p.startsWith('/api/llm/')) return false;
  const send = ctx.send;
  try {
    if (req.method === 'GET' && p === '/api/llm') return send(res, 200, status()), true;
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    if (req.headers['x-quiz-settings'] !== '1') return send(res, 403, { error: 'missing settings header' }), true;
    const body = (await ctx.readBody(req)) || {};
    if (p === '/api/llm/key') {
      const key = String(body.apiKey || '').trim();
      const c = loadConf();
      if (!key) { delete c.gemini.apiKey; delete c.gemini.models; saveConf(); return send(res, 200, status()), true; }
      if (!/^[\w-]{20,200}$/.test(key)) return send(res, 400, { error: 'That does not look like a Gemini API key' }), true;
      const names = await listModels(key);
      c.gemini.apiKey = key; c.gemini.models = pickModels(names); c.gemini.checkedAt = new Date().toISOString();
      saveConf();
      return send(res, 200, status()), true;
    }
    if (p === '/api/llm/cap') {
      const usd = Number(body.usd);
      if (!Number.isFinite(usd) || usd < 0 || usd > 1000) return send(res, 400, { error: 'cap must be 0-1000 USD' }), true;
      loadConf().gemini.capUsd = usd; saveConf();
      return send(res, 200, status()), true;
    }
    if (p === '/api/llm/test') {
      const engine = ENGINES.includes(body.engine) ? body.engine : engineFor(null);
      const st = engineStatus(engine);
      if (!st.ok) return send(res, 200, { ok: false, engine, error: st.why }), true;
      const t = Date.now();
      try {
        const reply = await ask('Reply with exactly the word OK and nothing else.', { engine, tier: 'haiku', system: 'You are a connection check. Reply with exactly: OK', timeoutMs: 90000 });
        return send(res, 200, { ok: /\bok\b/i.test(reply), engine, model: modelLabel(engine, 'haiku'), ms: Date.now() - t, reply: reply.trim().slice(0, 200) }), true;
      } catch (e) {
        return send(res, 200, { ok: false, engine, error: e.message, ms: Date.now() - t }), true;
      }
    }
    return send(res, 404, { error: 'not found' }), true;
  } catch (e) {
    return send(res, e.status || 500, { error: e.message }), true;
  }
}

module.exports = {
  Chat, ask, available, whyUnavailable, engineFor, engineStatus, modelLabel, defaultTier, tierOf, isGemini, handle, status,
  ENGINES, AREAS, ENGINE_LABEL, TIER_NAMES, GEMINI_TIER, pickModels, toAcp, toParts, readableError, geminiCommand,
};
