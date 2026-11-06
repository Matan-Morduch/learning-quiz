'use strict';
// 🔊 Voice for board narration, "Read aloud" and live talk. Three engines, cheapest first:
//   local       Kokoro-82M on this machine (tools/tts-server: Apple MLX on a Mac, ONNX Runtime CUDA/CPU on Linux): free, the default once installed.
//   elevenlabs  ElevenLabs API (Flash v2.5 by default, v3 for best quality): paid per character, opt-in.
//   browser     the browser's speechSynthesis: what the page falls back to when neither can speak.
// Zero npm dependencies (Node's fetch + child_process).
//
// Config: data/voice.json (gitignored)
//   { engine: 'local'|'elevenlabs', elevenModel: 'eleven_flash_v2_5'|'eleven_v3', localVoice: 'bm_george',
//     liveEngine?: 'elevenlabs' (live talk is local unless this says so), apiKey, voiceId, monthlyCapUsd, baseUrl? }
//   apiKey falls back to env ELEVENLABS_API_KEY. baseUrl (default https://api.elevenlabs.io) lets tests use a mock.
//   The key is never logged or sent to the browser (except to the settings popup, on demand).
// Cost rules: local audio is free and not counted. ElevenLabs audio is never made ahead of time:
//   pregenerate() only runs for the local engine; a board asks for the step it plays + the next one.
//   Every paid call is logged; a soft monthly cap (monthlyCapUsd, default 5) stops new paid audio,
//   and the local voice (or the browser) covers the rest.
// Local engine: a Python sidecar (tools/tts-server/server.py, installed by tools/tts-server/install.sh into
//   ~/.local/share/quiz-tts) on 127.0.0.1:8737, spawned on the first local request (detached, so it survives
//   app restarts; it exits by itself after 20 idle minutes to give the RAM back). Same API on every platform;
//   installed.json says which backend the install chose (mlx | onnx-cuda | onnx-cpu), exposed as local.backend /
//   local.where / local.label for the UI's wording ("on this Mac" vs "on this server").
// Cache:  data/tts/<sha256>.mp3, keyed by (engine, text, voice, model/speed, format). Replays cost nothing.
// Usage:  data/voice-usage.json { months: { "2026-10": { chars, estUsd, calls } }, calls: [{ ts, chars, model, purpose, estUsd }] }
//
// Endpoints:
//   GET  /api/voice/status (alias /usage)  → { engine (what boards use now), want, configured, usable, reason, voice, model,
//                                             local: { installed, state, voice }, month, subscription?, lastError?, capAlert? }
//   (status, tts and board responses carry capAlert { pct, estUsd, cap, month, usedPct } once this month's spend
//    reaches the voice.capAlertPct pref's share of monthlyCapUsd; see capAlert())
//   POST /api/voice/tts {text, purpose, engine?} → { url, engine }  |  503 { fallback: true, reason }
//        purpose 'live' always uses the local engine (never ElevenLabs) unless config liveEngine is 'elevenlabs'.
//        purpose 'interview' (the Interview tab): the engine he picked for that interview (engine: 'local' |
//        'elevenlabs', default local) and, for local, voice: a Kokoro voice id; ElevenLabs uses liveModel (Flash).
//   POST /api/voice/board {steps: [say…], generate?, only?: [i…], engine?}
//        → { voice: true, engine, urls, paidChars, estUsd } | { voice: false, reason, message }
//        local: every step is made (free). elevenlabs: only the steps in `only` (default the first two);
//        generate: false → only report what's already made. engine: 'elevenlabs' plays one board with the premium voice.
//   GET  /api/voice/audio/<hash>.mp3        → the MP3 (waits if it is still being generated)
//   GET  /api/voice/voices                  → { voices: [ElevenLabs voices], current }
//   POST /api/voice/config {voiceId, ownerId?, name?}  → saves the ElevenLabs voice (a library voice is added to the account first)
//   POST /api/voice/local-voice {voice}     → saves the local voice (bm_george…)
//   POST /api/voice/preview {voice}         → { url } a short local sample of that voice (cached)
// Settings popup (ui/settings.js); routes that change settings or reveal the key need the
// `x-quiz-settings: 1` header, which another website's page can't send without a CORS preflight we never answer:
//   GET  /api/voice/settings                → { engine, elevenModel, local, hasKey, keyHint, plan, month, cap, voice, presets }
//   POST /api/voice/engine {engine?, elevenModel?}
//   POST /api/voice/key/reveal               → { apiKey }
//   POST /api/voice/key {apiKey}             → checks the key with ElevenLabs, then saves it ("" removes it)
//   POST /api/voice/cap {monthlyCapUsd}
//   GET  /api/voice/library?q=&page=         → { voices: [default/own voices that match, then the shared library], hasMore }
// Teach calls pregenerate(board) right after the teacher's turn creates a board (local engine only: free).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
let prefs = null;   // app preferences (prefs.js): voice.capAlertPct
try { prefs = require('./prefs'); } catch {}

