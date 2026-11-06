'use strict';
// 📴 Offline practice: multiple choice with no AI, which also works with no connection at all.
//
// The phone downloads a "pack": every question that has multiple-choice options (hand-written in the
// vault, or written by Claude earlier and cached in data/mcq-cache.json), each with the misconception
// behind every wrong option, the explanation of the right one, and the reference answer. Plus the
// current Leitner boxes, so the phone can pick due and weak questions first. The page (ui/offline.js)
// keeps the pack and the answers in the phone's own storage; the service worker (ui/sw.js) keeps the
// app itself, so it opens without reaching this server.
//
// Answers made offline are sent back later (POST /api/offline/sync) and go through recordAnswer like
// any other answer, with the time they were given. Each carries a uid, so a retried sync never counts
// an answer twice.
//
// Preparing the pack: only some questions have options yet. POST /api/offline/prepare has Claude
// write them for all the others, in the background, 2 at a time and always behind a quiz that needs
// options right now (mcq.js). It survives a server restart (data/offline.json) and skips what's ready.
//
//   GET  /api/offline/pack                 → { version, total, questions: [...], progress: { id: { box, lastSeen } } }
//   POST /api/offline/sync {answers: [...]} → { synced: [uid], progress }
//   GET  /api/offline/prepare              → { running, total, ready, todo, done, failed, missing }
//   POST /api/offline/prepare {action: 'start' | 'stop'}

const fs = require('fs');
const path = require('path');
const store = require('./store');

let ctx = null;
let mcq = null;
let STATE_FILE = null;    // { preparing: bool }
let SYNCED_FILE = null;   // uids of answers already recorded (the newest 5000)

const KEEP_UIDS = 5000;
const MAX_BATCH = 500;
const RATING_BY_RESULT = { correct: 'good', wrong: 'again', idk: 'again' };

// ---------- the pack ----------

function stripVisuals(md) {
  return ctx.ai.stripVisuals ? ctx.ai.stripVisuals(md || '') : String(md || '');
}

// Options for every question that has them, without generating: hand-written ones in the vault first,
// then the cache when the question hasn't changed since (same rule as mcq.optionsFor). Reads the cache
// and each question file once, not once per question.
function allOptions(questions) {
  const cache = store.readJson(path.join(ctx.DATA_DIR, 'mcq-cache.json'), {}) || {};
  const texts = new Map();
  const fileText = (rel) => {
    if (!texts.has(rel)) { try { texts.set(rel, fs.readFileSync(path.join(ctx.LEARNING_DIR, rel), 'utf8')); } catch { texts.set(rel, ''); } }
    return texts.get(rel);
  };
  const out = new Map();
  for (const q of questions) {
    const text = fileText(q.file);
    const authored = /\[!choices\]/i.test(text) ? mcq.parseAuthoredChoices(text, q.id) : null;
    if (authored) { out.set(q.id, { stem: q.question, options: authored.options, explanation: '' }); continue; }
    const c = cache[q.id];
    if (c && c.hash === mcq.contentHash(q) && Array.isArray(c.options)) out.set(q.id, c);
  }
  return out;
}

async function buildPack() {
  const questions = ctx.loadQuestions();
  const progress = ctx.loadProgress();
  const options = allOptions(questions);
  const out = [];
  for (const q of questions) {
    const o = options.get(q.id);
    if (!o) continue;
    out.push({
      id: q.id, subject: q.subject, topic: q.topic,
      question: q.question, stem: o.stem || q.question,
      detail: stripVisuals(q.detail), answer: stripVisuals(q.answer),
      options: o.options.map((x) => ({ text: x.text, correct: !!x.correct, misconception: x.misconception || '' })),
      explanation: o.explanation || '',
      ...(q.parent ? { parent: q.parent } : {}),
    });
  }
  const prog = {};
  for (const q of out) if (progress[q.id]) prog[q.id] = { box: progress[q.id].box, lastSeen: progress[q.id].lastSeen };
  return { version: new Date().toISOString(), total: questions.length, intervals: ctx.INTERVALS, questions: out, progress: prog };
}

// ---------- sync ----------

function loadSynced() {
  const a = store.readJson(SYNCED_FILE, []);
  return Array.isArray(a) ? a : [];
}

