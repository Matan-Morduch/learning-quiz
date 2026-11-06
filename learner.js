// Persistent learner model: what the app has learned about how this learner thinks.
// Two parts, saved together in data/learner-model.json:
//  - deterministic, recomputed from history.jsonl + ai-feedback.jsonl: confidence calibration per
//    subject and topic, how often they think out loud, how their misses are distributed (miss classes);
//  - AI notes per topic: recurring misconceptions and reasoning patterns, distilled by Claude from the
//    recent AI feedback + thinking traces. Refreshed lazily in the background (after a few new answers
//    on a topic), one topic at a time, and kept short (≤ 8 dated bullets).
// summaryFor(...) turns it into a few lines for prompts (the grader, teach mode).

const fs = require('fs');
const store = require('./store');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const MODEL_FILE = path.join(DATA_DIR, 'learner-model.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const FEEDBACK_FILE = path.join(DATA_DIR, 'ai-feedback.jsonl');
const REFRESH_AFTER = 5;          // new answers on a topic before its AI notes are refreshed
const DEBOUNCE_MS = 15 * 1000;    // wait for a quiet moment before refreshing
const MAX_NOTES = 8;

const MISS_MEANING = {
  cue: 'nothing came to mind',
  discrimination: 'a similar idea won',
  execution: 'right idea, wrong run',
  careless: 'a slip',
  structural: 'a misconception',
};

let ctx = null;
let model = null;   // in-memory copy of learner-model.json

// ---------- storage ----------

const { readJsonl } = store;
const loadHistory = () => (ctx ? ctx.loadHistory() : readJsonl(HISTORY_FILE));
// A grade replaced after an appeal (row with "supersedes": <old ts>) no longer counts.
const loadFeedback = () => {
  const rows = readJsonl(FEEDBACK_FILE);
  const gone = new Set(rows.map((r) => r.supersedes).filter(Boolean));
  return rows.filter((r) => !gone.has(r.ts));
};

function load() {
  if (model) return model;
  model = store.readJson(MODEL_FILE, null);
  if (!model || typeof model !== 'object') model = { updated: null, subjects: {}, topics: {} };
  model.subjects ||= {}; model.topics ||= {};
  return model;
}
function save() {
  store.writeJson(MODEL_FILE, model);
}

// ---------- deterministic part ----------

const isCorrect = (h) => (typeof h.aiScore === 'number' ? h.aiScore >= 70 : h.rating === 'good' || h.rating === 'easy');

// Calibration flag: average stated confidence vs. how often they were actually right.
function calib(confSum, confN, confRight) {
  if (!confN) return { confN: 0, avgConfidence: null, accuracyWhenRated: null, gap: null, flag: null };
  const avg = Math.round(confSum / confN), acc = Math.round((confRight / confN) * 100), gap = avg - acc;
  const flag = confN < 3 ? 'too-few' : gap >= 20 ? 'over' : gap <= -20 ? 'under' : 'calibrated';
  return { confN, avgConfidence: avg, accuracyWhenRated: acc, gap, flag };
}

// Rebuild the numbers from history + feedback; keep the AI notes and refresh bookkeeping.
function recompute() {
  load();
  const history = loadHistory();
  const feedback = loadFeedback();
  const acc = { topics: {}, subjects: {} };
  const bucket = (map, key, extra) => (map[key] ||= { ...extra, answers: 0, right: 0, confSum: 0, confN: 0, confRight: 0, thinking: 0, missClasses: {}, highConfWrong: 0 });

  for (const h of history) {
    if (!h.subject || !h.topic) continue;
    const ok = isCorrect(h);
    const ex = h.extra || {};
    for (const b of [bucket(acc.topics, `${h.subject} / ${h.topic}`, { subject: h.subject, topic: h.topic }), bucket(acc.subjects, h.subject, {})]) {
      b.answers += 1; if (ok) b.right += 1;
      if (typeof ex.confidence === 'number') {
        b.confSum += ex.confidence; b.confN += 1; if (ok) b.confRight += 1;
        if (!ok && ex.confidence >= 70) b.highConfWrong += 1;
      }
      if (ex.thinking || ex.thinkingWhileReading) b.thinking += 1;
    }
  }
  // Miss classes come from the AI feedback (the grader classifies every miss).
  for (const f of feedback) {
    if (!f.missClass || !f.subject || !f.topic) continue;
    for (const b of [acc.topics[`${f.subject} / ${f.topic}`], acc.subjects[f.subject]]) {
      if (b) b.missClasses[f.missClass] = (b.missClasses[f.missClass] || 0) + 1;
    }
  }
  const shape = (b) => ({
    answers: b.answers, accuracy: b.answers ? Math.round((b.right / b.answers) * 100) : null,
    ...calib(b.confSum, b.confN, b.confRight), highConfidenceWrong: b.highConfWrong,
    thinkingAnswers: b.thinking, missClasses: b.missClasses,
  });
  const subjects = {};
  for (const [k, b] of Object.entries(acc.subjects)) subjects[k] = shape(b);
  const topics = {};
  for (const [k, b] of Object.entries(acc.topics)) {
    const old = model.topics[k] || {};
    topics[k] = {
      subject: b.subject, topic: b.topic, ...shape(b),
      notes: old.notes || [], fixed: old.fixed || [],
      pending: old.pending || 0, refreshedAt: old.refreshedAt || null, refreshError: old.refreshError || null,
      refreshFailedAt: old.refreshError ? old.refreshFailedAt || null : null,
    };
  }
  // Topics with AI notes but no history left (shouldn't happen) are kept as they were.
  for (const [k, t] of Object.entries(model.topics)) if (!topics[k] && t.notes?.length) topics[k] = t;
  model.subjects = subjects;
  model.topics = topics;
  model.updated = new Date().toISOString();
  save();
  return model;
}

// ---------- AI part ----------

const NOTES_PROMPT = `You maintain a short, durable model of ONE learner for a self-study quiz app: how they think about a topic, so future tutoring can adapt.
You receive the current notes for one topic and the learner's recent graded answers (oldest first), with their thinking-out-loud traces, confidence, the grader's misconceptions and miss class.
Write the updated notes:
- "misconception": a specific wrong belief that recurs or was held with high confidence (say what they believe and what is actually true, in one line).
- "pattern": how they reason (e.g. "explains with a concrete example first, then loses the general rule", "guesses numbers instead of deriving them", "strong on what, weak on why").
- At most 8 notes, each one line under 25 words, concrete, written about "the learner".
- Keep notes still supported by the evidence, keeping their "since" date. Add new ones dated with the answer date. DROP notes that the most recent answers show are fixed, and list those in "fixed".
- Don't invent: no evidence, no note. One isolated slip is not a pattern.
Reply with ONLY a JSON object in a \`\`\`json fence: {"notes": [{"kind": "misconception" | "pattern", "text": "...", "since": "YYYY-MM-DD"}], "fixed": ["short text of each dropped note"]}`;

function evidenceFor(key, limit = 12) {
  const [subject, topic] = key.split(' / ');
  const history = loadHistory().filter((h) => h.subject === subject && h.topic === topic);
  const feedback = loadFeedback().filter((f) => f.subject === subject && f.topic === topic);
  // One line per graded answer; history-only answers (no AI) still show the self-rating + thinking.
  const rows = feedback.map((f) => ({ ts: f.ts, q: f.question, answer: f.answer, score: f.score, missClass: f.missClass, mis: (f.misconceptions || []).map((m) => m.what), extra: f.extra }));
  for (const h of history) {
    if (rows.some((r) => r.q === h.question && Math.abs(new Date(r.ts) - new Date(h.ts)) < 30 * 60 * 1000)) {
      const r = rows.find((x) => x.q === h.question && Math.abs(new Date(x.ts) - new Date(h.ts)) < 30 * 60 * 1000);
      r.rating = h.rating; r.extra ||= h.extra;
    } else rows.push({ ts: h.ts, q: h.question, answer: h.answer, rating: h.rating, extra: h.extra });
  }
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return rows.slice(-limit).map((r) => {
    const ex = r.extra || {};
    return [
      `- ${String(r.ts).slice(0, 10)} Q: ${r.q}`,
      `  answer: ${String(r.answer || '(blank)').slice(0, 400)}`,
      ex.thinking ? `  thinking${ex.dictated ? ' (dictated)' : ''}: ${String(ex.thinking).slice(0, 500)}` : '',
      typeof ex.confidence === 'number' ? `  confidence: ${ex.confidence}` : '',
      ex.format === 'mcq' ? `  multiple choice, pick ${ex.correct ? 'right' : 'wrong'}` : '',
      typeof r.score === 'number' ? `  AI score ${r.score}${r.missClass ? `, miss: ${r.missClass}` : ''}` : '',
      r.rating ? `  self-rated: ${r.rating}` : '',
      r.mis?.length ? `  misconceptions: ${r.mis.join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');
}

// Ask Claude to rewrite one topic's notes. Throws on failure (recorded on the topic).
async function refreshTopic(key) {
  load();
  const ai = ctx ? ctx.ai : require('./ai-grader');
  if (!model.topics[key]) recompute();
  const t = model.topics[key];
  if (!t) throw new Error(`no answers yet for topic "${key}"`);
  const evidence = evidenceFor(key);
  const prompt = `<topic>${key}</topic>\n<today>${new Date().toISOString().slice(0, 10)}</today>\n` +
    `<current_notes>\n${t.notes.length ? t.notes.map((n) => `- [${n.kind}, since ${n.since}] ${n.text}`).join('\n') : '(none yet)'}\n</current_notes>\n` +
    `<recent_answers>\n${evidence || '(none)'}\n</recent_answers>\nUpdate the notes. Reply with only the JSON object.`;
  try {
    const reply = await ai.askOnce(prompt, NOTES_PROMPT);
    const out = ai.extractJson(reply);
    const notes = (Array.isArray(out.notes) ? out.notes : [])
      .filter((n) => n && typeof n.text === 'string' && n.text.trim())
      .slice(0, MAX_NOTES)
      .map((n) => ({ kind: n.kind === 'pattern' ? 'pattern' : 'misconception', text: n.text.trim(), since: /^\d{4}-\d{2}-\d{2}$/.test(n.since) ? n.since : new Date().toISOString().slice(0, 10) }));
    const fixed = (Array.isArray(out.fixed) ? out.fixed : []).filter((x) => typeof x === 'string')
      .map((text) => ({ text, on: new Date().toISOString().slice(0, 10) }));
    const cur = load().topics[key];     // re-read: recompute() may have replaced the object meanwhile
    cur.notes = notes;
    cur.fixed = [...fixed, ...(cur.fixed || [])].slice(0, 10);
    cur.pending = 0;
    cur.refreshedAt = new Date().toISOString();
    cur.refreshError = null;
    save();
    return cur;
  } catch (e) {
    const cur = load().topics[key];
    if (cur) { cur.refreshError = e.message; cur.refreshFailedAt = Date.now(); save(); }
    throw e;
  }
}

// Background refresh queue: one topic at a time, after a quiet moment.
const queue = new Set();
let timer = null, running = false;
function schedule(key) {
  queue.add(key);
  clearTimeout(timer);
  timer = setTimeout(drain, DEBOUNCE_MS);
  timer.unref?.();
}
async function drain() {
  if (running) return;
  running = true;
  try {
    const ai = ctx ? ctx.ai : null;
    while (queue.size) {
      const key = queue.values().next().value;
      queue.delete(key);
      if (ai && !ai.isAvailable()) continue;
      try { await refreshTopic(key); } catch (e) { console.error(`[learner] refresh ${key}:`, e.message); }
    }
  } finally { running = false; }
}

// ---------- summary for prompts ----------

// Accepts a question object ({subject, topic}), "Subject / Topic", a topic name or a subject name.
// Returns a few short lines, or '' when nothing useful is known yet.
function summaryFor(arg) {
  const m = load();
  let subject = null, topicKey = null;
  if (arg && typeof arg === 'object') { subject = arg.subject || null; if (arg.topic) topicKey = `${arg.subject} / ${arg.topic}`; }
  else if (typeof arg === 'string') {
    if (m.topics[arg]) topicKey = arg;
    else if (m.subjects[arg]) subject = arg;
    else {
      const hit = Object.keys(m.topics).find((k) => m.topics[k].topic.toLowerCase() === arg.toLowerCase());
      if (hit) topicKey = hit;
    }
  }
  const t = topicKey ? m.topics[topicKey] : null;
  if (t && !subject) subject = t.subject;
  const s = subject ? m.subjects[subject] : null;
  const lines = [];
  const calLine = (label, c) => {
    if (!c || !c.confN || c.flag === 'too-few') return;
    const word = c.flag === 'over' ? 'OVER-confident' : c.flag === 'under' ? 'UNDER-confident' : 'well calibrated';
    lines.push(`- ${label}: ${word} (says ${c.avgConfidence}% sure on average, right ${c.accuracyWhenRated}% of the time, ${c.confN} rated answers${c.highConfidenceWrong ? `; ${c.highConfidenceWrong} confident-but-wrong` : ''}).`);
  };
  if (t) {
    lines.push(`- On ${t.topic}: ${t.answers} answers, ${t.accuracy}% right.`);
    calLine(`Confidence on ${t.topic}`, t);
    const mc = Object.entries(t.missClasses || {}).sort((a, b) => b[1] - a[1]);
    if (mc.length) lines.push(`- Usual misses here: ${mc.slice(0, 3).map(([k, n]) => `${k} (${MISS_MEANING[k] || k}) ×${n}`).join(', ')}.`);
    for (const n of (t.notes || []).slice(0, 5)) lines.push(`- ${n.kind === 'pattern' ? 'Pattern' : 'Recurring misconception'} (since ${n.since}): ${n.text}`);
    if (t.fixed?.length) lines.push(`- Recently fixed: ${t.fixed.slice(0, 2).map((f) => f.text).join('; ')} (check it stays fixed).`);
  }
  if (s) {
    calLine(`Confidence across ${subject}`, s);
    if (!t) {
      if (s.answers) lines.push(`- In ${subject}: ${s.answers} answers, ${s.accuracy}% right.`);
      const notes = Object.values(m.topics).filter((x) => x.subject === subject).flatMap((x) => (x.notes || []).filter((n) => n.kind === 'misconception').map((n) => `${x.topic}: ${n.text}`));
      for (const n of notes.slice(0, 5)) lines.push(`- Recurring misconception: ${n}`);
    }
    if (s.answers && s.thinkingAnswers) lines.push(`- Thinks out loud on ${s.thinkingAnswers} of ${s.answers} ${subject} answers.`);
  }
  return lines.join('\n');
}

// ---------- module plumbing ----------

module.exports = {
  init(c) { ctx = c; try { recompute(); } catch (e) { console.error('[learner]', e); } },

  // Every saved answer: mark its topic dirty, refresh its AI notes after a few new answers.
  onAnswer(entry) {
    load();
    const key = `${entry.subject} / ${entry.topic}`;
    recompute();
    const t = model.topics[key];
    if (!t) return;
    t.pending = (t.pending || 0) + 1;
    save();
    // After a failed refresh, wait 30 min before trying again (not one claude call per answer).
    const backoff = t.refreshFailedAt && Date.now() - t.refreshFailedAt < 30 * 60 * 1000;
    if (t.pending >= REFRESH_AFTER && !backoff) schedule(key);
  },

  async handle(req, res, url, c) {
    if (req.method === 'GET' && url.pathname === '/api/learner') {
      const m = recompute();
      c.send(res, 200, { ...m, refreshing: [...queue], running });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/learner/refresh') {
      const body = await c.readBody(req);
      if (!c.ai.isAvailable()) { c.send(res, 503, { error: c.ai.unavailableReason() }); return true; }
      if (body.topic) {
        try { await refreshTopic(body.topic); c.send(res, 200, recompute()); } catch (e) { c.send(res, 502, { error: e.message }); }
        return true;
      }
      // No topic: queue every topic with new answers, in the background.
      recompute();
      for (const [k, t] of Object.entries(model.topics)) if (t.pending > 0 || !t.refreshedAt) queue.add(k);
      drain();
      c.send(res, 200, { queued: [...queue] });
      return true;
    }
    return false;
  },

  summaryFor, recompute, refreshTopic, MISS_MEANING,
};