// ElevenLabs API prices per 1K characters (elevenlabs.io/pricing/api, checked 2026-10-30: Flash/Turbo $0.04,
// Multilingual v2 / v3 / v4 $0.08; API usage is billed in dollars, the same on every tier. On subscription
// plans Flash costs 0.5 credit per character, v3 1 credit). Edit here if prices change. Unknown models count at the default.
const PRICE_PER_1K = {
  eleven_v4: 0.08, eleven_v3: 0.08, eleven_multilingual_v2: 0.08,
  eleven_flash_v2_5: 0.04, eleven_flash_v2: 0.04, eleven_turbo_v2_5: 0.04, eleven_turbo_v2: 0.04,
  default: 0.08,
};
// Characters per request (elevenlabs.io/docs/models). Longer "Read aloud" texts switch to multilingual v2.
const MAX_CHARS = { eleven_v3: 5000, eleven_multilingual_v2: 10000, eleven_flash_v2_5: 40000, eleven_flash_v2: 30000, default: 5000 };
const ELEVEN_MODELS = ['eleven_flash_v2_5', 'eleven_v3'];
const DEFAULTS = {
  engine: 'local',
  voiceId: 'JBFqnCBsd6RMkjVDRZzb',   // "George": warm, calm British narrator (a default/premade voice)
  model: 'eleven_flash_v2_5',         // half the price of v3; v3 is the "best quality" choice
  liveModel: 'eleven_flash_v2_5',
  localVoice: 'bm_george',
  monthlyCapUsd: 5,
  baseUrl: 'https://api.elevenlabs.io',
};
const FORMAT = 'mp3_44100_128';
const SETTINGS = { stability: 0.5, similarity_boost: 0.75 };   // v3 accepts 0 / 0.5 / 1 for stability ("Natural" = 0.5)
const TAG_MODELS = /^eleven_v[34]/;      // models that understand audio tags like [thoughtful]
const TAG_RE = /\[(?:[a-z]+(?: [a-z]+){0,2})\]\s*/gi;
const CONCURRENCY = 2;

// ---------- local engine (Kokoro sidecar) ----------
const LOCAL_HOME = process.env.QUIZ_TTS_HOME || path.join(os.homedir(), '.local', 'share', 'quiz-tts');
const LOCAL_PORT = Number(process.env.QUIZ_TTS_PORT) || 8737;
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const LOCAL_PY = path.join(LOCAL_HOME, 'venv', 'bin', 'python');
const LOCAL_SERVER = path.join(__dirname, 'tools', 'tts-server', 'server.py');
const LOCAL_IDLE_S = 20 * 60;
const LOCAL_FORMAT = 'mp3_24000_64';
const INSTALL_CMD = 'tools/tts-server/install.sh';
const LOCAL_WHERE = process.platform === 'darwin' ? 'on this Mac' : 'on this server';
const BACKEND_LABEL = { mlx: 'Kokoro on Apple MLX', 'onnx-cuda': 'Kokoro on the GPU (CUDA)', 'onnx-cpu': 'Kokoro on the CPU' };
// Kokoro voices offered in the settings popup (English; the model has more). Grades from the model card.
const LOCAL_VOICES = [
  { id: 'bm_george', name: 'George', note: 'British male · calm narrator · default' },
  { id: 'bm_fable', name: 'Fable', note: 'British male · storyteller' },
  { id: 'bm_lewis', name: 'Lewis', note: 'British male · deeper' },
  { id: 'am_michael', name: 'Michael', note: 'American male · warm' },
  { id: 'am_fenrir', name: 'Fenrir', note: 'American male · bright' },
  { id: 'af_heart', name: 'Heart', note: 'American female · Kokoro’s best-rated voice' },
  { id: 'af_bella', name: 'Bella', note: 'American female · lively' },
  { id: 'bf_emma', name: 'Emma', note: 'British female · clear' },
];
const LOCAL_IDS = /^[ab][fm]_[a-z]{2,20}$/;
const PREVIEW_TEXT = 'Here is the idea. A process is a running program, and the kernel gives each one its own memory.';

let ctx = null;
let CFG_FILE, USAGE_FILE, TTS_DIR;
const inflight = new Map();      // hash → Promise (one upstream call per hash, however many ask)
const queue = [];                // pending ElevenLabs calls, oldest first (board steps keep their order)
let active = 0;
let localChain = Promise.resolve();   // local synthesis, one at a time (the sidecar serializes anyway)
let lastError = null;            // { at, message } of the last failed upstream call
let subCache = { at: 0, key: '', data: null };
let voicesCache = { at: 0, key: '', data: null };
const local = { state: 'stopped', starting: null, proc: null, error: null };

// The voices offered at the top of the settings popup. Pastor Paul is from the shared library (needs a paid plan for API use).
const PRESETS = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', note: 'Warm, captivating storyteller · default', library: false },
  { id: 'yPPPvy89s6x00I9xDhZC', name: 'Pastor Paul', note: 'Warm pastoral teacher · voice library', library: true, ownerId: '9e497dc3c7a6929e2ece175370ddb836a64d2d93973890efe1715a262bb76f0c' },
];
const previewCache = new Map();   // voice id → preview url

function init(c) {
  ctx = c;
  CFG_FILE = path.join(ctx.DATA_DIR, 'voice.json');
  USAGE_FILE = path.join(ctx.DATA_DIR, 'voice-usage.json');
  TTS_DIR = path.join(ctx.DATA_DIR, 'tts');
}
function dirs() { if (!CFG_FILE) init({ DATA_DIR: path.join(__dirname, 'data') }); }

