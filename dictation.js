// Local voice dictation: the browser records audio, we turn it into text with whisper.cpp on this machine.
// Nothing leaves the machine. Endpoints:
//   GET  /api/dictate/status        → { available, model, bin, models: [installed files], using: <file>, language: 'en'|'he'|'auto',
//                                       want: {model, language} (the prefs), fallback: <why not what was asked> | null,
//                                       install: { dir, url, file?, download?, command?, sizes, platform, machine, whisper?, ffmpeg? } }
//   POST /api/dictate?hint=...      raw audio body (webm/opus from Chrome, mp4/aac from Safari) → { text }
// Paths: QUIZ_WHISPER_BIN (default: whisper-cli in Homebrew / /usr/local/bin / ~/whisper.cpp/build/bin / PATH),
//        QUIZ_WHISPER_MODEL (default: picked from ~/.cache/quiz-whisper by prefs mic.model + mic.language,
//        falling back to the best installed model; see chooseModel()).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_BYTES = 25 * 1024 * 1024;   // ~25 minutes of opus; far more than one answer needs
const TIMEOUT_MS = 90 * 1000;          // per ffmpeg/whisper step
const MODEL_DIR = path.join(os.homedir(), '.cache', 'quiz-whisper');
const IS_MAC = process.platform === 'darwin';
// Homebrew on the Mac; on Linux a self-built whisper.cpp (deploy kit builds it with CUDA) or a distro package.
// A systemd service has a minimal PATH, so the usual spots are listed explicitly.
const SEARCH_DIRS = [
  ...(IS_MAC ? ['/opt/homebrew/bin'] : []),
  '/usr/local/bin', '/usr/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), 'whisper.cpp', 'build', 'bin'),
  ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
];
// How to get the whisper-cli binary / ffmpeg on this OS (shown in the status, never run by the app).
const BIN_HINT = IS_MAC
  ? { whisper: 'brew install whisper-cpp', ffmpeg: 'brew install ffmpeg' }
  : { whisper: 'build whisper.cpp with CUDA: git clone https://github.com/ggml-org/whisper.cpp ~/whisper.cpp && cd ~/whisper.cpp && cmake -B build -DGGML_CUDA=1 && cmake --build build -j --config Release (or the deploy kit\'s script)', ffmpeg: 'sudo apt install ffmpeg' };

// First executable called `name` in the usual places.
function findBin(name) {
  if (name.includes('/')) return isExec(name) ? name : null;
  for (const dir of SEARCH_DIRS) {
    const p = path.join(dir, name);
    if (isExec(p)) return p;
  }
  return null;
}
function isExec(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}
// ---------- which model (prefs mic.model + mic.language) ----------
// English-only models (ggml-<size>.en.bin) are a bit better and faster for English; Hebrew or auto-detect
// needs a multilingual one (ggml-<size>.bin, large = ggml-large-v3*.bin). Models are never downloaded here:
// they are hundreds of MB, so the status says which file is missing and where to get it.
const SIZES = ['tiny', 'base', 'small', 'medium', 'large'];
const HF_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const MODEL_RE = /^ggml-(tiny|base|small|medium|large(?:-v\d)?(?:-turbo)?)(\.en)?(?:-(q\d_\d|q\d_k))?\.bin$/;

function readPrefs() {
  try { const p = require('./prefs'); return { size: p.get('mic.model') || 'auto', lang: p.get('mic.language') || 'en' }; }
  catch { return { size: 'auto', lang: 'en' }; }
}

// Installed models in ~/.cache/quiz-whisper, parsed: { file, size: 'small'|'large'…, variant: 'large-v3-turbo', en, quant }.
function installedModels() {
  let files = [];
  try { files = fs.readdirSync(MODEL_DIR); } catch {}
  return files.map((file) => {
    const m = file.match(MODEL_RE);
    if (!m) return null;
    try { if (fs.statSync(path.join(MODEL_DIR, file)).size < 1e6) return null; } catch { return null; }   // a broken / partial download
    return { file, size: m[1].startsWith('large') ? 'large' : m[1], variant: m[1], en: !!m[2], quant: m[3] || null };
  }).filter(Boolean);
}

// The file name we'd want for this size + language (what to download when it's missing).
const wantedFile = (size, lang) => (size === 'large' ? 'ggml-large-v3-turbo.bin' : `ggml-${size}${lang === 'en' ? '.en' : ''}.bin`);