function sync(answers) {
  const seenList = loadSynced();
  const seen = new Set(seenList);
  const byId = new Map(ctx.loadQuestions().map((q) => [q.id, q]));
  const synced = [];
  const touched = new Set();
  // Oldest first, so the boxes move in the order the answers were given.
  const list = answers.filter((a) => a && typeof a === 'object').sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  for (const a of list) {
    const uid = String(a.uid || '');
    if (!/^[\w-]{8,64}$/.test(uid)) continue;
    if (seen.has(uid)) { synced.push(uid); continue; }   // already recorded by an earlier, interrupted sync
    const q = byId.get(String(a.id || ''));
    const rating = RATING_BY_RESULT[a.result];
    if (!q || !rating) { synced.push(uid); seen.add(uid); seenList.push(uid); continue; }   // question gone: drop it
    ctx.recordAnswer({
      id: q.id, rating, question: q.question, topic: q.topic, subject: q.subject,
      answer: a.result === 'idk' ? "I don't know" : String(a.choiceText || '').slice(0, 2000),
      at: Number(a.at),
      extra: { format: 'mcq', choice: String(a.choiceText || '').slice(0, 2000) || undefined, correct: a.result === 'correct', offline: true },
    });
    seen.add(uid); seenList.push(uid); synced.push(uid); touched.add(q.id);
  }
  store.writeJson(SYNCED_FILE, seenList.slice(-KEEP_UIDS));
  const progress = ctx.loadProgress();
  const prog = {};
  for (const id of touched) if (progress[id]) prog[id] = { box: progress[id].box, lastSeen: progress[id].lastSeen };
  return { synced, progress: prog };
}

// ---------- preparing options for every question (Claude, in the background) ----------

let job = null;   // { running, stop, total, done, failed: [{id, error}], startedAt }

function readiness() {
  const qs = ctx.loadQuestions();
  const have = allOptions(qs);
  const missing = qs.filter((q) => !have.has(q.id));
  return { total: qs.length, ready: qs.length - missing.length, missing };
}

function prepareStatus() {
  const r = readiness();
  return {
    running: !!(job && job.running),
    total: r.total, ready: r.ready, missing: r.missing.length,
    todo: job ? job.total : 0, done: job ? job.done : 0,
    failed: job ? job.failed.slice(-20) : [],
    claude: ctx.ai.isAvailable(),
  };
}

function setPreparing(on) {
  store.writeJson(STATE_FILE, { ...store.readJson(STATE_FILE, {}), preparing: on });
}

function startPrepare() {
  if (job && job.running) return;
  if (!ctx.ai.isAvailable()) throw Object.assign(new Error(ctx.ai.unavailableReason()), { status: 503 });
  const todo = readiness().missing;
  job = { running: true, stop: false, total: todo.length, done: 0, failed: [], startedAt: Date.now() };
  setPreparing(true);
  const me = job;
  let i = 0;
  // Two workers, each one question at a time (mcq.js runs at most 2 Claude processes in total and lets
  // a quiz on screen go first).
  const worker = async () => {
    while (!me.stop && i < todo.length) {
      const q = todo[i++];
      try { await mcq.optionsFor(q, ctx, { background: true }); }
      catch (e) { me.failed.push({ id: q.id, question: q.question, error: e.message }); }
      me.done++;
    }
  };
  Promise.all([worker(), worker()]).finally(() => {
    me.running = false;
    if (!me.stop) setPreparing(false);   // finished: don't resume after a restart
    console.log(`[offline] prepare ${me.stop ? 'stopped' : 'finished'}: ${me.done - me.failed.length} written, ${me.failed.length} failed`);
  });
}

function stopPrepare() {
  if (job) job.stop = true;
  setPreparing(false);
}

// ---------- http ----------

async function handle(req, res, url, c) {
  ctx = ctx || c;
  const p = url.pathname;
  if (!p.startsWith('/api/offline/')) return false;
  const send = ctx.send;
  try {
    if (req.method === 'GET' && p === '/api/offline/pack') {
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, await buildPack()), true;
    }
    if (req.method === 'POST' && p === '/api/offline/sync') {
      const body = await ctx.readBody(req);
      const answers = Array.isArray(body.answers) ? body.answers.slice(0, MAX_BATCH) : [];
      return send(res, 200, sync(answers)), true;
    }
    if (req.method === 'GET' && p === '/api/offline/prepare') return send(res, 200, prepareStatus()), true;
    if (req.method === 'POST' && p === '/api/offline/prepare') {
      const body = await ctx.readBody(req);
      if (body.action === 'stop') stopPrepare(); else startPrepare();
      return send(res, 200, prepareStatus()), true;
    }
    return send(res, 404, { error: 'not found' }), true;
  } catch (e) {
    if (!e.status) console.error('[offline]', e);
    return send(res, e.status || 500, { error: e.message }), true;
  }
}

function init(c) {
  ctx = c;
  mcq = require('./mcq');
  STATE_FILE = path.join(ctx.DATA_DIR, 'offline.json');
  SYNCED_FILE = path.join(ctx.DATA_DIR, 'offline-synced.json');
  // A server restart cut off preparing: carry on with what's still missing.
  setTimeout(() => {
    if (store.readJson(STATE_FILE, {}).preparing && ctx.ai.isAvailable()) {
      try { startPrepare(); } catch (e) { console.error('[offline] resume:', e.message); }
    }
  }, 5000).unref();
}

module.exports = { init, handle, buildPack, sync };