const err = (msg, status, extra) => Object.assign(new Error(msg), { status, ...extra });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function writeJson(f, d, mode) {
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, f);
}

function config() {
  dirs();
  const f = readJson(CFG_FILE) || {};
  const apiKey = String(f.apiKey || process.env.ELEVENLABS_API_KEY || '').trim();
  const cap = Number(f.monthlyCapUsd);
  const speed = Number(f.localSpeed);
  return {
    apiKey,
    engine: f.engine === 'elevenlabs' ? 'elevenlabs' : DEFAULTS.engine,
    voiceId: String(f.voiceId || DEFAULTS.voiceId),
    model: String(f.elevenModel || f.model || DEFAULTS.model),
    liveModel: String(f.liveModel || DEFAULTS.liveModel),
    liveEngine: f.liveEngine === 'elevenlabs' ? 'elevenlabs' : 'local',
    localVoice: LOCAL_IDS.test(f.localVoice || '') ? f.localVoice : DEFAULTS.localVoice,
    localSpeed: Number.isFinite(speed) && speed >= 0.5 && speed <= 2 ? speed : 1,
    monthlyCapUsd: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULTS.monthlyCapUsd,
    baseUrl: String(f.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''),
  };
}

// ---------- usage + cap (ElevenLabs only: local audio is free) ----------

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const price = (model) => PRICE_PER_1K[model] ?? PRICE_PER_1K.default;
const usd = (n) => Math.round(n * 10000) / 10000;
function usage() {
  dirs();
  const u = readJson(USAGE_FILE) || {};
  return { months: u.months || {}, calls: Array.isArray(u.calls) ? u.calls : [] };
}
function month() {
  const m = usage().months[monthKey()] || { chars: 0, estUsd: 0, calls: 0 };
  return { key: monthKey(), chars: m.chars, estUsd: usd(m.estUsd), calls: m.calls };
}
function record(chars, model, purpose) {
  const u = usage();
  const estUsd = usd((chars / 1000) * price(model));
  const k = monthKey();
  const m = u.months[k] || (u.months[k] = { chars: 0, estUsd: 0, calls: 0 });
  m.chars += chars; m.estUsd = usd(m.estUsd + estUsd); m.calls += 1;
  u.calls.push({ ts: new Date().toISOString(), chars, model, purpose, estUsd });
  if (u.calls.length > 3000) u.calls = u.calls.slice(-3000);
  writeJson(USAGE_FILE, u);
}
// Why new paid audio can't be made right now, or null when it can.
function blocked(cfg = config()) {
  if (!cfg.apiKey) return 'unconfigured';
  if (month().estUsd >= cfg.monthlyCapUsd) return 'cap';
  return null;
}
// The spend alert (pref voice.capAlertPct: 0 = off, else 50/80/90 % of monthlyCapUsd): once this month's
// estimated ElevenLabs spend reaches it, status / tts / board responses carry
// capAlert { pct, estUsd, cap, month, usedPct } (stateless; the browser shows it once per month and threshold).
function capAlert(cfg = config(), m = month(), pct = prefs ? Number(prefs.get('voice.capAlertPct')) : 80) {
  const cap = Number(cfg.monthlyCapUsd);
  if (!pct || !(cap > 0) || !(m.estUsd > 0)) return null;
  if (m.estUsd < (cap * pct) / 100) return null;
  return { pct, estUsd: m.estUsd, cap, month: m.key, usedPct: Math.round((m.estUsd / cap) * 100) };
}
const withAlert = (o) => { try { const a = capAlert(); if (a) o.capAlert = a; } catch {} return o; };
const REASONS = {
  unconfigured: 'No ElevenLabs key yet: using the free voice.',
  cap: 'This month’s ElevenLabs budget is used up: using the free voice.',
  nolocal: `The local voice isn't installed (run ${INSTALL_CMD}): using the browser voice.`,
  localfail: 'The local voice failed to start: using the browser voice.',
};

// ---------- local engine: the Kokoro sidecar ----------