// Ranks installed models for a language. Higher = better. For English, small is the sweet spot
// (fast, accurate); for Hebrew / auto-detect, bigger models are much better.
function rank(m, lang, size) {
  const si = SIZES.indexOf(m.size);
  let r = 0;
  if (lang === 'en') r += m.en ? 3 : 0;                    // either works for English; .en is a bit better
  else if (m.en) r -= 100;                                 // an English-only model can't do Hebrew / detect
  if (size !== 'auto') r += m.size === size ? 50 : -Math.abs(si - SIZES.indexOf(size)) * 5;   // nearest size
  else r += lang === 'en' ? [0, 6, 10, 8, 7][si] : si * 5;
  if (m.size === 'large') r += /v3/.test(m.variant) ? 2 : 0;
  if (m.quant) r -= 1;
  return r;
}

// → { file, path, lang (what we pass to -l), fallback (why it isn't what was asked for, or null), wanted }
function chooseModel() {
  const { size, lang } = readPrefs();
  if (process.env.QUIZ_WHISPER_MODEL) {
    const p = process.env.QUIZ_WHISPER_MODEL;
    const en = /\.en[.-]/.test(path.basename(p));
    return fs.existsSync(p)
      ? { file: path.basename(p), path: p, lang: en ? 'en' : lang, fallback: en && lang !== 'en' ? `QUIZ_WHISPER_MODEL is English-only, so it transcribes English` : null, wanted: null }
      : { file: null, path: null, lang, fallback: `QUIZ_WHISPER_MODEL not found: ${p}`, wanted: null };
  }
  const models = installedModels();
  const wanted = size === 'auto' ? (lang === 'en' ? 'ggml-small.en.bin' : 'ggml-large-v3-turbo.bin') : wantedFile(size, lang);
  if (!models.length) return { file: null, path: null, lang, fallback: 'no Whisper model installed', wanted };
  const best = models.slice().sort((a, b) => rank(b, lang, size) - rank(a, lang, size))[0];
  const useLang = best.en ? 'en' : lang;
  const label = (m) => m.file.replace(/^ggml-|\.bin$/g, '');
  const LANG = { en: 'English', he: 'Hebrew', auto: 'auto-detect' };
  let fallback = null;
  if (best.en && lang !== 'en') {
    fallback = `${lang === 'auto' ? 'Auto-detect' : LANG[lang]} needs a multilingual model and none is installed: using ${label(best)} (English only). Download ${wanted}.`;
  } else if (size !== 'auto' && best.size !== size) {
    fallback = `The ${size} model for ${LANG[lang]} isn't installed: using ${label(best)}. Download ${wanted}.`;
  }
  return { file: best.file, path: path.join(MODEL_DIR, best.file), lang: useLang, fallback, wanted };
}

// The setup check is a few stat() calls, but the page asks on every load: cache it for a minute
// (or until the mic prefs change).
let cached = null, cachedAt = 0, cachedKey = '';
function status() {
  const { size, lang } = readPrefs();
  const key = `${size}|${lang}`;
  if (cached && cachedKey === key && Date.now() - cachedAt < 60_000) return cached;
  const bin = findBin(process.env.QUIZ_WHISPER_BIN || 'whisper-cli');
  const ffmpeg = findBin('ffmpeg');
  const pick = chooseModel();
  cached = {
    available: !!(bin && ffmpeg && pick.path), model: pick.file, modelPath: pick.path, lang: pick.lang, bin, ffmpeg,
    models: installedModels().map((m) => m.file), fallback: pick.fallback, wanted: pick.wanted, want: { model: size, language: lang },
  };
  cachedAt = Date.now(); cachedKey = key;
  return cached;
}
// Shown in the status so the learner (or Claude) knows how to get a missing model. Never run by the app.
function installHint(file, bins) {   // bins: { bin, ffmpeg } from status(); the missing ones get a hint
  return {
    dir: MODEL_DIR,
    url: HF_URL + '<file>',   // e.g. ggml-medium.bin, ggml-small.en.bin, ggml-large-v3-turbo.bin
    ...(file ? { file, download: HF_URL + file, command: `curl -L --create-dirs -o ${path.join(MODEL_DIR, file)} ${HF_URL}${file}` } : {}),
    sizes: 'base ≈ 150 MB, small ≈ 470 MB, medium ≈ 1.5 GB, large-v3-turbo ≈ 1.6 GB',
    platform: process.platform, machine: IS_MAC ? 'this Mac' : 'the server',   // for UI wording ("Whisper on this Mac")
    ...(bins && !bins.bin ? { whisper: BIN_HINT.whisper } : {}),
    ...(bins && !bins.ffmpeg ? { ffmpeg: BIN_HINT.ffmpeg } : {}),
  };
}

