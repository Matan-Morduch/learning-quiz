'use strict';
// ⚙️ App preferences: one small JSON file (data/prefs.json, gitignored) that every part of the app reads.
// The Settings popup (ui/settings.js) edits it; ui/prefs.js mirrors it in the browser (Quiz.prefs).
// Voice engine, voice and the ElevenLabs key stay in data/voice.json (voice.js): they predate this file.
//
// Server modules: const prefs = require('./prefs'); prefs.get('teacher.model') or prefs.all().
//                 prefs.onChange((all, changedKeys) => …) to react (e.g. a new model for new processes).
// Endpoints:
//   GET  /api/prefs                → { prefs, defaults, schema }
//   POST /api/prefs {patch}        → { prefs }   patch is { "teacher.model": "sonnet", … } (dotted keys)
//   POST /api/prefs/reset {keys?}  → { prefs }   back to defaults (all, or just these keys)
// Writes need the `x-quiz-settings: 1` header (like voice settings): another site's page can't send it
// without a CORS preflight, which we never answer.
const fs = require('fs');
const path = require('path');

function defaultEngine() {
  const env = process.env.QUIZ_AI_ENGINE;
  if (['claude', 'gemini-cli', 'gemini-api'].includes(env)) return env;
  try { const c = require('./config'); return c.findBin(c.CLAUDE_BIN) ? 'claude' : 'gemini-cli'; } catch { return 'claude'; }
}