const localInstalled = () => fs.existsSync(path.join(LOCAL_HOME, 'installed.json')) && fs.existsSync(LOCAL_PY) && fs.existsSync(LOCAL_SERVER);
// What the install chose (installed.json: {engine, backend?}; Mac installs from before Linux support have no backend).
function localInfo() {
  const j = readJson(path.join(LOCAL_HOME, 'installed.json')) || {};
  const backend = BACKEND_LABEL[j.backend] ? j.backend : (j.engine === 'kokoro-mlx' ? 'mlx' : j.engine ? 'onnx-cpu' : null);
  return { backend, where: LOCAL_WHERE, label: backend ? `${BACKEND_LABEL[backend]}, ${LOCAL_WHERE}` : `Kokoro, ${LOCAL_WHERE}` };
}
async function localHealth() {
  try { const r = await fetch(`${LOCAL_URL}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; }
}
// Resolves once the sidecar answers ready: reuses a running one (also one left by an earlier app run),
// else spawns it (detached: the app's restarts don't kill it; it exits after 20 idle minutes).
function startLocal() {
  if (local.starting) return local.starting;
  local.starting = (async () => {
    let h = await localHealth();
    if (h && h.ready) { local.state = 'ready'; local.error = null; return; }
    if (!h) {
      if (!localInstalled()) { local.state = 'missing'; throw err(REASONS.nolocal, 503, { reason: 'nolocal' }); }
      local.state = 'starting';
      const logFd = fs.openSync(path.join(LOCAL_HOME, 'server.log'), 'a');
      const p = spawn(LOCAL_PY, [LOCAL_SERVER, '--home', LOCAL_HOME, '--port', String(LOCAL_PORT), '--idle', String(LOCAL_IDLE_S)],
        { detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
      fs.closeSync(logFd);
      p.on('error', () => {});
      p.unref();
      local.proc = p;
    }
    local.state = 'starting';
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await sleep(300);
      h = await localHealth();
      if (h && h.ready) { local.state = 'ready'; local.error = null; return; }
      if (h && h.ok === false) throw err(`Local voice: ${h.error}`, 503, { reason: 'localfail' });
      if (!h && local.proc && local.proc.exitCode !== null) throw err(`Local voice server exited (see ${path.join(LOCAL_HOME, 'server.log')})`, 503, { reason: 'localfail' });
    }
    throw err('The local voice took too long to start', 503, { reason: 'localfail' });
  })().catch((e) => {
    if (e.reason !== 'nolocal') { local.state = 'error'; local.error = e.message; console.error('[voice] local:', e.message); }
    throw e;
  }).finally(() => { local.starting = null; });
  return local.starting;
}
async function localState() {
  if (!localInstalled()) return 'missing';
  if (local.starting) return 'starting';
  const h = await localHealth();
  if (h) return h.ready ? 'ready' : 'starting';
  return local.state === 'error' ? 'error' : 'stopped';
}
async function callLocal(job) {
  for (let attempt = 0; ; attempt++) {
    await startLocal();
    try {
      const r = await fetch(`${LOCAL_URL}/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: job.text, voice: job.voice, speed: job.speed }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) { let d = ''; try { d = (await r.json()).error; } catch {} throw err(`Local voice ${r.status}${d ? `: ${d}` : ''}`, 502); }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) throw err('Local voice returned no audio', 502);
      return buf;
    } catch (e) {
      // It may have exited (idle) between the health check and the call: start it once more.
      if (attempt === 0 && e.cause && /ECONNREFUSED|ECONNRESET|other side closed/i.test(String(e.cause.code || e.cause.message))) continue;
      throw e;
    }
  }
}

// ---------- engine choice ----------

// Which engine makes this audio: the wanted one, or a free stand-in. Paid audio only when chosen
// (config, or a one-board override); 'live' is local unless liveEngine says otherwise.
// → { engine: 'local'|'elevenlabs'|null, want, why }  (null: the browser voice speaks)
function pickEngine(cfg, purpose, override) {
  const want = override === 'elevenlabs' || override === 'local' ? override
    : purpose === 'live' ? cfg.liveEngine : cfg.engine;
  let why = null;
  if (want === 'elevenlabs') {
    why = blocked(cfg);
    if (!why) return { engine: 'elevenlabs', want, why: null };
  }
  if (localInstalled()) return { engine: 'local', want, why };
  return { engine: null, want, why: why || 'nolocal' };
}

// ---------- text-to-speech ----------

// Kokoro has no audio tags: pauses become punctuation, the rest go.
function kokoroText(t) {
  return t.replace(/\[(?:short |long )?pause\]\s*/gi, '... ')
    .replace(TAG_RE, '')
    .replace(/(\.\.\.\s*){2,}/g, '... ')
    .replace(/([,.;:!?])\s*\.\.\./g, '$1')
    .replace(/\s+/g, ' ').trim();
}
// What the engine will actually be sent, and the cache key for it.
function prepare(text, purpose, cfg, engine, opts = {}) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (engine === 'local') {
    t = kokoroText(t).slice(0, 8000);
    const voice = opts.voice || cfg.localVoice;
    const speed = cfg.localSpeed;
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify({ e: 'kokoro', t, v: voice, sp: speed, f: LOCAL_FORMAT })).digest('hex');
    return { engine, text: t, voice, speed, model: 'kokoro', hash, purpose };
  }
  let model = purpose === 'live' || purpose === 'interview' ? cfg.liveModel : cfg.model;
  if (t.length > (MAX_CHARS[model] || MAX_CHARS.default)) model = 'eleven_multilingual_v2';
  if (!TAG_MODELS.test(model)) t = t.replace(TAG_RE, '').trim();
  t = t.slice(0, MAX_CHARS[model] || MAX_CHARS.default);
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ t, v: cfg.voiceId, m: model, s: SETTINGS, f: FORMAT })).digest('hex');
  return { engine, text: t, model, hash, purpose };
}
const fileOf = (hash) => path.join(TTS_DIR, `${hash}.mp3`);
const urlOf = (hash) => `api/voice/audio/${hash}.mp3`;
const cached = (hash) => { try { return fs.statSync(fileOf(hash)).size > 0; } catch { return false; } };

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift();
    active++;
    job.run().then(job.resolve, job.reject).finally(() => { active--; pump(); });
  }
}
function enqueue(run) { return new Promise((resolve, reject) => { queue.push({ run, resolve, reject }); pump(); }); }
function enqueueLocal(run) { const p = localChain.then(run); localChain = p.catch(() => {}); return p; }

