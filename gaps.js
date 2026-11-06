// Knowledge gaps: "what confused me" notes the learner writes after revealing an answer.
// Claude maps each one to a concept, the questions that build it, and the study note section to read.
// While a gap is open, its related questions are asked more often and the question that exposed it
// is asked less often. The gap closes on its own once enough related questions are answered well
// (or by hand with "I get it now"), and then the original question gets a boost so it comes back.
//
// Stored in data/gaps.json (one JSON array).

const fs = require('fs');
const store = require('./store');
const path = require('path');
const ai = require('./ai-grader');

const { LEARNING_DIR, posixRel } = require('./config');   // QUIZ_LEARNING_DIR, else the folder above _quiz
const VAULT_DIR = path.resolve(LEARNING_DIR, '..');
const VAULT_NAME = process.env.QUIZ_VAULT || path.basename(VAULT_DIR);
const GAPS_FILE = path.join(__dirname, 'data', 'gaps.json');

const ACTIVE_PER_SUBJECT = 3;   // only the oldest few open gaps per subject steer question picking
// Pick weights (server.js) differ a lot: box-0 = 243, new = 10, mastered = 1. So boosts are relative
// to the average weight of the questions being picked from: with ~8 study-these questions in a pool
// of ~60, they come up about a third of the time.
const BOOST = 3;                // related questions of an active gap: 3x an average question
const RARE = 0.1;               // the question that exposed an open gap: 10x less likely than usual
const RETRY_BOOST = 3;          // that question again, once its gap is resolved
const PASS_SCORE = 75;          // AI score that counts as "answered well"

// ---------- storage ----------

function load() {
  const g = store.readJson(GAPS_FILE, []);
  return Array.isArray(g) ? g : [];
}
function save(gaps) {
  store.writeJson(GAPS_FILE, gaps);
}
function update(id, fn) {
  const gaps = load();
  const g = gaps.find((x) => x.id === id);
  if (!g) return null;
  fn(g);
  save(gaps);
  return g;
}

// ---------- study notes ----------

// Every study note: Learning/<Subject>/*.md (not the Questions folder), with its ## / ### headings.
function noteCatalog() {
  const notes = [];
  for (const subject of (fs.existsSync(LEARNING_DIR) ? fs.readdirSync(LEARNING_DIR, { withFileTypes: true }) : [])) {
    if (!subject.isDirectory() || /^[_.]/.test(subject.name)) continue;
    const dir = path.join(LEARNING_DIR, subject.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const headings = [...text.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim());
      notes.push({ file: `${subject.name}/${f}`, title: f.replace(/\.md$/, ''), subject: subject.name, headings });
    }
  }
  return notes;
}

