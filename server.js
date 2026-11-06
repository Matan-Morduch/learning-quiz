#!/usr/bin/env node
// Quiz server for the Obsidian "Learning" folder. Zero dependencies.
// Questions: Learning/<Subject>/Questions/<Topic>.md
// Data:      data/ next to this file (progress.json, history.jsonl, …; see README → Data)
// Run:       node server.js   →   http://localhost:4747   (on homebox: the learning-quiz systemd service)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4747;
const ai = require('./ai-grader');
const gaps = require('./gaps');
const blocks = require('./blocks');
const prefs = require('./prefs');
const store = require('./store');
const { LEARNING_DIR, HOST, posixRel } = require('./config');   // QUIZ_LEARNING_DIR (else the folder above _quiz), QUIZ_HOST
const DATA_DIR = path.join(__dirname, 'data');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const TESTS_FILE = path.join(DATA_DIR, 'tests.jsonl');
const DASHBOARD_FILE = path.join(LEARNING_DIR, 'Quiz Progress.md');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Leitner boxes: how long to wait before a question counts as "due" again.
const INTERVALS = [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY];
const MAX_BOX = INTERVALS.length - 1;
const RATINGS = { again: 0, hard: 1, good: 2, easy: 3 };
// Multiple choice is recognition, not recall: a right pick can lift a question to this box at most.
// Going higher (and counting as mastered, box 4+) takes written answers.
const MCQ_MAX_BOX = 2;
// Test score weights: a written answer counts double a multiple-choice pick.
const TEST_WEIGHT = { write: 2, mcq: 1 };

fs.mkdirSync(DATA_DIR, { recursive: true });

// Feature modules (one file each, e.g. mcq.js). Each exports { handle(req, res, url, ctx) → true if it
// answered the request }, and optionally init(ctx). A module file that doesn't exist yet is skipped.
const MODULE_NAMES = ['prefs', 'llm', 'data', 'dictation', 'mcq', 'offline', 'topicmap', 'lab', 'teach', 'tolearn', 'practice', 'learner', 'voice', 'interview', 'materials'];
const modules = MODULE_NAMES.map((name) => {
  try { return require(`./${name}`); } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && e.message.includes(`'./${name}'`)) return null;
    console.error(`[quiz] module ${name} failed to load:`, e);
    return null;
  }
}).filter(Boolean);

// ---------- question parsing ----------

// Fingerprint of index.html and ui/*.js|css, computed once (a deploy restarts the server).
let APP_VERSION = null;
function appVersion() {
  if (APP_VERSION) return APP_VERSION;
  const h = require('crypto').createHash('sha1');
  try {
    h.update(fs.readFileSync(path.join(__dirname, 'index.html')));
    for (const f of fs.readdirSync(path.join(__dirname, 'ui')).filter((n) => /\.(js|css)$/.test(n)).sort()) h.update(f).update(fs.readFileSync(path.join(__dirname, 'ui', f)));
  } catch {}
  return (APP_VERSION = h.digest('hex').slice(0, 12));
}