async function callTts(job, cfg) {
  const r = await fetch(`${cfg.baseUrl}/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=${FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: job.text, model_id: job.model, voice_settings: SETTINGS }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    let detail = '';
    try { const j = await r.json(); detail = (j.detail && (j.detail.message || j.detail.status || (Array.isArray(j.detail) && j.detail[0] && j.detail[0].msg))) || ''; } catch {}
    throw err(`ElevenLabs ${r.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`, 502);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw err('ElevenLabs returned no audio', 502);
  return buf;
}
function save(hash, buf) {
  fs.mkdirSync(TTS_DIR, { recursive: true });
  const tmp = `${fileOf(hash)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, fileOf(hash));
}

// Make sure the audio for a prepared job exists. Resolves to its hash; cached hits cost nothing.
// The inflight entry is set synchronously, so a URL handed out right after this call waits for the audio.
function ensureJob(job) {
  if (!job.text) return Promise.reject(err('nothing to say', 400));
  if (cached(job.hash)) return Promise.resolve(job.hash);
  if (inflight.has(job.hash)) return inflight.get(job.hash);
  let p;
  if (job.engine === 'local') {
    p = enqueueLocal(async () => {
      if (cached(job.hash)) return job.hash;
      save(job.hash, await callLocal(job));
      return job.hash;
    });
  } else {
    const why = blocked();
    if (why) return Promise.reject(err(REASONS[why], 503, { reason: why }));
    p = enqueue(async () => {
      if (cached(job.hash)) return job.hash;
      const c = config();
      const again = blocked(c);       // the cap may have been reached while this waited
      if (again) throw err(REASONS[again], 503, { reason: again });
      const buf = await callTts(job, c);
      save(job.hash, buf);
      record(job.text.length, job.model, job.purpose);
      lastError = null;
      return job.hash;
    });
  }
  p = p.catch((e) => {
    if (e.status !== 503) { lastError = { at: new Date().toISOString(), message: e.message }; console.error('[voice]', e.message); }
    throw e;
  }).finally(() => inflight.delete(job.hash));
  inflight.set(job.hash, p);
  return p;
}
// Audio for a text with the engine the purpose calls for. → { hash, engine }
async function ensure(text, purpose, override, opts = {}) {
  const cfg = config();
  const pick = pickEngine(cfg, purpose, override);
  if (!pick.engine) throw err(REASONS[pick.why] || REASONS.nolocal, 503, { reason: pick.why });
  try {
    return { hash: await ensureJob(prepare(text, purpose, cfg, pick.engine, pick.engine === 'local' ? opts : {})), engine: pick.engine };
  } catch (e) {
    // The local voice failed: nothing paid instead, the browser speaks.
    if (pick.engine === 'local' && e.status !== 400) throw err(e.message, 503, { reason: e.reason || 'localfail' });
    throw e;
  }
}

// All of a board's narration, in step order, in the background, with the free local voice only:
// paid audio is made on Play (the step played + the next). Never throws.
function pregenerate(board) {
  try {
    if (!board || !Array.isArray(board.steps)) return false;
    const cfg = config();
    const pick = pickEngine(cfg, 'board');
    if (pick.engine !== 'local' || pick.want !== 'local') return false;
    for (const s of board.steps) if (s && s.say) ensureJob(prepare(s.say, 'board', cfg, 'local')).catch(() => {});
    return true;
  } catch (e) { console.error('[voice] pregenerate', e.message); return false; }
}

// ---------- ElevenLabs account info (cached) ----------

async function upstream(p, cfg, opts = {}) {
  const r = await fetch(`${cfg.baseUrl}${p}`, {
    method: opts.method || 'GET',
    headers: { 'xi-api-key': opts.key || cfg.apiKey, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    let detail = null;
    try { detail = (await r.json()).detail; } catch {}
    const msg = detail && typeof detail === 'object' ? detail.message : typeof detail === 'string' ? detail : null;
    throw err(msg ? `ElevenLabs: ${msg}` : `ElevenLabs ${r.status}`, r.status === 401 || r.status === 402 ? r.status : 502, { code: detail && detail.code });
  }
  return r.json();
}

// ---------- settings popup ----------

// Voices the free plan can't use through the API: voice-library voices, even after "Add to my voices".
const PAID_ONLY = new Set(['professional', 'shared', 'famous', 'high_quality']);
const keyHint = (k) => (k ? `${k.slice(0, 3)}…${k.slice(-4)}` : null);
function settingsGuard(req) {
  if (req.headers['x-quiz-settings'] !== '1') throw err('missing settings header', 403);
}
function saveCfg(patch) {
  dirs();
  const f = readJson(CFG_FILE) || {};
  for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === null || v === '') delete f[k]; else f[k] = v; }
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
  writeJson(CFG_FILE, f, 0o600);   // it holds the key
  fs.chmodSync(CFG_FILE, 0o600);
}
const libVoice = (v) => ({
  id: v.voice_id, name: v.name, ownerId: v.public_owner_id || null, library: true,
  note: [v.gender, v.age && v.age.replace(/_/g, ' '), v.accent, v.use_case && v.use_case.replace(/_/g, ' ')].filter(Boolean).join(' · '),
  description: (v.description || '').slice(0, 160), preview_url: v.preview_url || null,
});
async function presetsWithPreviews(cfg) {
  const own = cfg.apiKey ? await voices(cfg).catch(() => []) : [];
  return Promise.all(PRESETS.map(async (p) => {
    let url = previewCache.get(p.id) || (own.find((v) => v.id === p.id) || {}).preview_url || null;
    if (!url && cfg.apiKey && p.library) {
      try { const j = await upstream(`/v1/shared-voices?search=${p.id}&page_size=1`, cfg); url = (j.voices || [])[0]?.preview_url || null; } catch {}
    }
    if (url) previewCache.set(p.id, url);
    return { ...p, preview_url: url };
  }));
}
async function localView(cfg) {
  const state = await localState();
  return {
    installed: state !== 'missing', state, error: state === 'error' ? local.error : null,
    voice: cfg.localVoice, voices: LOCAL_VOICES, installCmd: INSTALL_CMD, home: LOCAL_HOME.replace(os.homedir(), '~'), ...localInfo(),
  };
}
async function settingsView() {
  const cfg = config();
  const m = month();
  const out = {
    engine: cfg.engine, elevenModel: cfg.model, liveEngine: cfg.liveEngine, local: await localView(cfg),
    prices: { eleven_flash_v2_5: price('eleven_flash_v2_5'), eleven_v3: price('eleven_v3') },
    hasKey: !!cfg.apiKey, keyHint: keyHint(cfg.apiKey), plan: null,
    month: { chars: m.chars, estUsd: m.estUsd, calls: m.calls }, cap: cfg.monthlyCapUsd,
    voice: { id: cfg.voiceId, name: (readJson(CFG_FILE) || {}).voiceName || null }, lastError,
  };
  if (cfg.apiKey) {
    try { out.plan = await subscription(cfg); } catch (e) { out.planError = e.message; }
    const own = await voices(cfg).catch(() => []);
    const cur = own.find((v) => v.id === cfg.voiceId);
    if (cur) out.voice.name = cur.name;
  }
  if (!out.voice.name) out.voice.name = (PRESETS.find((p) => p.id === cfg.voiceId) || {}).name || null;
  out.presets = await presetsWithPreviews(cfg);
  return out;
}
async function library(q, page) {
  const cfg = config();
  if (!cfg.apiKey) throw err('Add an ElevenLabs API key first', 400);
  const query = String(q || '').trim().slice(0, 80);
  const own = page ? [] : (await voices(cfg).catch(() => []))
    .filter((v) => !query || `${v.name} ${Object.values(v.labels || {}).join(' ')} ${v.description || ''}`.toLowerCase().includes(query.toLowerCase()))
    .map((v) => ({ id: v.id, name: v.name, library: PAID_ONLY.has(v.category), note: [v.labels.gender, v.labels.age, v.labels.accent, v.category === 'premade' ? 'default voice' : 'your voice'].filter(Boolean).join(' · '), description: (v.description || '').slice(0, 160), preview_url: v.preview_url }))
    .slice(0, 12);
  const qs = new URLSearchParams({ page_size: '20', page: String(page || 0), language: 'en' });
  if (query) qs.set('search', query);
  const j = await upstream(`/v1/shared-voices?${qs}`, cfg);
  const shared = (j.voices || []).filter((v) => v.voice_id && !own.some((o) => o.id === v.voice_id)).map(libVoice);
  return { voices: [...own, ...shared], hasMore: !!j.has_more };
}
const keyOf = (cfg) => crypto.createHash('sha256').update(cfg.apiKey + cfg.baseUrl).digest('hex');   // caches follow the account
async function subscription(cfg) {
  const key = keyOf(cfg);
  if (subCache.data && subCache.key === key && Date.now() - subCache.at < 5 * 60000) return subCache.data;
  const j = await upstream('/v1/user/subscription', cfg);
  subCache = { at: Date.now(), key, data: { used: j.character_count, limit: j.character_limit, tier: j.tier || null, resetsAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null } };
  return subCache.data;
}
async function voices(cfg) {
  const key = keyOf(cfg);
  if (voicesCache.data && voicesCache.key === key && Date.now() - voicesCache.at < 10 * 60000) return voicesCache.data;
  const j = await upstream('/v2/voices?page_size=100&include_total_count=false', cfg);
  const list = (j.voices || []).map((v) => ({
    id: v.voice_id, name: v.name, category: v.category || null, labels: v.labels || {},
    description: v.description || null, preview_url: v.preview_url || null,
  })).filter((v) => v.id && v.name);
  voicesCache = { at: Date.now(), key, data: list };
  return list;
}

async function status() {
  const cfg = config();
  const m = month();
  const why = blocked(cfg);
  const pick = pickEngine(cfg, 'board');
  const lv = LOCAL_VOICES.find((v) => v.id === cfg.localVoice);
  const out = {
    engine: pick.engine, want: pick.want, fallback: pick.engine !== pick.want ? (REASONS[pick.why] || null) : null,
    local: { installed: localInstalled(), state: await localState(), voice: { id: cfg.localVoice, name: lv ? lv.name : cfg.localVoice }, voices: LOCAL_VOICES, installCmd: INSTALL_CMD, ...localInfo() },
    price: price(cfg.model),
    configured: !!cfg.apiKey, usable: !why, reason: why, message: why ? REASONS[why] : null,
    voice: { id: cfg.voiceId, name: null }, model: cfg.model,
    month: { key: m.key, chars: m.chars, estUsd: m.estUsd, calls: m.calls, cap: cfg.monthlyCapUsd },
    lastError,
  };
  const alert = capAlert(cfg, m);
  if (alert) out.capAlert = alert;
  if (cfg.apiKey) {
    await Promise.all([
      subscription(cfg).then((s) => { out.subscription = s; }).catch(() => {}),
      voices(cfg).then((l) => { const v = l.find((x) => x.id === cfg.voiceId); if (v) out.voice.name = v.name; }).catch(() => {}),
    ]);
  }
  return out;
}

// ---------- http ----------

function sendAudio(req, res, file) {
  const size = fs.statSync(file).size;
  const head = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function handle(req, res, url, c) {
  if (!ctx) init(c);
  const p = url.pathname;
  if (!p.startsWith('/api/voice/')) return false;
  const send = ctx.send;
  try {
    const audio = p.match(/^\/api\/voice\/audio\/([a-f0-9]{64})\.mp3$/);
    if (audio && (req.method === 'GET' || req.method === 'HEAD')) {
      const hash = audio[1];
      if (!cached(hash) && inflight.has(hash)) {
        try { await inflight.get(hash); } catch (e) { return send(res, e.status === 503 ? 503 : 502, { error: e.message, reason: e.reason || null, fallback: true }), true; }
      }
      if (!cached(hash)) return send(res, 404, { error: 'no such audio' }), true;
      sendAudio(req, res, fileOf(hash));
      return true;
    }
    if (req.method === 'GET' && (p === '/api/voice/status' || p === '/api/voice/usage')) return send(res, 200, await status()), true;
    if (req.method === 'GET' && p === '/api/voice/settings') return send(res, 200, await settingsView()), true;
    if (req.method === 'GET' && p === '/api/voice/library') return send(res, 200, await library(url.searchParams.get('q'), Number(url.searchParams.get('page')) || 0)), true;
    if (req.method === 'GET' && p === '/api/voice/voices') {
      const cfg = config();
      if (!cfg.apiKey) return send(res, 200, { voices: [], current: cfg.voiceId, reason: 'unconfigured' }), true;
      return send(res, 200, { voices: await voices(cfg), current: cfg.voiceId }), true;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    const body = await ctx.readBody(req).catch(() => { throw err('invalid JSON body', 400); }) || {};

    if (p === '/api/voice/tts') {
      const purpose = ['board', 'live', 'interview'].includes(body.purpose) ? body.purpose : 'read';
      const text = String(body.text || '');
      if (!text.trim()) throw err('nothing to say', 400);
      // live: local only (never paid) unless config liveEngine is 'elevenlabs'; no per-request override.
      // interview: local unless he chose ElevenLabs for this interview.
      const override = purpose === 'live' ? null : purpose === 'interview' ? (body.engine === 'elevenlabs' ? 'elevenlabs' : 'local') : body.engine;
      const voice = purpose === 'interview' && LOCAL_IDS.test(String(body.voice || '')) ? body.voice : undefined;
      const r = await ensure(text, purpose, override, voice ? { voice } : {});
      return send(res, 200, withAlert({ url: urlOf(r.hash), engine: r.engine })), true;
    }
    if (p === '/api/voice/preview') {
      const voice = String(body.voice || '');
      if (!LOCAL_IDS.test(voice)) throw err('invalid voice', 400);
      const cfg = config();
      if (!localInstalled()) throw err(REASONS.nolocal, 503, { reason: 'nolocal' });
      const hash = await ensureJob(prepare(PREVIEW_TEXT, 'preview', cfg, 'local', { voice }))
        .catch((e) => { throw e.status === 400 ? e : err(e.message, 503, { reason: 'localfail' }); });
      return send(res, 200, { url: urlOf(hash) }), true;
    }
    if (p === '/api/voice/local-voice') {
      const voice = String(body.voice || '');
      if (!LOCAL_IDS.test(voice)) throw err('invalid voice', 400);
      saveCfg({ localVoice: voice });
      return send(res, 200, { ok: true, voice }), true;
    }
    if (p === '/api/voice/engine') {
      settingsGuard(req);
      const patch = {};
      if (body.engine !== undefined) {
        if (!['local', 'elevenlabs'].includes(body.engine)) throw err('engine must be local or elevenlabs', 400);
        patch.engine = body.engine;
      }
      if (body.elevenModel !== undefined) {
        if (!ELEVEN_MODELS.includes(body.elevenModel)) throw err(`elevenModel must be one of ${ELEVEN_MODELS.join(', ')}`, 400);
        patch.elevenModel = body.elevenModel;
      }
      saveCfg(patch);
      if (patch.engine === 'local' && localInstalled()) startLocal().catch(() => {});   // warm it while he reads
      return send(res, 200, await settingsView()), true;
    }
    if (p === '/api/voice/local/start') {
      if (!localInstalled()) throw err(REASONS.nolocal, 503, { reason: 'nolocal' });
      startLocal().catch(() => {});
      return send(res, 200, { ok: true, state: await localState() }), true;
    }
    if (p === '/api/voice/board') {
      const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 20).map((s) => String((s && s.say) || s || ''));
      const cfg = config();
      const pick = pickEngine(cfg, 'board', body.engine);
      if (!pick.engine) return send(res, 200, withAlert({ voice: false, reason: pick.why, message: REASONS[pick.why] || null })), true;
      const jobs = steps.map((s) => prepare(s, 'board', cfg, pick.engine));
      const paid = pick.engine === 'elevenlabs';
      // Which steps to make now: local → all of them (free); ElevenLabs → only those asked for (the step
      // about to play and the next), never the whole board; generate: false → none (a free lookup).
      let want = [];
      if (body.generate !== false) {
        want = !paid ? jobs.map((_, i) => i)
          : (Array.isArray(body.only) ? body.only : [0, 1]).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < jobs.length).slice(0, 3);
      }
      for (const i of want) if (jobs[i].text) ensureJob(jobs[i]).catch(() => {});
      const urls = jobs.map((j) => (j.text && (cached(j.hash) || inflight.has(j.hash)) ? urlOf(j.hash) : null));
      const paidChars = paid ? jobs.reduce((n, j) => n + (j.text && !cached(j.hash) && !inflight.has(j.hash) ? j.text.length : 0), 0) : 0;
      return send(res, 200, withAlert({
        voice: true, engine: pick.engine, model: paid ? cfg.model : 'kokoro', urls,
        paidChars, estUsd: usd((paidChars / 1000) * price(cfg.model)),
        fallback: pick.engine !== pick.want ? (REASONS[pick.why] || null) : null,
      })), true;
    }
    if (p === '/api/voice/config') {
      let id = String(body.voiceId || '').trim();
      if (!/^[A-Za-z0-9]{8,40}$/.test(id)) throw err('invalid voice id', 400);
      const name = String(body.name || '').trim().slice(0, 80) || null;
      const ownerId = String(body.ownerId || '').trim();
      const cfg = config();
      // A shared-library voice: the free plan can't use those through the API; on a paid plan it's added
      // to the account first (ignored when it's already there).
      if (ownerId && !/^[a-f0-9]{20,80}$/.test(ownerId)) throw err('invalid owner id', 400);
      const own = cfg.apiKey ? await voices(cfg).catch(() => []) : [];
      const mine = own.find((v) => v.id === id);
      if (cfg.apiKey && (ownerId || (mine && PAID_ONLY.has(mine.category)))) {
        const plan = await subscription(cfg).catch(() => null);
        if (plan && plan.tier === 'free') throw err('Free ElevenLabs plans can\'t use voice-library voices through the API. Upgrade to a paid plan (or add $5 of credits) to use this voice; George and the other default voices work on the free plan.', 402, { code: 'paid_plan_required' });
        if (!mine) {
          try {
            const j = await upstream(`/v1/voices/add/${ownerId}/${id}`, cfg, { method: 'POST', body: { new_name: name || id } });
            if (j && j.voice_id) id = j.voice_id;
          } catch (e) { if (e.status === 402) throw e; /* already added or not needed: try the id as is */ }
          voicesCache = { at: 0, key: '', data: null };
        }
      }
      saveCfg({ voiceId: id, voiceName: name });
      return send(res, 200, { ok: true, voiceId: id }), true;
    }
    if (p === '/api/voice/key/reveal') {
      settingsGuard(req);
      return send(res, 200, { apiKey: config().apiKey || '' }), true;
    }
    if (p === '/api/voice/key') {
      settingsGuard(req);
      const k = String(body.apiKey || '').trim();
      if (k && !/^[A-Za-z0-9_-]{20,120}$/.test(k)) throw err('That doesn\'t look like an ElevenLabs API key', 400);
      if (k) {
        // Check it before saving: a wrong key would silently turn every board back to the browser voice.
        try { await upstream('/v1/user/subscription', config(), { key: k }); }
        catch (e) { throw err(e.status === 401 ? 'ElevenLabs rejected this key (check it, and that it has "User: read" permission)' : e.message, 400); }
      }
      saveCfg({ apiKey: k || null });
      subCache = { at: 0, key: '', data: null }; voicesCache = { at: 0, key: '', data: null }; lastError = null;
      return send(res, 200, await settingsView()), true;
    }
    if (p === '/api/voice/cap') {
      settingsGuard(req);
      const cap = Number(body.monthlyCapUsd);
      if (!Number.isFinite(cap) || cap < 0 || cap > 1000) throw err('cap must be 0–1000 dollars', 400);
      saveCfg({ monthlyCapUsd: Math.round(cap * 100) / 100 });
      return send(res, 200, { ok: true, cap }), true;
    }
    throw err('not found', 404);
  } catch (e) {
    send(res, e.status || 500, { error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.reason ? { reason: e.reason, fallback: true } : {}) });
    return true;
  }
}

module.exports = { init, handle, pregenerate, status, capAlert, PRICE_PER_1K, kokoroText, pickEngine };
