// Multiple-choice answering. Options come from (1) a hand-written "> [!choices]-" callout in the
// question's markdown file, or (2) Claude, generated on first use and cached in data/mcq-cache.json.
// Distractors follow LearnHarness's option craft: write the correct claim first, then mutate it into
// believable errors, each from one specific misconception, all sharing the same skeleton.
// Correctness stays on the server until the learner commits (POST /api/mcq/check).

const crypto = require('crypto');
const fs = require('fs');
const store = require('./store');
const path = require('path');

let CACHE_FILE = null;
const IDK = 'idk';                         // the "I don't know" key the UI adds as a 5th choice
const MAX_PARALLEL = 2;                    // claude processes generating options at once
const FAIL_COOLDOWN_MS = 10 * 60 * 1000;   // warm-up won't retry a failed id for 10 minutes
const NOTE_MAX_CHARS = 40000;              // study notes can be long; cap what goes into the prompt

const SYSTEM_PROMPT = `You write one multiple-choice question for a self-study quiz. The learner studies DSA, hardware, operating systems, bash and system design, and wants to UNDERSTAND topics, not memorise keywords. Their pick must be diagnostic: a wrong pick should tell us exactly which wrong mental model they hold.

You get the original question, its reference answer, and the topic's study note. Use ONLY facts from the reference answer and the note.

How to build it, in this order:
1. stem: keep the original question's meaning. If it asks to "explain"/"describe"/"why", rephrase it lightly so one short claim can answer it (e.g. "Which statement best explains why …?"). Do not add hints. If the question depends on a code snippet or extra detail shown with it, the learner already sees that, so you can refer to it ("this script", "the output").
2. explanation: reason out why the correct answer is correct, in 1-3 short sentences, BEFORE committing to it. It is shown only after the learner answers.
3. correct: the correct claim, one bare sentence or phrase. No reasoning, no "because", no bold.
4. distractors: exactly 3. For each, first name a SPECIFIC misconception a real learner holds about this topic (e.g. "thinks exit codes wrap at 255 by saturating instead of modulo"), then write the claim that person would make by MUTATING the correct claim: same skeleton, same length (within a few words), same grammar, tone and level of detail. Each must be wrong on knowledge yet believable to someone holding that misconception, never obviously wrong on sight. The three misconceptions must differ from each other.

Rules for every option:
- All four read as siblings: none longer, more hedged, more technical or more "complete-sounding" than the others. The correct one must NOT be the longest.
- No reasoning inside any option, no bold/italics, no "all/none of the above", no "always/never" tells that only distractors carry, no jokes.
- Inline code in backticks is fine when the topic needs it; use it evenly across options.
- Self-check: if a reader who doesn't know the material could pick the right one by its shape alone, rewrite all four.

Reply with ONLY a JSON object inside a \`\`\`json fence, exactly this shape:
{"stem": "...", "explanation": "...", "correct": "...", "distractors": [{"misconception": "...", "text": "..."}, {"misconception": "...", "text": "..."}, {"misconception": "...", "text": "..."}]}`;

// ---------- small helpers ----------

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
// Hash of what the options are built from: editing the question or its answer regenerates them.
const contentHash = (q) => sha(`${q.question}\n${q.detail || ''}\n${q.answer || ''}`).slice(0, 16);
// Stable option key, independent of display order and saying nothing about correctness.
const optionKey = (id, text) => sha(`${id}\n${text}`).slice(0, 8);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function loadCache() {
  return store.readJson(CACHE_FILE, {});
}
function saveCacheEntry(id, entry) {
  const cache = loadCache();               // re-read so parallel generations don't drop each other's writes
  cache[id] = entry;
  store.writeJson(CACHE_FILE, cache);
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findFile(full, name); if (hit) return hit; }
    else if (entry.name === name) return full;
  }
  return null;
}