// Runs a program (args as an array, never through a shell: the hint is user text). Resolves stdout.
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${path.basename(cmd)} timed out`)); }, TIMEOUT_MS);
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(cmd)} failed (${code}): ${err.trim().split('\n').slice(-2).join(' ')}`));
    });
  });
}

// Whisper's markers for silence/noise ("[BLANK_AUDIO]", "(music)", "[ Silence ]"...) aren't words the learner said.
function clean(text) {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:music|applause|laughter|silence|noise|inaudible|static|background noise|upbeat music|wind blowing|keyboard clicking|typing|clicking|beep|coughs?|sighs?)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// On silence Whisper tends to "hear" a stock phrase. If that's all it heard, there was nothing.
const HALLUCINATIONS = /^(you|thank you|thanks|thank you for watching|thanks for watching|bye|\.+)[.!]?$/i;
const cleanAll = (text) => { const t = clean(text); return HALLUCINATIONS.test(t) ? '' : t; };

// One transcription at a time: whisper already uses every core, two at once just thrash.
let queue = Promise.resolve();
function serialized(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function transcribe(audioFile, hint) {
  const st = status();
  const wav = audioFile + '.wav';
  // Whisper wants 16 kHz mono 16-bit PCM.
  try {
    await run(st.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', audioFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  } catch (e) {
    console.error('[dictation]', e.message);
    throw new Error("couldn't read the recording (unsupported or broken audio)");
  }
  const args = ['-m', st.modelPath, '-f', wav, '-l', st.lang || 'en', '-nt', '-np',
    '-t', String(Math.max(1, Math.min(8, os.cpus().length - 2)))];
  // The prompt is vocabulary context (topic + key terms), so "SIGKILL" isn't heard as "sick kill".
  if (hint) args.push('--prompt', hint);
  return cleanAll(await run(st.bin, args));
}

// Streams the raw request body to a file, refusing anything over MAX_BYTES.
function saveBody(req, file) {
  return new Promise((resolve, reject) => {
    let size = 0, failed = false;
    const out = fs.createWriteStream(file, { mode: 0o600 });
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES && !failed) { failed = true; out.destroy(); req.destroy(); reject(new Error('recording too large')); return; }
      if (!failed) out.write(c);
    });
    req.on('end', () => { if (!failed) out.end(() => resolve(size)); });
    req.on('error', (e) => { if (!failed) { failed = true; out.destroy(); reject(e); } });
  });
}

const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

module.exports = {
  status,
  transcribe,
  async handle(req, res, url, ctx) {
    if (req.method === 'GET' && url.pathname === '/api/dictate/status') {
      const s = status();
      const missing = s.fallback && s.wanted && !s.models.includes(s.wanted) ? s.wanted : null;
      ctx.send(res, 200, {
        available: s.available, model: s.model, bin: s.bin,
        models: s.models, using: s.model, language: s.lang, want: s.want, fallback: s.fallback || null,
        install: installHint(missing, s),
      });
      return true;
    }
    if (req.method !== 'POST' || url.pathname !== '/api/dictate') return false;
    if (!status().available) { ctx.send(res, 503, { error: `Local Whisper is not installed (${IS_MAC ? 'brew install whisper-cpp' : 'whisper.cpp built in ~/whisper.cpp, or QUIZ_WHISPER_BIN'} + model in ~/.cache/quiz-whisper)` }); return true; }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BYTES) { ctx.send(res, 413, { error: 'recording too large' }); return true; }
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const hint = (url.searchParams.get('hint') || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-dictate-'));   // private (0700) per request
    const file = path.join(dir, `audio.${EXT[type] || 'bin'}`);
    const started = Date.now();
    try {
      const bytes = await saveBody(req, file);
      if (bytes < 100) { ctx.send(res, 400, { error: 'empty recording' }); return true; }
      const text = await serialized(() => transcribe(file, hint));
      ctx.send(res, 200, { text, ms: Date.now() - started });
    } catch (e) {
      if (!res.headersSent) ctx.send(res, e.message === 'recording too large' ? 413 : 500, { error: e.message });
    } finally {
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
    return true;
  },
};