function findQuestionFiles() {
  const files = [];
  for (const subject of (fs.existsSync(LEARNING_DIR) ? fs.readdirSync(LEARNING_DIR, { withFileTypes: true }) : [])) {
    if (!subject.isDirectory() || subject.name.startsWith('_') || subject.name.startsWith('.')) continue;
    const qDir = path.join(LEARNING_DIR, subject.name, 'Questions');
    if (!fs.existsSync(qDir)) continue;
    for (const f of fs.readdirSync(qDir)) {
      if (f.endsWith('.md')) files.push({ subject: subject.name, file: path.join(qDir, f) });
    }
  }
  return files;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function parseFile({ subject, file }) {
  const topic = path.basename(file, '.md');
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const questions = [];
  for (const raw of body.split(/^## /m).slice(1)) {
    const chunk = raw.split(/^# /m)[0];   // a "# Section" heading (e.g. "# Building blocks") ends the question above it
    const lines = chunk.split('\n');
    const question = lines[0].trim();
    const idMatch = chunk.match(/%%\s*id:\s*([\w-]+)\s*%%/);
    const parentMatch = chunk.match(/%%\s*parent:\s*([\w-]+)\s*%%/);   // a building block of another question
    const id = idMatch ? idMatch[1] : `${slug(topic)}--${slug(question)}`;

    const detail = [];
    const answer = [];
    let inAnswer = false;
    let inChoices = false;   // optional hand-written "> [!choices]-" block (read by mcq.js), never shown as detail
    for (const line of lines.slice(1)) {
      if (/^>\s*\[!answer\]/i.test(line)) { inAnswer = true; inChoices = false; continue; }
      if (/^>\s*\[!choices\]/i.test(line)) { inChoices = true; continue; }
      if (inChoices) { if (line.startsWith('>')) continue; inChoices = false; }
      if (inAnswer) {
        if (!line.startsWith('>')) break;
        answer.push(line.replace(/^> ?/, ''));
      } else if (!/%%.*%%/.test(line)) {
        detail.push(line);
      }
    }
    questions.push({
      id, subject, topic, question,
      detail: detail.join('\n').trim(),
      answer: answer.join('\n').trim(),
      file: posixRel(LEARNING_DIR, file),
      ...(parentMatch ? { parent: parentMatch[1] } : {}),
    });
  }
  return questions;
}

// Rewrites the "> [!answer]-" block of one question in its vault file; everything else stays as is.
function setReferenceAnswer(id, answer) {
  answer = answer.replace(/\r\n/g, '\n').trim();
  if (!answer) throw new Error('empty answer');
  const q = loadQuestions().find((x) => x.id === id);
  if (!q) throw new Error('question not found');
  const file = path.resolve(LEARNING_DIR, q.file);
  if (!/^[^/]+\/Questions\/[^/]+\.md$/.test(posixRel(LEARNING_DIR, file))) throw new Error('unexpected question file');
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const idLine = lines.findIndex((l) => new RegExp(`%%\\s*id:\\s*${id.replace(/[-]/g, '\\-')}\\s*%%`).test(l));
  if (idLine < 0) throw new Error('question has no id line');
  let start = idLine;
  while (start < lines.length && !/^>\s*\[!answer\]/i.test(lines[start])) {
    if (start > idLine && /^#{1,2} /.test(lines[start])) throw new Error('answer block not found');
    start++;
  }
  if (start >= lines.length) throw new Error('answer block not found');
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith('>')) end++;
  // Keep the answer's interactive views (```dataviewjs blocks): Claude only ever saw the text.
  const oldBody = lines.slice(start + 1, end).map((l) => l.replace(/^> ?/, '')).join('\n');
  const views = (oldBody.match(/```dataviewjs[\s\S]*?```/g) || []).filter((v) => !answer.includes(v));
  if (views.length) answer += '\n\n' + views.join('\n\n');
  const block = answer.split('\n').map((l) => (l.trim() ? `> ${l}` : '>'));
  lines.splice(start + 1, end - start - 1, ...block);
  store.writeText(file, lines.join('\n'));
}

function loadQuestions() {
  return findQuestionFiles().flatMap(parseFile);
}

// ---------- progress / history ----------

function loadProgress() {
  return store.readJson(PROGRESS_FILE, {});
}

function saveProgress(progress) {
  store.writeJson(PROGRESS_FILE, progress);
}

function loadHistory() {
  return store.readJsonl(HISTORY_FILE);
}

function isDue(st, now) {
  return !st || st.lastSeen + INTERVALS[st.box] <= now;
}

// Higher weight = more likely to be asked. Weak (low box) questions dominate,
// new ones show up regularly, and mastered ones that aren't due yet are rare.
function weight(st, now) {
  if (!st) return 10;
  let w = Math.pow(3, MAX_BOX - st.box); // box0=243, box1=81, box2=27 ... box5=1
  if (!isDue(st, now)) w *= 0.05;
  return w;
}

// noNew: the review run already showed its quota of never-seen questions (pref quiz.maxNew), so skip them.
function pickNext(questions, progress, { mode, exclude, noNew = false }) {
  const now = Date.now();
  if (noNew) questions = questions.filter((q) => progress[q.id]);
  let pool = questions.filter((q) => !exclude.has(q.id));
  if (pool.length === 0) pool = questions;
  if (mode === 'new') pool = pool.filter((q) => !progress[q.id]);
  if (mode === 'weak') pool = pool.filter((q) => progress[q.id] && progress[q.id].box <= 1);
  if (mode === 'due') pool = pool.filter((q) => isDue(progress[q.id], now));
  if (pool.length === 0) return null;

  // "What confused me" gaps: study-these questions up, the question that exposed the gap down.
  const focus = gaps.focusMap();
  const base = pool.map((q) => weight(progress[q.id], now));
  const avg = base.reduce((a, b) => a + b, 0) / base.length;
  const weights = pool.map((q, i) => gaps.applyFocus(base[i], focus[q.id], avg));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Extra answer data from feature modules: thinking out loud, confidence, multiple-choice pick, hints...
const EXTRA_KEYS = ['format', 'thinking', 'thinkingWhileReading', 'confidence', 'choice', 'correct', 'hints', 'missClass', 'outcome', 'dictated', 'offline'];
function cleanExtra(extra) {
  if (!extra || typeof extra !== 'object') return null;
  const out = {};
  for (const k of EXTRA_KEYS) if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') out[k] = extra[k];
  return Object.keys(out).length ? out : null;
}

// `at`: when the answer was given (ms), for answers synced later from the phone's offline practice.
function recordAnswer({ id, answer, rating, question, topic, subject, aiScore, extra, at }) {
  const now = Date.now();
  const when = Number.isFinite(at) ? Math.min(now, Math.max(now - 90 * DAY, at)) : now;
  const progress = loadProgress();
  const st = progress[id] || { box: 0, attempts: 0, correct: 0, lastSeen: 0, lastRating: null };
  const r = RATINGS[rating];
  const mcq = extra && extra.format === 'mcq';
  if (rating === 'again') st.box = 0;
  else if (mcq) { if (r >= RATINGS.good) st.box = Math.max(st.box, Math.min(MCQ_MAX_BOX, st.box + 1)); }
  else if (rating === 'good') st.box = Math.min(MAX_BOX, st.box + 1);
  else if (rating === 'easy') st.box = Math.min(MAX_BOX, st.box + 2);
  // 'hard' keeps the current box; a right pick never lowers a box earned by writing
  st.attempts += 1;
  if (r >= RATINGS.good) st.correct += 1;
  st.lastSeen = Math.max(st.lastSeen || 0, when);
  st.lastRating = rating;
  progress[id] = st;
  saveProgress(progress);

  const entry = { ts: new Date(when).toISOString(), id, subject, topic, question, answer, rating };
  if (typeof aiScore === 'number') entry.aiScore = aiScore;
  const ex = cleanExtra(extra);
  if (ex) entry.extra = ex;
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  gaps.onAnswer({ id, rating, aiScore });
  for (const m of modules) if (m.onAnswer) { try { m.onAnswer(entry, ctx); } catch (e) { console.error(e); } }
  writeDashboard();
  return st;
}

// ---------- stats + Obsidian dashboard ----------

function computeStats() {
  const questions = loadQuestions();
  const progress = loadProgress();
  const now = Date.now();
  const topics = {};
  for (const q of questions) {
    const key = `${q.subject} / ${q.topic}`;
    const t = (topics[key] ||= { subject: q.subject, topic: q.topic, total: 0, seen: 0, mastered: 0, weak: 0, due: 0, review: 0, reviewWeak: 0, boxSum: 0 });
    const st = progress[q.id];
    t.total += 1;
    if (st) {
      t.seen += 1;
      t.boxSum += st.box;
      if (st.box >= 4) t.mastered += 1;
      if (st.box <= 1) t.weak += 1;
    }
    if (isDue(st, now)) t.due += 1;
    // review: seen and due again (what Home's quick review asks); due also counts never-seen ones
    if (st && isDue(st, now)) { t.review += 1; if (st.box <= 1) t.reviewWeak += 1; }
  }
  for (const t of Object.values(topics)) t.mastery = Math.round((t.boxSum / (t.total * MAX_BOX)) * 100);

  const weakest = questions
    .filter((q) => progress[q.id])
    .map((q) => ({ ...q, st: progress[q.id] }))
    .sort((a, b) => a.st.box - b.st.box || (a.st.correct / a.st.attempts) - (b.st.correct / b.st.attempts))
    .slice(0, 10)
    .map(({ id, topic, question, st }) => ({ id, topic, question, box: st.box, attempts: st.attempts, correct: st.correct }));

  return { topics: Object.values(topics), weakest, totalAnswers: loadHistory().length };
}

// ---------- daily goal ----------

// The learner's time zone. The server may run in another zone (homebox is on UTC), so the browser sends
// its own (?tz= on api/streak) and the last one seen is remembered for the Quiz Progress note.
const CLIENT_FILE = path.join(DATA_DIR, 'client.json');
function validTz(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}
let learnerTz = validTz(store.readJson(CLIENT_FILE, {}).tz) || validTz(process.env.QUIZ_TZ) || undefined;
function rememberTz(tz) {
  tz = validTz(tz);
  if (!tz || tz === learnerTz) return;
  learnerTz = tz;
  try { store.writeJson(CLIENT_FILE, { tz }); } catch (e) { console.error(e); }
}
const localTime = (d) => d.toLocaleString('en-GB', { timeZone: learnerTz, dateStyle: 'medium', timeStyle: 'short' });

// Calendar day "YYYY-MM-DD" of a moment, in the learner's time zone.
function dayKey(d, tz = learnerTz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// The day before a "YYYY-MM-DD" key (plain calendar arithmetic, so DST changes don't matter).
function prevDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// Answers today and the streak of days that met the goal (pref quiz.dailyGoal; 0 = off).
// The streak counts back from today if today's goal is met, else from yesterday (today isn't over yet).
function computeStreak(history, goal, now = new Date(), tz = learnerTz) {
  const perDay = {};
  for (const h of history) {
    const t = new Date(h.ts);
    if (!isNaN(t)) { const k = dayKey(t, tz); perDay[k] = (perDay[k] || 0) + 1; }
  }
  const todayKey = dayKey(now, tz);
  const today = perDay[todayKey] || 0;
  let streak = 0;
  if (goal > 0) {
    let k = today < goal ? prevDay(todayKey) : todayKey;
    while ((perDay[k] || 0) >= goal) { streak++; k = prevDay(k); }
  }
  return { goal, today, met: goal > 0 && today >= goal, streak, date: todayKey };
}

// ---------- tests ----------

// Self-ratings → points. "Hard" = you partly knew it.
const POINTS = { again: 0, hard: 0.5, good: 1, easy: 1 };

function letterGrade(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}

function loadTests() {
  return store.readJsonl(TESTS_FILE);
}

// Tests are graded by the AI answer score (0–100 → 0–1 point; multiple choice is 100 or 0 from the pick).
// If an item has no score (grading failed or AI unavailable), its self-rating points are used instead.
// Each item is weighted by TEST_WEIGHT: a written answer is worth 2 points, a multiple-choice pick 1.
function recordTest({ subject, durationMs, items }) {
  const weight = (it) => (it.format === 'mcq' ? TEST_WEIGHT.mcq : TEST_WEIGHT.write);
  const itemPoints = (it) => weight(it) * (typeof it.aiScore === 'number' ? it.aiScore / 100 : POINTS[it.rating] ?? 0);
  const points = Math.round(items.reduce((sum, it) => sum + itemPoints(it), 0) * 100) / 100;
  const maxPoints = items.reduce((sum, it) => sum + weight(it), 0);
  const aiCount = items.filter((it) => typeof it.aiScore === 'number').length;
  const pct = maxPoints ? Math.round((points / maxPoints) * 100) : 0;
  const previous = loadTests().filter((t) => t.subject === subject);
  const test = {
    ts: new Date().toISOString(),
    subject,
    count: items.length,
    points,
    maxPoints,
    pct,
    grade: letterGrade(pct),
    durationMs,
    gradedBy: aiCount === items.length ? 'ai' : aiCount === 0 ? 'self' : 'mixed',
    items: items.map(({ id, question, topic, rating, ms, aiScore, format }) => ({ id, question, topic, rating, ms, aiScore, format: format === 'mcq' ? 'mcq' : 'write' })),
  };
  fs.appendFileSync(TESTS_FILE, JSON.stringify(test) + '\n');
  writeDashboard();
  const best = previous.reduce((b, t) => (!b || t.pct > b.pct ? t : b), null);
  return { test, previousBest: best, previousCount: previous.length };
}

function writeDashboard() {
  const s = computeStats();
  const lines = [
    '# Quiz Progress',
    '',
    `_Auto-generated by the quiz app. Last update: ${localTime(new Date())}. Total answers: ${s.totalAnswers}_`,
    '',
    '## Topics',
    '',
    '| Topic | Mastery | Seen | Mastered | Weak | Due |',
    '|---|---|---|---|---|---|',
    ...s.topics.map((t) => `| [[${t.topic}]] | ${t.mastery}% | ${t.seen}/${t.total} | ${t.mastered} | ${t.weak} | ${t.due} |`),
    '',
    ...gaps.dashboardLines(),
    '## Weakest questions',
    '',
    ...s.weakest.map((w) => `- **${w.question}** (${w.topic}): box ${w.box}/${MAX_BOX}, ${w.correct}/${w.attempts} correct`),
    '',
    '## Recent tests',
    '',
    '| Date | Subject | Questions | Score | Grade | Time |',
    '|---|---|---|---|---|---|',
    ...loadTests().slice(-10).reverse().map((t) =>
      `| ${localTime(new Date(t.ts))} | ${t.subject} | ${t.count} | ${t.pct}% | ${t.grade} | ${formatDuration(t.durationMs)} |`),
    '',
  ];
  store.writeText(DASHBOARD_FILE, lines.join('\n'));
}

// ---------- http ----------

function formatDuration(ms) {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// A JSON request body. Bodies over MAX_BODY (a drawing PNG is ~0.3 MB) are refused instead of being
// buffered without limit; a dropped connection rejects instead of leaving the request hanging.
const MAX_BODY = 20 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('request body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
  });
}

// The run's Claude session, or a fresh one if it's gone (server restarted, 30 idle minutes,
// or the claude process died). The reply carries the session id so the page switches to it.
function aiSessionFor(body) {
  try { return ai.getSession(body.session); } catch {
    if (!ai.isAvailable()) throw new Error(ai.unavailableReason());
    return ai.openSession({ kind: body.kind || "smart", subject: body.subject || "mixed" });
  }
}

// Handles one request. `pathname` is relative to where the app is mounted,
// so LifeOS can serve the same app under /quiz/ (see LifeOS/server.js).
async function handle(req, res, pathname) {
  let url;
  try {
    // A fixed base and collapsed leading slashes: a request for "//x" or a bad Host header must not crash the server.
    url = new URL(String(req.url || '/').replace(/^\/+/, '/'), 'http://localhost');
  } catch { return send(res, 400, { error: 'bad url' }); }
  url.pathname = pathname || url.pathname;
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Cache-Control', 'no-cache');
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace('__APP_VERSION__', appVersion()), 'text/html; charset=utf-8');
    }
    // version: a fingerprint of the page code, so an open app can tell a deploy happened and reload.
    // Liveness for the service / monitoring: no Claude call (the CLI check runs once and is cached).
    if (req.method === 'GET' && url.pathname === '/api/health') {
      let questions = null;
      try { questions = loadQuestions().length; } catch {}
      return send(res, 200, { ok: questions !== null, questions, uptime: Math.round(process.uptime()), claude: ai.isAvailable(), learningDir: LEARNING_DIR, version: appVersion() });
    }
    // The service worker lives at the app's root so it can cover the whole app (scope = where it's served).
    if (req.method === 'GET' && url.pathname === '/sw.js') {
      res.setHeader('Cache-Control', 'no-cache');
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'ui', 'sw.js'), 'utf8'), 'text/javascript; charset=utf-8');
    }
    // Front-end feature modules: /ui/<name>.js and /ui/<name>.css
    const uiMatch = url.pathname.match(/^\/ui\/([\w-]+)\.(js|css)$/);
    if (req.method === 'GET' && uiMatch) {
      const file = path.join(__dirname, 'ui', `${uiMatch[1]}.${uiMatch[2]}`);
      if (!fs.existsSync(file)) return send(res, 404, '/* not built yet */', 'text/plain');
      return send(res, 200, fs.readFileSync(file, 'utf8'), uiMatch[2] === 'js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
    }
    // Other static front-end files (vendored libraries, fonts, prototype pages): /ui/<dir>/<file>.<ext>
    const UI_TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
      json: 'application/json; charset=utf-8', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png' };
    const uiFile = url.pathname.match(/^\/ui\/((?:[\w.-]+\/)*[\w.-]+)\.(\w+)$/);
    if (req.method === 'GET' && uiFile && UI_TYPES[uiFile[2]] && !uiFile[1].split('/').some((p) => p.startsWith('.'))) {
      const file = path.join(__dirname, 'ui', `${uiFile[1]}.${uiFile[2]}`);
      if (!file.startsWith(path.join(__dirname, 'ui') + path.sep) || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      res.setHeader('Cache-Control', uiFile[1].startsWith('vendor/') ? 'public, max-age=86400' : 'no-cache');
      return send(res, 200, fs.readFileSync(file), UI_TYPES[uiFile[2]]);
    }
    for (const m of modules) {
      if (m.handle && (await m.handle(req, res, url, ctx))) return;
    }
    // Interactive answer visuals, shared with Obsidian's dv.view(): /views/<name>.js
    const viewMatch = url.pathname.match(/^\/views\/([\w-]+)\.js$/);
    if (req.method === 'GET' && viewMatch) {
      const file = path.join(__dirname, 'views', `${viewMatch[1]}.js`);
      if (!fs.existsSync(file)) return send(res, 404, { error: 'view not found' });
      return send(res, 200, fs.readFileSync(file, 'utf8'), 'text/javascript; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/streak') {
      rememberTz(url.searchParams.get('tz'));
      return send(res, 200, computeStreak(loadHistory(), prefs.get('quiz.dailyGoal')));
    }
    if (req.method === 'GET' && url.pathname === '/api/topics') {
      return send(res, 200, computeStats());
    }
    if (req.method === 'GET' && url.pathname === '/api/next') {
      const topics = (url.searchParams.get('topics') || '').split('|').filter(Boolean);
      const exclude = new Set((url.searchParams.get('exclude') || '').split(',').filter(Boolean));
      const mode = url.searchParams.get('mode') || 'smart';
      const noNew = url.searchParams.get('noNew') === '1';
      let questions = loadQuestions();
      if (topics.length) questions = questions.filter((q) => topics.includes(`${q.subject} / ${q.topic}`));
      const q = pickNext(questions, loadProgress(), { mode, exclude, noNew });
      if (!q) return send(res, 200, { done: true });
      const past = loadHistory().filter((h) => h.id === q.id).slice(-5).reverse();
      return send(res, 200, { question: q, stats: loadProgress()[q.id] || null, past, focus: gaps.focusMap()[q.id]?.reason || null });
    }
    // All questions of one subject (for tests and free practice), with stats and past answers.
    if (req.method === 'GET' && url.pathname === '/api/questions') {
      // ?ids=a,b,c → exactly those questions, in that order (a set picked by another app, e.g. Goal to NVIDIA)
      const subject = url.searchParams.get('subject');
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      const progress = loadProgress();
      const history = loadHistory();
      const focus = gaps.focusMap();
      let picked = loadQuestions().filter((q) => !subject || q.subject === subject);
      if (ids.length) {
        const byId = new Map(picked.map((q) => [q.id, q]));
        picked = ids.map((id) => byId.get(id)).filter(Boolean);
      }
      const questions = picked
        .map((q) => ({
          question: q,
          stats: progress[q.id] || null,
          past: history.filter((h) => h.id === q.id).slice(-5).reverse(),
          focus: focus[q.id]?.reason || null,   // 'gap' | 'parked' | 'retry' (see gaps.js)
        }));
      return send(res, 200, { questions });
    }
    // ---- "What confused me" gaps ----
    if (req.method === 'GET' && url.pathname === '/api/gaps') {
      return send(res, 200, gaps.listForClient());
    }
    if (req.method === 'POST' && url.pathname === '/api/gaps') {
      const body = await readBody(req);
      const all = loadQuestions();
      const q = all.find((x) => x.id === body.id);
      if (!q || !String(body.text || '').trim()) return send(res, 400, { error: 'question id and text required' });
      const chat = body.chat && typeof body.chat.reply === 'string' ? { reply: body.chat.reply } : null;
      const gap = gaps.addGap({ question: q, text: body.text, rating: body.rating, answer: body.answer, chat }, all);
      writeDashboard();
      return send(res, 200, { gap });
    }
    const gapAction = url.pathname.match(/^\/api\/gaps\/([\w-]+)\/(resolve|reopen|delete|reanalyze)$/);
    if (req.method === 'POST' && gapAction) {
      const [, gid, action] = gapAction;
      if (action === 'resolve') gaps.resolve(gid, 'manual');
      if (action === 'reopen') gaps.reopen(gid);
      if (action === 'delete') gaps.remove(gid);
      if (action === 'reanalyze') gaps.analyze(gid, loadQuestions()).catch(() => {});
      writeDashboard();
      return send(res, 200, gaps.listForClient());
    }
    if (req.method === 'GET' && url.pathname === '/api/tests') {
      const subject = url.searchParams.get('subject');
      const tests = loadTests().filter((t) => !subject || t.subject === subject);
      return send(res, 200, { tests: tests.slice(-10).reverse() });
    }
    if (req.method === 'POST' && url.pathname === '/api/test') {
      const body = await readBody(req);
      if (!body.subject || !Array.isArray(body.items) || body.items.length === 0) {
        return send(res, 400, { error: 'subject and non-empty items required' });
      }
      return send(res, 200, recordTest(body));
    }
    // ---- AI grading (Claude Code CLI, one session per quiz run) ----
    if (req.method === 'GET' && url.pathname === '/api/ai/status') {
      const llm = require('./llm'), e = llm.engineFor('grader');
      return send(res, 200, { available: ai.isAvailable(), why: llm.whyUnavailable('grader'), name: llm.isGemini(e) ? 'Gemini' : 'Claude', engine: e, model: llm.modelLabel(e, llm.defaultTier('grader')) });
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/session') {
      if (!ai.isAvailable()) return send(res, 503, { error: ai.unavailableReason() });
      const body = await readBody(req);
      return send(res, 200, { session: ai.openSession({ kind: body.kind || 'smart', subject: body.subject || 'mixed' }).id });
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/grade') {
      const body = await readBody(req);
      const all = loadQuestions();
      const found = all.find((x) => x.id === body.id);
      if (!found) return send(res, 404, { error: 'question not found' });
      const q = { ...found, blocks: all.filter((x) => x.parent === found.id).map((x) => x.question) };
      try {
        const s = aiSessionFor(body);
        const fb = await s.grade(q, body.answer || '', loadHistory(), cleanExtra(body.extra));
        // A weak answer: save the grader's smaller questions in the vault (see blocks.js).
        let added = [];
        if (fb.score < 70 && fb.buildingBlocks) {
          try { added = blocks.add(found, fb.buildingBlocks, all); if (added.length) writeDashboard(); }
          catch (e) { console.error('building blocks:', e.message); }
        }
        return send(res, 200, { ...fb, blocks: added, session: s.id });
      } catch (e) { return send(res, 502, { error: e.message }); }
    }
    // Grading lessons from upheld appeals (ai-grader.js): listed and removable in the app.
    if (req.method === 'GET' && url.pathname === '/api/grader/lessons') return send(res, 200, { lessons: ai.loadLessons() });
    if (req.method === 'POST' && url.pathname === '/api/grader/lessons/remove') {
      const body = await readBody(req);
      ai.removeLesson(String(body.id || ''));
      return send(res, 200, { lessons: ai.loadLessons() });
    }
    // Replace one question's reference answer in the vault (an appeal's suggested fix, approved by the learner).
    if (req.method === 'POST' && url.pathname === '/api/question/answer') {
      const body = await readBody(req);
      try { setReferenceAnswer(String(body.id || ''), String(body.answer || '')); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/blocks/remove') {
      const body = await readBody(req);
      try { blocks.remove(String(body.id || ''), loadQuestions()); writeDashboard(); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
      const body = await readBody(req);
      const q = loadQuestions().find((x) => x.id === body.id);
      if (!q || !String(body.message || '').trim()) return send(res, 400, { error: 'question id and message required' });
      try {
        const s = aiSessionFor(body);
        const grade = body.grade && typeof body.grade === 'object' ? body.grade : null;
        const { text, regrade } = await s.chat(q, body.message, body.answer, grade);
        return send(res, 200, { text, regrade, session: s.id });
      } catch (e) { return send(res, 502, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/close') {
      const body = await readBody(req);
      ai.closeSession(body.session);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/answer') {
      const body = await readBody(req);
      if (!body.id || !(body.rating in RATINGS)) return send(res, 400, { error: 'id and valid rating required' });
      return send(res, 200, { stats: recordAnswer(body) });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
}

gaps.hooks.onChange = () => { try { writeDashboard(); } catch (e) { console.error(e); } };

// Everything a feature module may use. Modules must not reach into server internals beyond this.
const ctx = {
  LEARNING_DIR, DATA_DIR, send, readBody, loadQuestions, loadProgress, loadHistory, computeStats,
  recordAnswer, writeDashboard, isDue, ai, gaps, INTERVALS, MAX_BOX, RATINGS,
};
for (const m of modules) if (m.init) { try { m.init(ctx); } catch (e) { console.error(e); } }

// Gaps whose analysis was cut off by a server restart: run it again.
setTimeout(() => {
  const pending = gaps.load().filter((g) => g.status === 'open' && g.analysis?.state === 'pending');
  if (pending.length) { const all = loadQuestions(); pending.forEach((g) => gaps.analyze(g.id, all).catch(() => {})); }
}, 1000).unref();

module.exports = { handle, computeStats, loadQuestions, loadProgress, isDue, computeStreak, pickNext };

if (require.main === module) {
  // QUIZ_HOST: 127.0.0.1 by default (Tailscale serve / LifeOS proxy in front); 0.0.0.0 exposes it to the LAN.
  const server = http.createServer((req, res) => handle(req, res));
  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`Port ${PORT} is already in use: the app is probably running already (open http://localhost:${PORT}).`);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    const n = loadQuestions().length;
    console.log(`Quiz running at http://${HOST}:${PORT}  (${n} questions loaded from ${LEARNING_DIR})`);
    // QUIZ_OPEN_BROWSER=1 (the Windows start file): open the app once it's listening.
    if (process.env.QUIZ_OPEN_BROWSER === '1') {
      const url = `http://localhost:${PORT}/`;
      const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
      try { require('child_process').spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch {}
    }
  });
}