// The study note a question file points to with "Source note: [[Title]]" (same rule as ai-grader.js).
function sourceNoteFor(question, ctx) {
  try {
    const text = fs.readFileSync(path.join(ctx.LEARNING_DIR, question.file), 'utf8');
    const m = text.match(/Source note:\s*\[\[([^\]|#]+)/);
    if (!m) return null;
    const file = findFile(ctx.LEARNING_DIR, `${m[1].trim()}.md`);
    if (!file) return null;
    let note = ctx.ai.stripVisuals ? ctx.ai.stripVisuals(fs.readFileSync(file, 'utf8')) : fs.readFileSync(file, 'utf8');
    if (note.length > NOTE_MAX_CHARS) note = note.slice(0, NOTE_MAX_CHARS) + '\n…(note truncated)';
    return { title: m[1].trim(), text: note };
  } catch { return null; }
}

// ---------- hand-written options ----------

// Parse the optional choices callout inside one question's block of a markdown file
// (keep a blank line before "> [!answer]-", or Obsidian merges the two callouts):
//   > [!choices]-
//   > - [x] correct option text
//   > - [ ] wrong option text :: the misconception behind it
// Returns { options:[{text, correct, misconception}] } or null if absent/invalid.
function parseAuthoredChoices(markdown, id) {
  const text = markdown.replace(/\r\n/g, '\n');
  const chunk = text.split(/^## /m).slice(1).find((c) => {
    const m = c.match(/%%\s*id:\s*([\w-]+)\s*%%/);
    return m && m[1] === id;
  });
  if (!chunk) return null;
  const options = [];
  let inChoices = false;
  for (const line of chunk.split('\n')) {
    if (/^>\s*\[!choices\]/i.test(line)) { inChoices = true; continue; }
    if (!inChoices) continue;
    if (!line.startsWith('>') || /^>\s*\[!/.test(line)) break;   // block ends at a blank line or the next callout
    const m = line.match(/^>\s*[-*]\s*\[([ xX])\]\s*(.+)$/);
    if (!m) continue;
    const [optText, misconception] = m[2].split(/\s+::\s+/);
    options.push({ text: optText.trim(), correct: m[1].toLowerCase() === 'x', misconception: (misconception || '').trim() });
  }
  const problem = validateOptions(options, { min: 2, max: 6 });
  return problem ? null : { options };
}

function authoredFor(q, ctx) {
  try {
    const found = parseAuthoredChoices(fs.readFileSync(path.join(ctx.LEARNING_DIR, q.file), 'utf8'), q.id);
    return found && { stem: q.question, options: found.options, explanation: '', source: 'authored' };
  } catch { return null; }
}

// ---------- validation ----------

// Returns a problem description, or null if the options are usable.
function validateOptions(options, { min = 4, max = 4 } = {}) {
  if (!Array.isArray(options) || options.length < min || options.length > max) return `need ${min === max ? min : `${min}-${max}`} options, got ${options?.length ?? 0}`;
  if (options.some((o) => !o || typeof o.text !== 'string' || !o.text.trim())) return 'an option has no text';
  if (options.filter((o) => o.correct).length !== 1) return 'need exactly one correct option';
  if (new Set(options.map((o) => norm(o.text))).size !== options.length) return 'two options have the same text';
  if (options.some((o) => /\b(all|none|both) of the above\b/i.test(o.text))) return 'uses "all/none of the above"';
  return null;
}

// Turns Claude's reply into a cache entry, or throws with the reason (fed back into the one retry).
function parseGenerated(reply, ctx) {
  const j = ctx.ai.extractJson(reply);
  if (!j || typeof j.correct !== 'string' || !Array.isArray(j.distractors)) throw new Error('missing "correct" or "distractors"');
  const options = [
    { text: j.correct.trim(), correct: true, misconception: '' },
    ...j.distractors.map((d) => ({ text: String(d?.text || '').trim(), correct: false, misconception: String(d?.misconception || '').trim() })),
  ];
  const problem = validateOptions(options);
  if (problem) throw new Error(problem);
  if (options.some((o) => !o.correct && !o.misconception)) throw new Error('every distractor needs its misconception');
  // Shape giveaway: the correct option clearly longer than every distractor.
  const lens = options.map((o) => o.text.length);
  if (lens[0] > 1.5 * Math.max(...lens.slice(1))) throw new Error('the correct option is much longer than the distractors, which gives it away');
  return { stem: String(j.stem || '').trim(), options, explanation: String(j.explanation || '').trim() };
}

// ---------- generation (queued, de-duplicated) ----------

const inflight = new Map();   // id → Promise<entry>
const failed = new Map();     // id → { ts, error }
let running = 0;
const waiting = [];     // options someone is waiting for right now (a quiz on screen)
const waitingBg = [];   // background work (preparing the offline pack): only when nobody is waiting

function limited(fn, { background = false } = {}) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      running++;
      try { resolve(await fn()); } catch (e) { reject(e); } finally {
        running--;
        const next = waiting.shift() || waitingBg.shift();
        if (next) next();
      }
    };
    if (running < MAX_PARALLEL) run();
    else (background ? waitingBg : waiting).push(run);
  });
}

function buildPrompt(q, ctx, retryReason) {
  const note = sourceNoteFor(q, ctx);
  const parts = [
    `<question>\n${q.question}\n</question>`,
    q.detail ? `<shown_with_question>\n${q.detail}\n</shown_with_question>` : '',
    `<reference_answer>\n${ctx.ai.stripVisuals ? ctx.ai.stripVisuals(q.answer) : q.answer}\n</reference_answer>`,
    note ? `<study_note title="${note.title}">\n${note.text}\n</study_note>` : '',
    retryReason ? `Your previous attempt was rejected: ${retryReason}. Rebuild all four options from scratch.` : '',
    'Write the multiple-choice question now. JSON only.',
  ];
  return parts.filter(Boolean).join('\n\n');
}

async function generate(q, ctx) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {            // one retry on invalid output
    const reply = await ctx.ai.askOnce(buildPrompt(q, ctx, lastErr && lastErr.message), SYSTEM_PROMPT);
    try {
      const out = parseGenerated(reply, ctx);
      const entry = { hash: contentHash(q), ts: new Date().toISOString(), model: process.env.QUIZ_AI_MODEL || 'default', ...out };
      saveCacheEntry(q.id, entry);
      return entry;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`The AI's options were invalid twice (${lastErr.message})`);
}