// The note a question file points to with "Source note: [[Title]]".
function sourceNoteOf(question, notes) {
  try {
    const text = fs.readFileSync(path.join(LEARNING_DIR, question.file), 'utf8');
    const m = text.match(/Source note:\s*\[\[([^\]|#]+)/);
    const note = m && notes.find((n) => n.title === m[1].trim());
    return note ? { file: note.file, title: note.title, heading: null } : null;
  } catch { return null; }
}

// obsidian:// link that opens the note (at the heading when there is one).
function obsidianUrl(note) {
  if (!note) return null;
  const rel = posixRel(VAULT_DIR, path.join(LEARNING_DIR, note.file)).replace(/\.md$/, '');
  const file = note.heading ? `${rel}#${note.heading}` : rel;
  return `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(file)}`;
}

// [[wikilink]] for Quiz Progress.md
function wikiLink(note) {
  if (!note) return '';
  return note.heading ? `[[${note.title}#${note.heading}|${note.title} › ${note.heading}]]` : `[[${note.title}]]`;
}

// ---------- Claude analysis ----------

const SYSTEM_PROMPT = `You help a self-learner turn "what confused me" notes into a focused study plan.
You get: a quiz question, its reference answer, the learner's own words about what they don't understand, a catalog of every quiz question, and a catalog of study notes with their headings.

Find the underlying concept they are missing. Usually it is a building block the answer relies on, not the question itself (e.g. confused by "use a circular buffer / deque" → the missing concept is how a ring buffer wraps its head index).

Reply with ONLY a JSON object inside a \`\`\`json fence, exactly this shape:
{"concept": "short name, max 6 words",
 "why": "1-2 sentences, addressed to the learner as 'you': what exactly is missing and why the answer didn't land",
 "relatedIds": ["ids of 3-8 catalog questions that build this concept, most basic first; never the original question"],
 "note": {"file": "file from the note catalog, exactly as written", "heading": "a heading of that note, exactly as written, or null"} or null if no note covers it,
 "advice": "1-2 sentences: what to read or try first",
 "missingNote": null, or a short topic name if no note covers the concept well and one should be written}

Only use ids and files that appear in the catalogs. If no catalog question fits, return an empty relatedIds.`;

const parseJson = ai.extractJson;

async function analyze(gapId, questions) {
  const gap = load().find((g) => g.id === gapId);
  if (!gap) return;
  const q = questions.find((x) => x.id === gap.sourceId);
  const notes = noteCatalog();
  const fallbackNote = q ? sourceNoteOf(q, notes) : null;

  if (!ai.isAvailable() || !q) {
    update(gapId, (g) => { g.analysis = { state: 'manual', note: fallbackNote, relatedIds: [] }; });
    return;
  }
  update(gapId, (g) => { g.analysis = { ...(g.analysis || {}), state: 'pending' }; });

  const prompt = [
    `<question id="${q.id}" subject="${q.subject}" topic="${q.topic}">${q.question}</question>`,
    `<reference_answer>\n${ai.stripVisuals(q.answer)}\n</reference_answer>`,
    gap.answer ? `<learner_answer>\n${gap.answer}\n</learner_answer>` : '',
    `<what_confused_me>\n${gap.texts.map((t) => t.chatReply
      ? `- (asked the tutor in chat) ${t.text}\n  tutor's reply: ${t.chatReply.replace(/\n+/g, ' ')}`
      : `- (rated "${t.rating || '?'}") ${t.text}`).join('\n')}\n</what_confused_me>`,
    `<question_catalog>\n${questions.map((x) => `${x.id} | ${x.subject} / ${x.topic} | ${x.question}`).join('\n')}\n</question_catalog>`,
    `<note_catalog>\n${notes.map((n) => `${n.file}\n  headings: ${n.headings.join(' · ')}`).join('\n')}\n</note_catalog>`,
    'Reply with only the JSON object.',
  ].filter(Boolean).join('\n\n');

  try {
    const out = parseJson(await ai.askOnce(prompt, SYSTEM_PROMPT));
    const ids = new Set(questions.map((x) => x.id));
    const relatedIds = [...new Set((Array.isArray(out.relatedIds) ? out.relatedIds : []))]
      .filter((id) => ids.has(id) && id !== q.id).slice(0, 8);
    let note = null;
    const n = out.note && notes.find((x) => x.file === out.note.file);
    if (n) note = { file: n.file, title: n.title, heading: n.headings.includes(out.note.heading) ? out.note.heading : null };
    update(gapId, (g) => {
      g.analysis = {
        state: 'done',
        concept: String(out.concept || '').slice(0, 80) || null,
        why: out.why || null,
        advice: out.advice || null,
        missingNote: out.missingNote || null,
        relatedIds,
        note: note || fallbackNote,
      };
      g.passedIds = (g.passedIds || []).filter((id) => relatedIds.includes(id));
    });
  } catch (e) {
    update(gapId, (g) => { g.analysis = { state: 'error', error: e.message, note: fallbackNote, relatedIds: [] }; });
  }
  hooks.onChange();
}

// ---------- create / resolve ----------

// One open gap per question: writing again on the same question adds to it and re-analyzes.
// `chat` (optional): { question, reply } from the side chat, when the gap is made from a chat message.
function addGap({ question, text, rating, answer, chat }, questions) {
  const gaps = load();
  let g = gaps.find((x) => x.status === 'open' && x.sourceId === question.id);
  const entry = { ts: new Date().toISOString(), text: text.trim(), rating: rating || null };
  if (chat) entry.chatReply = String(chat.reply || '').slice(0, 2000);
  if (g) {
    g.texts.push(entry);
    if (answer) g.answer = answer;
  } else {
    g = {
      id: `gap-${Date.now().toString(36)}`,
      created: entry.ts,
      status: 'open',
      sourceId: question.id,
      sourceQuestion: question.question,
      subject: question.subject,
      topic: question.topic,
      answer: answer || '',
      texts: [entry],
      passedIds: [],
      analysis: { state: 'pending' },
    };
    gaps.push(g);
  }
  save(gaps);
  analyze(g.id, questions).catch((e) => console.error('gap analysis failed', e));
  return g;
}

// A gap opened by the AI grader with building blocks it wrote (blocks.js): no analysis needed, the
// blocks are the study plan. An open gap on the same question gets the new blocks added.
function addBlocks({ question, concept, ids }) {
  const gaps = load();
  let g = gaps.find((x) => x.status === 'open' && x.sourceId === question.id);
  const ts = new Date().toISOString();
  if (g) {
    g.analysis = g.analysis || { state: 'done' };
    g.analysis.relatedIds = [...new Set([...(g.analysis.relatedIds || []), ...ids])];
    if (!g.analysis.concept && concept) g.analysis.concept = concept;
    if (g.analysis.state === 'pending' || g.analysis.state === 'error') g.analysis.state = 'done';
  } else {
    g = {
      id: `gap-${Date.now().toString(36)}`,
      created: ts,
      status: 'open',
      origin: 'grade',
      sourceId: question.id,
      sourceQuestion: question.question,
      subject: question.subject,
      topic: question.topic,
      answer: '',
      texts: [{ ts, text: concept || 'Gaps in your answer', rating: null }],
      passedIds: [],
      analysis: { state: 'done', concept: concept || null, relatedIds: ids, note: sourceNoteOf(question, noteCatalog()) },
    };
    gaps.push(g);
  }
  save(gaps);
  hooks.onChange();
  return g;
}

// A building block was removed: drop it from its gap, and drop the gap once it has nothing left.
function removeRelated(sourceId, id) {
  let gaps = load();
  for (const g of gaps) {
    if (g.sourceId !== sourceId || !g.analysis?.relatedIds) continue;
    g.analysis.relatedIds = g.analysis.relatedIds.filter((x) => x !== id);
    g.passedIds = (g.passedIds || []).filter((x) => x !== id);
  }
  gaps = gaps.filter((g) => !(g.origin === 'grade' && g.sourceId === sourceId && !g.analysis.relatedIds.length));
  save(gaps);
  hooks.onChange();
}

function resolve(id, by = 'manual') {
  return update(id, (g) => {
    if (g.status !== 'open') return;
    g.status = 'resolved';
    g.resolvedAt = new Date().toISOString();
    g.resolvedBy = by;
    g.sourceRetried = false;
  });
}

function reopen(id) {
  return update(id, (g) => { g.status = 'open'; g.passedIds = []; delete g.resolvedAt; delete g.resolvedBy; delete g.sourceRetried; });
}

function remove(id) {
  save(load().filter((g) => g.id !== id));
}

// How many related questions must be answered well before the gap closes on its own.
function needed(g) {
  const n = g.analysis?.relatedIds?.length || 0;
  return n ? Math.min(3, Math.ceil(n / 2)) : null;
}

// Called after every rated answer.
function onAnswer({ id, rating, aiScore }) {
  const gaps = load();
  const good = typeof aiScore === 'number' ? aiScore >= PASS_SCORE : rating === 'good' || rating === 'easy';
  let changed = false;
  for (const g of gaps) {
    if (g.status === 'resolved' && g.sourceId === id && !g.sourceRetried) { g.sourceRetried = true; changed = true; }
    if (g.status !== 'open') continue;
    if (g.analysis?.relatedIds?.includes(id)) {
      const passed = new Set(g.passedIds || []);
      good ? passed.add(id) : passed.delete(id);
      g.passedIds = [...passed];
      changed = true;
    }
    const n = needed(g);
    const sourceNailed = g.sourceId === id && (rating === 'easy' || (typeof aiScore === 'number' && aiScore >= 85));
    if ((n && g.passedIds.length >= n) || sourceNailed) {
      g.status = 'resolved';
      g.resolvedAt = new Date().toISOString();
      g.resolvedBy = 'auto';
      g.sourceRetried = g.sourceId === id;
      changed = true;
    }
  }
  if (changed) save(gaps);
}

// ---------- steering question picking ----------

// Open gaps that currently steer picking: the oldest ACTIVE_PER_SUBJECT per subject.
function activeGaps(gaps = load()) {
  const perSubject = {};
  return gaps
    .filter((g) => g.status === 'open')
    .sort((a, b) => a.created.localeCompare(b.created))
    .filter((g) => ((perSubject[g.subject] = (perSubject[g.subject] || 0) + 1) <= ACTIVE_PER_SUBJECT));
}

// A question's pick weight after its focus. avgWeight = average weight of the pool it's picked from.
function applyFocus(w, focus, avgWeight) {
  if (!focus) return w;
  if (focus.reason === 'parked') return w * RARE;
  return Math.max(w, avgWeight) * focus.factor;
}

// question id → { factor, reason } where reason is 'gap' (study this), 'parked' or 'retry'.
function focusMap() {
  const gaps = load();
  const map = {};
  const set = (id, factor, reason) => { if (!map[id] || factor > map[id].factor) map[id] = { factor, reason }; };
  for (const g of gaps) {
    if (g.status === 'open') set(g.sourceId, RARE, 'parked');
    if (g.status === 'resolved' && !g.sourceRetried) set(g.sourceId, RETRY_BOOST, 'retry');
  }
  for (const g of activeGaps(gaps)) for (const id of g.analysis?.relatedIds || []) {
    // already answered well for this gap → back to normal spaced repetition
    if (map[id]?.reason !== 'parked' && !(g.passedIds || []).includes(id)) set(id, BOOST, 'gap');
  }
  return map;
}

// ---------- for the page and the dashboard ----------

function listForClient() {
  const gaps = load();
  const active = new Set(activeGaps(gaps).map((g) => g.id));
  const view = (g) => ({ ...g, active: active.has(g.id), needed: needed(g), url: obsidianUrl(g.analysis?.note) });
  return {
    open: gaps.filter((g) => g.status === 'open').map(view),
    resolved: gaps.filter((g) => g.status === 'resolved').sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt)).slice(0, 10).map(view),
  };
}

function dashboardLines() {
  const open = load().filter((g) => g.status === 'open');
  if (!open.length) return [];
  const bySubject = {};
  for (const g of open) (bySubject[g.subject] ||= []).push(g);
  const lines = ['## 📖 Study next', '', '_From gaps the quiz found in your answers._', ''];
  for (const [subject, list] of Object.entries(bySubject)) {
    lines.push(`### ${subject}`, '');
    for (const g of list) {
      const a = g.analysis || {};
      const concept = a.concept || g.texts[g.texts.length - 1].text.slice(0, 60);
      const n = needed(g);
      lines.push(`- **${concept}**${a.note ? `: read ${wikiLink(a.note)}` : ''}${n ? ` (${g.passedIds.length}/${n} practice questions done)` : ''}`);
      lines.push(g.origin === 'grade'
        ? `  - From your answer on _${g.sourceQuestion}_: ${(a.relatedIds || []).length} building-block questions`
        : `  - You wrote: "${g.texts[g.texts.length - 1].text.replace(/\s+/g, ' ')}" on _${g.sourceQuestion}_`);
      if (a.advice) lines.push(`  - ${a.advice}`);
      if (a.missingNote) lines.push(`  - ✍️ No good note yet: consider writing one on **${a.missingNote}**`);
    }
    lines.push('');
  }
  return lines;
}

// server.js sets this to rewrite Quiz Progress.md when a background analysis finishes.
const hooks = { onChange: () => {} };

module.exports = { addGap, addBlocks, removeRelated, analyze, resolve, reopen, remove, onAnswer, focusMap, applyFocus, listForClient, dashboardLines, load, hooks };
