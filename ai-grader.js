// AI grading, through the app's AI engine (llm.js: Claude Code CLI, Gemini CLI or Gemini API, Settings → AI).
// One long-lived conversation per quiz run (test, practice or smart review): every question of the run is
// sent into the same conversation, so the AI remembers earlier answers, notices recurring mix-ups, and each
// study note is sent only once. askOnce() is the one-shot call the background jobs use.

const crypto = require('crypto');
const fs = require('fs');
const store = require('./store');
const path = require('path');
const llm = require('./llm');

const { LEARNING_DIR } = require('./config');   // QUIZ_LEARNING_DIR
const DATA_DIR = path.join(__dirname, 'data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'ai-feedback.jsonl');
const CHATS_FILE = path.join(DATA_DIR, 'chats.jsonl');
const IDLE_MS = 30 * 60 * 1000;            // close sessions nobody used for 30 minutes
const TURN_TIMEOUT_MS = 3 * 60 * 1000;

// Preferences (prefs.js, optional: without it the grader works as before).
const prefs = (() => { try { return require('./prefs'); } catch { return null; } })();
const pref = (k, d) => { try { return (prefs && prefs.get(k)) ?? d; } catch { return d; } };
// quiz.strictness as one line in the grade prompt ('normal' = the scale in the system prompt, no line).
const STRICTNESS = {
  lenient: 'Strictness: LENIENT. He wants encouragement-weighted scoring: when the core idea is clearly there, score it 80+ even with loose wording or a missing detail; reserve low scores for real misconceptions or answers that miss the point. Still name what is missing, and never call a wrong idea right.',
  strict: 'Strictness: STRICT. Exam-style scoring: precise terms and every point the question asks for are required. Vague or hand-wavy wording counts as partial (at most 70); 90+ only for a complete, precise answer.',
  normal: 'Strictness: back to NORMAL, the scoring scale in your instructions.',
};

const SYSTEM_PROMPT = `You are a patient, honest tutor grading a learner's written answers in a self-study quiz.
The learner studies DSA, hardware, software design and system design, and wants to be able to EXPLAIN topics well, not just recall keywords.

For every graded question you receive: the question, the reference answer, the learner's answer, and sometimes their earlier attempts. Study notes for a topic are sent once, the first time the topic comes up; use them as the source of truth together with the reference answer.

How to grade:
- Judge meaning, not wording. A correct idea in different words is correct. Ignore spelling and grammar.
- Be specific: quote or paraphrase the learner's own words when saying what was right or wrong.
- Separate MISSING points (they didn't mention it) from MISCONCEPTIONS (they said something wrong). For each misconception, give the most likely reason they believed it (e.g. mixing up two similar terms, over-generalising an example), especially if you've seen the same mix-up earlier in this session or in their earlier attempts.
- The explanation must start from what THEY wrote and fix it, not repeat the reference answer. Use a concrete example or analogy. Keep it short: aim for under 150 words.
- Grade against what the QUESTION asks, not against everything the reference answer happens to contain. "Name three X" answered with three correct X is complete: score 90-100, even if the reference lists more. A reference that says "any N of:" is a menu to pick from, not a checklist. Put a point under "missing" only if the question required it; a useful extra the question didn't ask for goes in "goodToKnow" (one short sentence, or "") and never lowers the score.
- Score 0-100: 90-100 complete and precise · 70-89 core idea right, small gaps · 50-69 partly right, an important piece missing · 20-49 major gaps or a misconception · 0-19 blank or wrong. An empty answer scores 0, but still explain the key idea briefly.
- If the reference answer itself looks wrong or incomplete, say so in the verdict.

One box, answer and thinking mixed (written answers): the learner answers open questions in a single box, typed or dictated. It may be just the answer, or them thinking out loud on the way to it ("hmm, maybe X because... no wait, it's Z").
- First find their FINAL committed answer: what they settle on, usually the last position they take. Explicitly abandoned ideas ("no wait", "actually not") are not part of it. Grade that final answer.
- Thinking out loud is never penalised: wandering, false starts and self-corrections that end up right are fine, even good. Only count a wrong idea against them if they still hold it at the end, or their final answer depends on it.
- Use the reasoning on the way as the diagnostic signal described below (what they reached for first, where they guessed, which mix-up they nearly made). If they almost fell for a misconception and caught it, mention it briefly as something to watch, not as a misconception.
- Set "gradedAnswer" to a one-sentence paraphrase of the final answer you graded, in their terms, so they can check you read them right. If the box held only a short, direct answer with no thinking around it, or was blank, "gradedAnswer" is "".

Reading the learner's thinking (<learner_thinking>, or reasoning inside the answer itself):
- The learner may think out loud while answering: unfiltered, messy, half-sentences. That trace is your PRIMARY diagnostic signal. One answer is one bit; the thinking is the picture of how they reason: what they reach for first, what they take as obvious, where they guess.
- Read it in full. A right answer reached through confused reasoning is a warning: say so and score the understanding, not just the final words. A wrong answer with sound reasoning that slipped at one step is progress: credit the reasoning and point at the exact step that broke.
- Text marked dictated="true" was spoken and transcribed: expect filler words, run-on sentences and mis-heard terms. Read it leniently for meaning; never penalise transcription noise.

Confidence (<confidence>, the learner's own 0-100 estimate that they are right, when present):
- Wrong + high confidence (70+): a committed misconception, the most important thing to catch. Name it plainly and repair it.
- Right + low confidence (50 or less): fragile knowledge or a lucky guess. One reinforcing touch, not celebration.
- Right + high: solid. Wrong + low: an honest gap, a small correction is enough.
- Then write "calibration": one short sentence to the learner, e.g. "You were 90% sure and it was wrong: that's a misconception worth fixing." or "You were only 30% sure but it was right: trust this one, it's there." Without a <confidence> tag, "calibration" is "".

Multiple choice (<format type="mcq">): the learner picked one option. The quiz itself marks the pick right or wrong; that is their grade, and your "score" is not shown. Your job is feedback on the REASONING in their thinking: if the pick was right but the reasoning was missing or wrong, say so plainly (it may have been a guess); if the pick was wrong, find which misconception made that option attractive.
Hints (<hints_used>): the learner asked for that many hints before answering. Hints mean the idea did not come to mind unaided; reflect this in suggestedRating.

Classify the main miss as "missClass" (null when the answer is essentially right):
- "cue": nothing came to mind; blank or vague, the right idea never surfaced.
- "discrimination": a related but wrong idea won (mixed up two similar concepts).
- "execution": the right idea, applied or traced wrongly (wrong step, wrong number, wrong order).
- "careless": a slip they clearly know better than (typo-level, misread the question).
- "structural": what they believe is itself wrong; a misconception in their model that needs repairing.

"suggestedRating" is only a suggestion for the learner's spaced-repetition rating: "again" (didn't know it), "hard" (partly, or needed 2+ hints), "good" (knew it with small gaps), "easy" (complete, quick, confident).

Reply to a grading request with ONLY a JSON object inside a \`\`\`json fence, exactly this shape:
{"score": 0-100, "verdict": "one sentence", "correct": ["..."], "missing": [{"point": "...", "importance": "key" | "minor"}], "misconceptions": [{"what": "...", "why": "..."}], "explanation": "markdown", "buildingBlocks": null | {"concept": "the main gap, max 6 words", "questions": [{"question": "...", "answer": "markdown"}]}, "missClass": "cue" | "discrimination" | "execution" | "careless" | "structural" | null, "suggestedRating": "again" | "hard" | "good" | "easy", "calibration": "one sentence or empty", "gradedAnswer": "one sentence or empty", "goodToKnow": "one sentence or empty"}

<grading_lessons> (when present) are rules the learner and you agreed on after earlier grades were wrong: follow them. <earlier_rulings> (when present) are corrections to earlier grades of this same question: don't repeat those mistakes.

Building blocks: when the score is under 70, the learner needs smaller steps before this question comes back. Set "buildingBlocks" to 1-3 new questions, smallest first, each aimed at ONE specific thing they missed or got wrong in THIS answer (a misconception first, then the most important missing key point). They are practised on their own over the coming days, so each must:
- stand alone: no "as above", no reference to the original question; name the concept it is about
- be small and precise: answerable in 1-3 sentences, one idea only (e.g. "Where does a local variable like x in int x = 5; live while its function runs: in the PCB or on the process's stack?")
- build toward the original question without giving away its full answer
- have a short reference answer (2-5 lines of markdown, a concrete example welcome), in the same style as the reference answer
Do not repeat anything listed in <existing_building_blocks>. Set "buildingBlocks" to null when the score is 70+, when <is_building_block/> is present (this question is already a small step), or when the miss is only careless.

A <what_we_know_about_this_learner> block (sent once per topic) summarises recurring misconceptions and calibration from earlier sessions. If the same mix-up shows up again, say so ("this is the same X/Y mix-up as before").

When the learner sends a <hint_request>, they are stuck BEFORE seeing the answer. Never reveal the answer, the key term, or anything they can still produce themselves. Read their partial answer and thinking, find the first thing in their reasoning that is missing or wrong, and give exactly ONE hint at the requested rung, in plain markdown (no JSON), at most 2 short sentences:
- R0 (rung 1), redirect attention: point at a word or detail in the question they skipped or misread. No content.
- R1 (rung 2), re-describe the pattern: say what kind of situation this is ("this is about what happens when something is shared by many..."), without naming any concept.
- R2 (rung 3), name the family: narrow it to a class of ideas ("think about caching-related ideas"), leaving them to pick which one.
- R3 (rung 4), name the concept: name the specific idea that applies; they still have to explain how it answers the question.
If their partial answer heads the wrong way, a hint can be a verification nudge: "check the assumption behind ...". If they misunderstood what is being asked, clarify the question freely; that is not a hint.


When the learner sends a <chat> message, they are asking you about a question's answer to understand it better. Answer like a friendly tutor in plain markdown (no JSON):
- Answer exactly what they asked, building on what they already wrote and what you know of their mix-ups.
- Prefer one concrete example, small trace, or analogy over abstract definitions. Use a short code block or ASCII sketch when it helps.
- Keep it under 200 words unless they ask for more depth. If the question shows a gap in a more basic concept, say so and explain that concept first.
- Ending with a short check question is fine, but don't quiz them every time.

Appeals: when a <chat> message disputes the grade (they argue their answer deserved more, a point was wrongly counted as missing or wrong, or the question/reference answer is unfair), re-check honestly against the question as asked and the reference answer. Judge the argument, not the insistence: if the original grade was right, say so kindly and explain why. Reply in plain markdown, starting with a plain verdict ("You're right: ..." or "The grade stands: ..."). Then, ONLY if the grade should change, add this fenced block at the very end of your reply:
\`\`\`regrade
{"score": 0-100, "verdict": "one sentence", "correct": ["..."], "missing": [{"point": "...", "importance": "key" | "minor"}], "misconceptions": [{"what": "...", "why": "..."}], "explanation": "markdown, short", "suggestedRating": "again" | "hard" | "good" | "easy", "goodToKnow": "one sentence or empty", "ruling": "one sentence: what was wrong with the original grade", "lesson": null or "one general grading rule for ANY question, only if this mistake would repeat elsewhere (e.g. 'When a question asks for N items, N correct items earn full marks; more is optional.')", "referenceFix": null or {"answer": "the full corrected reference answer, markdown", "why": "one sentence"}}
\`\`\`
"referenceFix" only when the reference answer itself is wrong, misleading or ambiguous about what counts.`;

// ---------- grading lessons + per-question rulings (from upheld appeals) ----------

const LESSONS_FILE = path.join(DATA_DIR, 'grader-lessons.json');
const RULINGS_FILE = path.join(DATA_DIR, 'grade-rulings.json');
const { readJson, writeJson } = store;
function loadLessons() { return readJson(LESSONS_FILE, []); }
function addLesson(text, questionId) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!t) return null;
  const all = loadLessons();
  if (all.some((l) => l.text.toLowerCase() === t.toLowerCase())) return null;
  const l = { id: `gl-${Date.now().toString(36)}`, ts: new Date().toISOString(), text: t, from: questionId };
  writeJson(LESSONS_FILE, [...all, l].slice(-30));
  return l;
}
function removeLesson(id) { writeJson(LESSONS_FILE, loadLessons().filter((l) => l.id !== id)); }
function rulingsFor(id) { return (readJson(RULINGS_FILE, {})[id] || []).slice(-3); }
function addRuling(id, text) {
  const all = readJson(RULINGS_FILE, {});
  (all[id] ||= []).push({ ts: new Date().toISOString(), text: String(text).slice(0, 400) });
  writeJson(RULINGS_FILE, all);
}