// Options for a question: authored > cache (if the question text hasn't changed) > generate.
// `allowGenerate: false` only looks. `background: true` waits behind any quiz that needs options now.
function optionsFor(q, ctx, { allowGenerate = true, background = false } = {}) {
  const authored = authoredFor(q, ctx);
  if (authored) return Promise.resolve(authored);
  const cached = loadCache()[q.id];
  if (cached && cached.hash === contentHash(q)) return Promise.resolve({ ...cached, source: 'cache' });
  if (inflight.has(q.id)) return inflight.get(q.id);
  if (!allowGenerate) return Promise.resolve(null);
  if (!ctx.ai.isAvailable()) return Promise.reject(Object.assign(new Error(`${ctx.ai.unavailableReason()}, and this question has no hand-written choices`), { status: 503 }));
  const p = limited(() => generate(q, ctx), { background })
    .then((entry) => { failed.delete(q.id); return { ...entry, source: 'generated' }; })
    .catch((e) => { failed.set(q.id, { ts: Date.now(), error: e.message }); throw e; })
    .finally(() => inflight.delete(q.id));
  inflight.set(q.id, p);
  return p;
}

function isReady(q, ctx) {
  if (authoredFor(q, ctx)) return true;
  const cached = loadCache()[q.id];
  return !!(cached && cached.hash === contentHash(q));
}

// Option texts in a random order, keyed by stable hashes, with no correctness.
function publicOptions(id, options) {
  const out = options.map((o) => ({ key: optionKey(id, o.text), text: o.text }));
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// ---------- http ----------

const idsParam = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/mcq')) return false;

  if (req.method === 'GET' && url.pathname === '/api/mcq') {
    const q = ctx.loadQuestions().find((x) => x.id === url.searchParams.get('id'));
    if (!q) { ctx.send(res, 404, { error: 'question not found' }); return true; }
    try {
      const o = await optionsFor(q, ctx);
      ctx.send(res, 200, { id: q.id, stem: o.stem || q.question, options: publicOptions(q.id, o.options), source: o.source, idkKey: IDK });
    } catch (e) { ctx.send(res, e.status || 502, { error: e.message }); }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/mcq/check') {
    const body = await ctx.readBody(req);
    const q = ctx.loadQuestions().find((x) => x.id === body.id);
    if (!q) { ctx.send(res, 404, { error: 'question not found' }); return true; }
    let o;
    try { o = await optionsFor(q, ctx, { allowGenerate: false }); } catch { o = null; }
    if (!o) { ctx.send(res, 409, { error: 'no options for this question yet' }); return true; }
    const options = o.options.map((x) => ({ key: optionKey(q.id, x.text), text: x.text, correct: x.correct, misconception: x.misconception || '' }));
    const right = options.find((x) => x.correct);
    const picked = options.find((x) => x.key === body.key) || null;
    ctx.send(res, 200, {
      correct: !!(picked && picked.correct),
      dontKnow: body.key === IDK || !picked,
      correctKey: right.key,
      pickedText: picked ? picked.text : "I don't know",
      options,
      explanation: o.explanation || '',
      source: o.source,
    });
    return true;
  }

  // Start generating options for several questions in the background; answer right away.
  if (req.method === 'POST' && url.pathname === '/api/mcq/warm') {
    const body = await ctx.readBody(req);
    const want = new Set(Array.isArray(body.ids) ? body.ids.slice(0, 50) : []);
    const qs = ctx.loadQuestions().filter((q) => want.has(q.id));
    let ready = 0, queued = 0, skipped = 0;
    for (const q of qs) {
      if (isReady(q, ctx)) { ready++; continue; }
      const f = failed.get(q.id);
      if (!ctx.ai.isAvailable() || (f && Date.now() - f.ts < FAIL_COOLDOWN_MS)) { skipped++; continue; }
      queued++;
      optionsFor(q, ctx).catch((e) => console.error(`[mcq] warm ${q.id}: ${e.message}`));
    }
    ctx.send(res, 200, { total: qs.length, ready, queued, skipped });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/mcq/status') {
    const want = new Set(idsParam(url.searchParams.get('ids')));
    const qs = ctx.loadQuestions().filter((q) => want.has(q.id));
    const ready = qs.filter((q) => isReady(q, ctx)).map((q) => q.id);
    ctx.send(res, 200, {
      total: qs.length, ready: ready.length, readyIds: ready,
      pending: qs.filter((q) => inflight.has(q.id)).length,
      failed: qs.filter((q) => failed.has(q.id) && !ready.includes(q.id)).map((q) => ({ id: q.id, error: failed.get(q.id).error })),
    });
    return true;
  }

  return false;
}

function init(ctx) {
  CACHE_FILE = path.join(ctx.DATA_DIR, 'mcq-cache.json');
}

module.exports = { init, handle, optionsFor, isReady, parseAuthoredChoices, validateOptions, parseGenerated, contentHash, optionKey, SYSTEM_PROMPT };