// Every preference: its default and what it may be. enum → one of the list; num → [min, max]; bool.
const SCHEMA = {
  // AI engine (llm.js): one for the whole app, optionally another per area ('default' = the app's engine).
  // Default: Claude, or Gemini on a computer without Claude Code (QUIZ_AI_ENGINE overrides).
  'ai.engine':            { enum: ['claude', 'gemini-cli', 'gemini-api'], def: defaultEngine() },
  'ai.teach':             { enum: ['default', 'claude', 'gemini-cli', 'gemini-api'], def: 'default' },
  'ai.interview':         { enum: ['default', 'claude', 'gemini-cli', 'gemini-api'], def: 'default' },
  'ai.grader':            { enum: ['default', 'claude', 'gemini-cli', 'gemini-api'], def: 'default' },

  // Teacher (Teach lessons, teach.js) and grader (ai-grader.js). Model tiers: on Claude opus/sonnet/haiku,
  // on Gemini the same choice means Pro/Flash/Flash-Lite (llm.js).
  'teacher.model':        { enum: ['opus', 'sonnet', 'haiku'], def: 'opus' },
  'teacher.mode':         { enum: ['fast', 'classic'], def: 'fast' },          // teach.js: AI-era fast teacher or the original
  'teacher.graderModel':  { enum: ['opus', 'sonnet', 'haiku'], def: 'opus' },
  'teacher.style':        { enum: ['mixed', 'socratic', 'direct'], def: 'mixed' },
  'teacher.length':       { enum: ['short', 'normal', 'deep'], def: 'normal' },
  'teacher.boards':       { enum: ['off', 'auto', 'always'], def: 'off' },     // composer board toggle default / teacher may offer
  'teacher.cards':        { enum: ['few', 'normal', 'many'], def: 'normal' },

  // Voice (playback side; engine + voice live in data/voice.json)
  'voice.speed':          { num: [0.7, 1.6], def: 1 },
  'voice.autoRead':       { bool: true, def: false },
  'voice.captions':       { bool: true, def: true },
  'voice.capAlertPct':    { enum: [0, 50, 80, 90], def: 80 },                 // 0 = no alert

  // Boards
  'boards.renderer':      { enum: ['auto', 'canvas', 'svg'], def: 'auto' },   // auto = canvas above 600 px wide
  'boards.autoplay':      { bool: true, def: true },                          // live: draw + talk at once; off: wait for Play
  'boards.pace':          { enum: ['voice', 'fast', 'instant'], def: 'voice' },
  'boards.font':          { enum: ['hand', 'clean'], def: 'hand' },

  // Mic and dictation (dictation.js, ui/think.js)
  'mic.model':            { enum: ['auto', 'base', 'small', 'medium', 'large'], def: 'auto' },
  'mic.language':         { enum: ['en', 'he', 'auto'], def: 'en' },
  'mic.pushToTalk':       { enum: ['none', 'alt', 'backquote'], def: 'none' },
  'mic.autoSendSec':      { enum: [0, 2, 3, 5], def: 0 },                     // 0 = off

  // Quiz and review
  'quiz.reviewSize':      { enum: [0, 10, 20, 30, 50], def: 0 },              // 0 = no limit
  'quiz.maxNew':          { enum: [-1, 0, 3, 5, 10], def: -1 },               // per review session; -1 = no limit
  'quiz.strictness':      { enum: ['lenient', 'normal', 'strict'], def: 'normal' },
  'quiz.hints':           { bool: true, def: true },
  'quiz.timer':           { bool: true, def: true },
  'quiz.dailyGoal':       { enum: [0, 10, 20, 30, 50], def: 0 },              // questions a day; 0 = off

  // Look (applied by ui/prefs.js before first paint)
  'look.theme':           { enum: ['system', 'light', 'dark'], def: 'system' },
  'look.accent':          { enum: ['blue', 'purple', 'pink', 'red', 'orange', 'green', 'teal', 'graphite'], def: 'blue' },
  'look.textSize':        { enum: ['small', 'default', 'large', 'xlarge'], def: 'default' },
  'look.density':         { enum: ['comfortable', 'compact'], def: 'comfortable' },
  'look.motion':          { enum: ['system', 'full', 'reduced'], def: 'system' },
  'look.sidebar':         { enum: ['remember', 'open', 'closed'], def: 'remember' },

  // Keyboard (index.html): rating keys and reveal. Single characters / named keys.
  'keys.again':           { key: true, def: '1' },
  'keys.hard':            { key: true, def: '2' },
  'keys.good':            { key: true, def: '3' },
  'keys.easy':            { key: true, def: '4' },
};
const DEFAULTS = Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.def]));
const KEY_RE = /^(?:[a-z0-9`\-=[\];',./]|Space|Enter|Arrow(?:Up|Down|Left|Right))$/i;

let FILE = null;
let cache = null;
const listeners = [];

function file() {
  if (!FILE) FILE = path.join(__dirname, 'data', 'prefs.json');
  return FILE;
}

function valid(key, v) {
  const s = SCHEMA[key];
  if (!s) return false;
  if (s.enum) return s.enum.includes(v);
  if (s.num) return typeof v === 'number' && Number.isFinite(v) && v >= s.num[0] && v <= s.num[1];
  if (s.bool) return typeof v === 'boolean';
  if (s.key) return typeof v === 'string' && KEY_RE.test(v);
  return false;
}

function load() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch {}
  cache = { ...DEFAULTS };
  for (const [k, v] of Object.entries(saved)) if (valid(k, v)) cache[k] = v;   // unknown / bad values fall back
  return cache;
}

function save(next) {
  // Only what differs from the defaults is stored, so new defaults reach old installs.
  const diff = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== DEFAULTS[k]));
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(diff, null, 2) + '\n');
  fs.renameSync(tmp, file());
  cache = next;
}

const all = () => ({ ...load() });
const get = (key) => load()[key];
function onChange(fn) { listeners.push(fn); }

function set(patch) {
  const cur = load();
  const next = { ...cur };
  const bad = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!valid(k, v)) { bad.push(k); continue; }
    next[k] = v;
  }
  if (bad.length) { const e = new Error(`invalid setting: ${bad.join(', ')}`); e.status = 400; throw e; }
  const changed = Object.keys(next).filter((k) => next[k] !== cur[k]);
  if (!changed.length) return next;
  save(next);
  for (const fn of listeners) { try { fn({ ...next }, changed); } catch (e) { console.error('[prefs listener]', e); } }
  return next;
}

function reset(keys) {
  const ks = Array.isArray(keys) && keys.length ? keys.filter((k) => k in DEFAULTS) : Object.keys(DEFAULTS);
  return set(Object.fromEntries(ks.map((k) => [k, DEFAULTS[k]])));
}

function schemaView() {
  return Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.enum ? { enum: s.enum } : s.num ? { num: s.num } : s.bool ? { bool: true } : { key: true }]));
}

async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (p !== '/api/prefs' && p !== '/api/prefs/reset') return false;
  if (req.method === 'GET' && p === '/api/prefs') return ctx.send(res, 200, { prefs: all(), defaults: DEFAULTS, schema: schemaView() }), true;
  if (req.method !== 'POST') return ctx.send(res, 405, { error: 'method not allowed' }), true;
  if (req.headers['x-quiz-settings'] !== '1') return ctx.send(res, 403, { error: 'missing settings header' }), true;
  let body;
  try { body = (await ctx.readBody(req)) || {}; } catch { return ctx.send(res, 400, { error: 'invalid JSON body' }), true; }
  try {
    const next = p === '/api/prefs/reset' ? reset(body.keys) : set(body.patch);
    return ctx.send(res, 200, { prefs: next }), true;
  } catch (e) {
    return ctx.send(res, e.status || 500, { error: e.message }), true;
  }
}

module.exports = { handle, get, all, set, reset, onChange, DEFAULTS, SCHEMA };