// ---------- helpers ----------

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// Can the grading engine run (Claude CLI found, Gemini signed in / key saved)? See llm.js.
const isAvailable = () => llm.available('grader');
// Why it can't, in words for the page ("Gemini CLI is not signed in").
const unavailableReason = () => llm.whyUnavailable('grader') || 'The AI is not available';

const stripVisuals = (md) => md
  .replace(/```dataviewjs[\s\S]*?```/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '[diagram]')
  .replace(/\n{3,}/g, '\n\n');

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findFile(full, name); if (hit) return hit; }
    else if (entry.name === name) return full;
  }
  return null;
}

// The study note a question file points to with "Source note: [[Title]]".
function sourceNoteFor(question) {
  try {
    const text = fs.readFileSync(path.join(LEARNING_DIR, question.file), 'utf8');
    const m = text.match(/Source note:\s*\[\[([^\]|#]+)/);
    if (!m) return null;
    const file = findFile(LEARNING_DIR, `${m[1].trim()}.md`);
    return file ? { title: m[1].trim(), text: stripVisuals(fs.readFileSync(file, 'utf8')) } : null;
  } catch { return null; }
}

function loadFeedback() {
  const rows = store.readJsonl(FEEDBACK_FILE);
  const gone = new Set(rows.map((r) => r.supersedes).filter(Boolean));   // a grade replaced after an appeal
  return rows.filter((r) => !gone.has(r.ts));
}

// Pull the JSON object out of a reply like "```json {...} ```". The JSON's own strings can contain
// ``` code fences (e.g. a Python example in the explanation), so never cut at the first fence:
// try from the opening fence to the LAST fence, then from the first "{" to the last "}".
function extractJson(text) {
  const candidates = [];
  const start = text.indexOf('```json');
  const end = text.lastIndexOf('```');
  if (start >= 0 && end > start) candidates.push(text.slice(start + 7, end));
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  let lastErr = new Error('The AI did not return JSON');
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function parseJsonReply(text) {
  const fb = extractJson(text);
  fb.score = Math.max(0, Math.min(100, Math.round(Number(fb.score) || 0)));
  for (const k of ['correct', 'missing', 'misconceptions']) if (!Array.isArray(fb[k])) fb[k] = [];
  // Newer fields: older replies (or a model that skipped them) just get null / ''.
  fb.missClass = MISS_CLASSES.includes(String(fb.missClass || '').toLowerCase()) ? String(fb.missClass).toLowerCase() : null;
  fb.suggestedRating = SUGGESTED_RATINGS.includes(String(fb.suggestedRating || '').toLowerCase()) ? String(fb.suggestedRating).toLowerCase() : null;
  fb.calibration = typeof fb.calibration === 'string' ? fb.calibration.trim() : '';
  fb.gradedAnswer = typeof fb.gradedAnswer === 'string' ? fb.gradedAnswer.trim() : '';
  fb.goodToKnow = typeof fb.goodToKnow === 'string' ? fb.goodToKnow.trim() : '';
  const bb = fb.buildingBlocks;
  const qs = bb && Array.isArray(bb.questions)
    ? bb.questions.filter((x) => x && typeof x.question === 'string' && typeof x.answer === 'string' && x.question.trim() && x.answer.trim()).slice(0, 3)
    : [];
  fb.buildingBlocks = qs.length ? { concept: String(bb.concept || '').trim().slice(0, 80), questions: qs } : null;
  return fb;
}

const MISS_CLASSES = ['cue', 'discrimination', 'execution', 'careless', 'structural'];
const SUGGESTED_RATINGS = ['again', 'hard', 'good', 'easy'];
const HINT_RUNGS = ['R0: redirect attention', 'R1: re-describe the pattern', 'R2: name the family of ideas', 'R3: name the concept'];

// The learner model (learner.js) is optional: without it the grader works as before.
function learnerSummary(question) {
  try { return require('./learner').summaryFor(question) || ''; } catch { return ''; }
}

// The answer extras (think-out-loud, confidence, multiple choice, hints) as prompt tags.
function extraTags(extra) {
  if (!extra) return [];
  const tags = [];
  if (extra.format === 'mcq') {
    tags.push(`<format type="mcq">The learner answered by picking an option: "${extra.choice ?? '?'}". ` +
      `The quiz marks this pick ${extra.correct === true ? 'CORRECT' : extra.correct === false ? 'WRONG' : 'unchecked'}.</format>`);
  }
  if (extra.thinkingWhileReading) tags.push(`<learner_thinking stage="while reading the question">\n${String(extra.thinkingWhileReading).trim()}\n</learner_thinking>`);
  if (extra.thinking) tags.push(`<learner_thinking${extra.dictated ? ' dictated="true"' : ''}>\n${String(extra.thinking).trim()}\n</learner_thinking>`);
  if (typeof extra.confidence === 'number') tags.push(`<confidence>${extra.confidence}</confidence>`);
  if (extra.hints) tags.push(`<hints_used>${Number(extra.hints)}</hints_used>`);
  return tags;
}

// ---------- one Claude session ----------

class GraderSession {
  constructor({ kind, subject }) {
    this.id = crypto.randomUUID();
    this.kind = kind;
    this.subject = subject;
    this.sentNotes = new Set();
    this.queue = Promise.resolve();
    this.lastUsed = Date.now();
    // The engine and model are fixed for the run (a Settings change applies to the next run).
    // A turn that times out kills the conversation (llm.js); the next request opens a fresh session.
    this.chat = new llm.Chat({ area: 'grader', tier: llm.defaultTier('grader'), system: SYSTEM_PROMPT, turnTimeoutMs: TURN_TIMEOUT_MS, name: 'The grader' });
    this.engine = this.chat.engine;
    this.model = this.chat.label;
  }

  get closed() { return this.chat.closed; }

  // Send one user message and wait for the full reply. Turns run one at a time.
  async ask(text) {
    if (this.chat.closed) throw new Error('AI session is closed');
    this.lastUsed = Date.now();
    return (await this.chat.send(text)).text;
  }

  // Study note + what we know about this learner, each sent only the first time a topic comes up.
  topicContext(question) {
    const parts = [];
    const note = sourceNoteFor(question);
    const noteKey = note ? note.title : question.topic;
    if (note && !this.sentNotes.has(noteKey)) {
      parts.push(`<study_note topic="${question.topic}" title="${note.title}">\n${note.text}\n</study_note>`);
      this.sentNotes.add(noteKey);
    }
    if (!this.sentLearner) this.sentLearner = new Set();
    const lk = `${question.subject} / ${question.topic}`;
    if (!this.sentLearner.has(lk)) {
      this.sentLearner.add(lk);
      const known = learnerSummary(question);
      if (known) parts.push(`<what_we_know_about_this_learner topic="${question.topic}">\n${known}\n</what_we_know_about_this_learner>`);
    }
    return parts;
  }

  async grade(question, answer, history, extra) {
    const parts = this.topicContext(question);
    const past = history.filter((h) => h.id === question.id).slice(-3);
    const pastFb = loadFeedback().filter((f) => f.id === question.id).slice(-2);
    if (past.length || pastFb.length) {
      parts.push('<earlier_attempts>\n' +
        past.map((h) => `- ${h.ts.slice(0, 10)}, self-rated "${h.rating}": ${h.answer || '(blank)'}`).join('\n') +
        (pastFb.length ? '\n' + pastFb.map((f) => `- earlier AI grade ${f.score}/100. Misconceptions: ${(f.misconceptions || []).map((m) => m.what).join('; ') || 'none'}`).join('\n') : '') +
        '\n</earlier_attempts>');
    }
    parts.push(`<question topic="${question.topic}">${question.question}</question>`);
    parts.push(`<reference_answer>\n${stripVisuals(question.answer)}\n</reference_answer>`);
    const lessons = loadLessons();
    if (lessons.length) parts.push(`<grading_lessons>\n${lessons.map((l) => `- ${l.text}`).join('\n')}\n</grading_lessons>`);
    const rulings = rulingsFor(question.id);
    if (rulings.length) parts.push(`<earlier_rulings>\n${rulings.map((r) => `- ${r.text}`).join('\n')}\n</earlier_rulings>`);
    if (question.parent) parts.push('<is_building_block/>');
    else if (question.blocks && question.blocks.length) parts.push(`<existing_building_blocks>\n${question.blocks.map((b) => `- ${b}`).join('\n')}\n</existing_building_blocks>`);
    parts.push(`<learner_answer${extra && extra.dictated ? ' dictated="true"' : ''}>\n${answer.trim() || '(left blank)'}\n</learner_answer>`);
    parts.push(...extraTags(extra));
    // Strictness: a line whenever it differs from the default, and once more when it goes back to normal
    // (this conversation may have seen another level earlier in the run).
    const strict = pref('quiz.strictness', 'normal');
    if (strict !== 'normal' || (this.strictness && this.strictness !== 'normal')) parts.push(STRICTNESS[strict] || STRICTNESS.normal);
    this.strictness = strict;
    parts.push('Grade this answer. Reply with only the JSON object.');
    const reply = await this.ask(parts.join('\n\n'));
    const fb = parseJsonReply(reply);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const ts = new Date().toISOString();
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify({
      ts, session: this.id, kind: this.kind, engine: this.engine, model: this.model,
      id: question.id, subject: question.subject, topic: question.topic, question: question.question, answer, ...fb,
      ...(extra ? { extra } : {}),
    }) + '\n');
    fb.gradedAt = ts;
    return fb;
  }

  // One rung of the hint ladder (level 0-3 → R0-R3), before the answer is revealed. Plain markdown.
  // The question + reference answer go along each time (cheap, and the hint needs them); the study
  // note only goes the first time, and then counts as sent for grading too (it's in the conversation).
  async hint(question, partialAnswer, level, extra) {
    const lvl = Math.max(0, Math.min(HINT_RUNGS.length - 1, Math.round(Number(level) || 0)));
    const parts = this.topicContext(question);
    parts.push(`<hint_request question_id="${question.id}" rung="${HINT_RUNGS[lvl]}" number="${lvl + 1} of ${HINT_RUNGS.length}">\n` +
      `<question topic="${question.topic}">${question.question}</question>\n` +
      `<reference_answer_secret>\n${stripVisuals(question.answer)}\n</reference_answer_secret>\n` +
      `<learner_partial_answer>\n${String(partialAnswer || '').trim() || '(nothing yet)'}\n</learner_partial_answer>\n` +
      extraTags(extra && { thinking: extra.thinking, thinkingWhileReading: extra.thinkingWhileReading, dictated: extra.dictated }).join('\n') +
      `\n</hint_request>\nGive exactly one hint at rung ${HINT_RUNGS[lvl]}. Do not reveal the answer. Plain markdown, at most 2 sentences.`);
    return { text: (await this.ask(parts.join('\n\n'))).trim(), level: lvl, rung: HINT_RUNGS[lvl] };
  }

  // Free chat about one question's answer. The first message about a question carries the question,
  // reference answer and study note (if grading hasn't already sent them in this session).
  async chat(question, message, answer, grade) {
    const parts = [];
    if (!this.chatContext) this.chatContext = new Set();
    if (!this.chatContext.has(question.id)) {
      this.chatContext.add(question.id);
      parts.push(...this.topicContext(question));
      parts.push(`<chat_context question_id="${question.id}">\n<question topic="${question.topic}">${question.question}</question>\n` +
        `<reference_answer>\n${stripVisuals(question.answer)}\n</reference_answer>\n` +
        `<learner_answer>\n${(answer || '').trim() || '(left blank)'}\n</learner_answer>\n` +
        (grade ? `<current_grade>\n${JSON.stringify(pick(grade, ['score', 'verdict', 'correct', 'missing', 'misconceptions', 'suggestedRating']))}\n</current_grade>\n` : '') +
        '</chat_context>');
    }
    parts.push(`<chat question_id="${question.id}">\n${message.trim()}\n</chat>`);
    const raw = await this.ask(parts.join('\n\n'));
    // An upheld appeal ends with a ```regrade {...}``` block: pull it out of the visible reply.
    let text = raw, regrade = null;
    const m = raw.match(/```regrade\s*([\s\S]*?)```\s*$/) || raw.match(/```regrade\s*([\s\S]*)$/);
    if (m) {
      text = raw.slice(0, m.index).trim();
      try { regrade = this.applyRegrade(question, answer, grade, parseJsonReply(m[1])); } catch (e) { console.error('regrade parse failed:', e.message); }
    }
    fs.appendFileSync(CHATS_FILE, JSON.stringify({
      ts: new Date().toISOString(), session: this.id, id: question.id, topic: question.topic, question: question.question, message, reply: text,
      ...(regrade ? { regrade: { score: regrade.score, ruling: regrade.ruling } } : {}),
    }) + '\n');
    return { text, regrade };
  }

  // Saves an upheld appeal: the new grade replaces the old one in the feedback log, the ruling is
  // remembered for this question, and a general lesson (if any) applies to every future grade.
  applyRegrade(question, answer, old, fb) {
    const ruling = String(fb.ruling || '').trim();
    const ts = new Date().toISOString();
    const prev = loadFeedback().filter((f) => f.id === question.id).pop();
    const kept = { missClass: fb.score >= 85 ? null : (fb.missClass ?? (old && old.missClass) ?? null) };
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify({
      ts, session: this.id, kind: this.kind, id: question.id, subject: question.subject, topic: question.topic, question: question.question,
      answer: answer || (prev && prev.answer) || '', ...fb, ...kept, regraded: true,
      ...(old && old.gradedAt ? { supersedes: old.gradedAt } : prev ? { supersedes: prev.ts } : {}),
      ...(prev && prev.extra ? { extra: prev.extra } : {}),
    }) + '\n');
    if (ruling) addRuling(question.id, ruling);
    const lesson = fb.lesson ? addLesson(fb.lesson, question.id) : null;
    const ref = fb.referenceFix && typeof fb.referenceFix.answer === 'string' && fb.referenceFix.answer.trim()
      ? { answer: fb.referenceFix.answer.trim(), why: String(fb.referenceFix.why || '') } : null;
    return { ...fb, ...kept, ruling, lesson, referenceFix: ref, gradedAt: ts, regraded: true, previousScore: old ? old.score : prev ? prev.score : null };
  }

  close() { this.chat.close(); }
}

// ---------- session registry ----------

const sessions = new Map();
setInterval(() => {
  for (const [id, s] of sessions) if (s.closed || Date.now() - s.lastUsed > IDLE_MS) { s.close(); sessions.delete(id); }
}, 60 * 1000).unref();
// AI processes are killed when the server goes away by llm.js.

function openSession(opts) {
  const s = new GraderSession(opts);
  sessions.set(s.id, s);
  return s;
}
function getSession(id) {
  const s = sessions.get(id);
  if (!s || s.closed) throw new Error('AI session not found or closed');
  return s;
}
function closeSession(id) {
  const s = sessions.get(id);
  if (s) { s.close(); sessions.delete(id); }
}

// ---------- one-shot request (no session) ----------

// Send a single prompt to a fresh conversation on the grading engine and return its text reply.
// opts.signal (AbortSignal, optional): aborting kills it and rejects with an AbortError.
function askOnce(prompt, systemPrompt, { signal } = {}) {
  return llm.ask(prompt, { area: 'grader', system: systemPrompt, timeoutMs: TURN_TIMEOUT_MS, signal });
}

module.exports = { loadLessons, removeLesson, isAvailable, unavailableReason, openSession, getSession, closeSession, loadFeedback, askOnce, stripVisuals, extractJson, parseJsonReply, MISS_CLASSES, HINT_RUNGS };
