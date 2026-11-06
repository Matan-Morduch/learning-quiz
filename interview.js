// Interview tab, server side: live mock coding interviews with an AI interviewer (see docs/INTERVIEW-PLAN.md).
//
// A session = one problem, one interviewer process (interview/claude.js Conversation, Sonnet or Opus),
// 45 minutes. The browser sends events; the server decides when to wake the interviewer, streams its
// speech back sentence by sentence, runs the hidden tests on "done", keeps the recording, and writes
// the debrief at the end.
//
// Routes:
//   GET  /api/interview/home                         → { patterns, suggestions, problems, sessions, stats, models }
//   POST /api/interview/start {slug, model}          → { session (public), problem (public), serverNow }
//   GET  /api/interview/<id>/stream                  SSE: say {turn, seq, text}, turn {turn, silent, stage},
//                                                    thinking {turn}, state {stage, hints, endsAt}, verdict-pending,
//                                                    ended {reason}, fail {message}   (Last-Event-ID replays)
//   POST /api/interview/<id>/event {type, t, ...}    said {text, interrupted?} · code {code} · board {desc, png?}
//                                                    · hint · done · spoke {turn, seq} · mic {t}
//   POST /api/interview/<id>/audio                   raw mic audio (webm), appended in order
//   POST /api/interview/<id>/pause {paused}          pauses / resumes: the clock stops, the interviewer waits
//                                                    (all t values are interview time: paused stretches don't count)
//   POST /api/interview/<id>/end {reason}            ends the call; the debrief is written in the background
//   POST /api/interview/<id>/rate {stars, note}      his rating of the interviewer (model comparison)
//   POST /api/interview/<id>/delete
//   GET  /api/interview/<id>                         → session + debrief + events (for the replay)
//   GET  /api/interview/<id>/audio                   the mic recording (Range supported)
//   GET  /api/interview/<id>/board/<n>.png           a board snapshot
//
// Files: data/interview/sessions/<id>/ session.json · events.jsonl (everything, with t = ms since start)
//        · mic.webm · board-<n>.png.  Vault: Learning/DSA/Interview/Sessions/<date> <title>.md
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const runner = require('./interview-runner');
const problems = require('./interview-problems');
const { ask, Conversation, modelKey, LABEL: MODELS } = require('./interview/claude');
const llm = require('./llm');

const DURATION_MS = 45 * 60000;
const DEBRIEF_MODEL = process.env.QUIZ_INTERVIEW_DEBRIEF_MODEL || 'opus';
const SILENCE_MS = 100 * 1000;      // no speech or typing this long → the interviewer may check in
const MAX_AUDIO_BYTES = 120 * 1024 * 1024;

let ctx = null, DIR = null, VAULT_DIR = null;
const live = new Map();   // id → Live (sessions with a running call)

function init(c) {
  ctx = c;
  DIR = path.join(c.DATA_DIR, 'interview', 'sessions');
  VAULT_DIR = path.join(c.LEARNING_DIR, 'DSA', 'Interview', 'Sessions');
  fs.mkdirSync(DIR, { recursive: true });
  problems.init(c);
  // Calls cut off by a restart: end them and write their debrief from what was saved.
  setTimeout(() => {
    for (const s of listSessions()) {
      if (s.state === 'live') {
        s.state = 'ended'; s.endReason = 'server restarted'; s.endedAt = s.endedAt || Date.now();
        saveSession(s);
        debrief(s.id).catch((e) => console.error('[interview] debrief', e.message));
      } else if (s.state === 'ended' && (!s.debrief || s.debrief.state === 'pending')) {
        debrief(s.id).catch((e) => console.error('[interview] debrief', e.message));
      }
    }
  }, 2000).unref();
}

// ---------- storage ----------
const sdir = (id) => path.join(DIR, id);
const validId = (id) => /^iv-[a-z0-9]+$/.test(id);
function loadSession(id) { return validId(id) ? store.readJson(path.join(sdir(id), 'session.json'), null) : null; }
function saveSession(s) { store.writeJson(path.join(sdir(s.id), 'session.json'), s); }
function logEvent(id, ev) { fs.appendFileSync(path.join(sdir(id), 'events.jsonl'), JSON.stringify(ev) + '\n'); }
function loadEvents(id) { return store.readJsonl(path.join(sdir(id), 'events.jsonl')); }
function listSessions() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch {}
  return names.filter(validId).map(loadSession).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt);
}
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// ---------- the interviewer ----------
function systemPrompt(prob, habits) {
  return `You are a senior software engineer at a big tech company (NVIDIA) running a realistic 45-minute live coding interview over a voice call. The candidate (Matan) codes in Python in a plain editor (no autocomplete, and they cannot run code) and can draw on a whiteboard.

How to behave, like a real interviewer:
- Mostly listen. Speak briefly: one to three short sentences. Everything you write is read aloud, so plain spoken English only: no markdown, no lists, no code, no symbols. Say "n squared", "O of n".
- Never write code or give the solution. Never say whether the code is right before they say they're done. Don't teach or lecture.
- Answer clarifying questions directly and briefly, even when the statement already covers it ("Yes, they can be negative, and there's always exactly one answer."). Never send them back to read the statement. Asking good clarifying questions is a plus.
- Push on what matters: ask for the brute force idea if they jump straight in without a plan, ask for time and space complexity, ask about edge cases, ask them to walk through an example by hand. When they explain a good approach, often just say "Sounds good, go ahead and code it."
- When a real interviewer would stay quiet (they are thinking aloud, mid-explanation, typing), reply with exactly <silent/> and nothing else spoken.
- Hints: only when they ask, or after long silence, or when they've gone the wrong way for several minutes. Smallest hint first, following this ladder (use the next unused rung): ${prob.hints.map((h, i) => `(${i + 1}) ${h}`).join(' ')}
- After [DONE] you get PRIVATE hidden test results. Never mention tests, test cases or pass counts. If tests fail, ask them to walk through a small input that shows the bug (you may use a failing input if it's short, or a smaller one with the same problem). If it's correct but too slow, ask about complexity and whether they can do better. If all pass, ask about complexity if not discussed, then a follow-up: ${prob.followups.join(' | ')}
- Keep track of time from [TIME] events. At the end, thank them and close in one or two sentences.
${habits ? `\nFrom his past interviews, he tends to: ${habits}. Don't mention this; just notice whether it happens again.\n` : ''}
Events you receive (in square brackets): [START], [SAID] what they said (speech to text, may have small errors), [INTERRUPTED] they cut you off (what they heard), [CODE] the editor contents, [BOARD] their whiteboard (JSON and maybe an image), [SILENCE], [HINT REQUEST] (they pressed the hint button), [DONE] with private results, [TIME].

Reply format, always: first the spoken words (or <silent/>), then on its own line a private note that is never read aloud:
<notes>{"stage":"intro|clarify|approach|code|verify|done|followup|wrap","hint":<the hint rung you gave in this reply, 0 if none>,"obs":[{"area":"communication|problem_solving|coding|verification","good":true|false,"note":"<short, specific observation>"}]}</notes>
Add obs only when something new and notable happened. Your notes become the scorecard, so be specific.

The problem (on their screen):
Title: ${prob.title} (LeetCode, ${prob.difficulty})
${prob.statement}

Starter code:
${prob.starter}

PRIVATE, never reveal: optimal ${prob.complexity.time || '?'} time, ${prob.complexity.space || '?'} space. Reference solution:
${prob.reference}
Common mistakes: ${prob.mistakes.join(' | ')}`;
}

function pastHabits() {
  const recent = listSessions().filter((s) => s.debrief && s.debrief.state === 'ready').slice(0, 3);
  const items = recent.flatMap((s) => s.debrief.workOn || []).slice(0, 6);
  return items.length ? items.join('; ') : '';
}

const DONE_RE = /\b(i'?m|i am|i think i'?m|i believe i'?m)\s+(done|finished)\b|\bthat'?s (my|the) (final )?(solution|answer)\b|\bi'?m happy with (it|this|my solution)\b/i;

class Live {
  constructor(s, prob) {
    this.s = s;
    this.prob = prob;
    this.conv = new Conversation({ system: systemPrompt(prob, pastHabits()), model: s.model, engine: s.engine, turnTimeoutMs: 90000 });
    this.clients = new Set();
    this.history = [];          // SSE events sent so far (replayed on reconnect)
    this.seqId = 0;
    this.inbox = [];            // event texts waiting for the next interviewer turn
    this.wakeReasons = 0;       // how many wake-worthy items are in the inbox
    this.busy = false;
    this.turn = 0;
    this.code = prob.starter;
    this.codeSent = prob.starter;
    this.board = null; this.boardSent = null; this.boardPng = null;
    this.lastActivity = Date.now();
    this.lastSilenceWake = 0;
    this.speakingUntil = 0;
    this.timeMarks = new Set();
    this.paused = false; this.pausedAt = 0;
    this.s.pausedMs = this.s.pausedMs || 0;
    this.timer = setInterval(() => this.tick(), 5000);
  }
  // Interview time: ms since the start, not counting pauses.
  t() { return Date.now() - this.s.startedAt - this.s.pausedMs - (this.paused ? Date.now() - this.pausedAt : 0); }

  pause(on) {
    if (on === this.paused || this.s.state !== 'live') return;
    if (on) {
      this.paused = true; this.pausedAt = Date.now();
      logEvent(this.s.id, { t: this.t(), type: 'pause' });
    } else {
      const ms = Date.now() - this.pausedAt;
      this.s.pausedMs += ms;
      this.paused = false;
      this.lastActivity = this.lastSilenceWake = Date.now();
      logEvent(this.s.id, { t: this.t(), type: 'resume', ms });
      saveSession(this.s);
      if (ms > 20000) this.push(`[RESUMED] The candidate paused the interview for ${Math.round(ms / 60000) || 'less than a'} minute${Math.round(ms / 60000) === 1 ? '' : 's'} and is back. Welcome them back in a few words, or stay silent.`, true);
    }
    this.emit('state', this.stateView());
  }

  emit(type, data) {
    const ev = { id: ++this.seqId, type, data };
    this.history.push(ev);
    for (const res of this.clients) writeSse(res, ev);
  }

  push(text, wake) {
    this.inbox.push(text);
    if (wake) this.wakeReasons++;
    this.kick();
  }

  kick() {
    if (this.busy || !this.wakeReasons || this.s.state !== 'live' || this.paused) return;
    const parts = this.inbox.splice(0);
    this.wakeReasons = 0;
    // Code and board changes ride along with the next turn.
    const content = [];
    if (this.code !== this.codeSent) { parts.push(`[CODE] (${mmss(this.t())})\n${this.code}`); this.codeSent = this.code; }
    if (this.board && this.board !== this.boardSent) {
      parts.push(`[BOARD] what they drew (JSON):\n${this.board.slice(0, 6000)}`);
      this.boardSent = this.board;
      if (this.boardPng) { content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: this.boardPng } }); this.boardPng = null; }
    }
    content.unshift({ type: 'text', text: `${parts.join('\n\n')}\n\n(Time: ${mmss(this.t())} of 45:00.)` });
    this.runTurn(content);
  }

  async runTurn(content) {
    this.busy = true;
    const turn = ++this.turn;
    this.emit('thinking', { turn });
    let raw = '', spokenUpTo = 0, seq = 0;
    const said = [];
    const sayOne = (text) => {
      said.push(text);
      this.emit('say', { turn, seq, text });
      logEvent(this.s.id, { t: this.t(), type: 'say', turn, seq, text });
      seq++;
    };
    // Speech is everything before the first '<' (<notes>, <silent/>), cut into sentences as it streams.
    const flush = (final) => {
      const speakable = raw.split('<')[0];
      const { out, used } = sentences(speakable.slice(spokenUpTo), final);
      out.forEach(sayOne);
      spokenUpTo += used;
    };
    try {
      const r = await this.conv.send(content, { onText: (d) => { raw += d; flush(false); } });
      raw = r.text || raw;
      flush(true);
      const notes = parseNotes(raw);
      const silent = !said.length;
      if (notes) {
        if (notes.stage) this.s.stage = notes.stage;
        if (notes.hint > 0) this.s.hints.push({ t: this.t(), level: notes.hint });
        for (const o of notes.obs || []) this.s.notes.push({ t: this.t(), ...o });
      }
      this.s.latency.push({ turn, firstMs: r.firstMs, totalMs: r.totalMs, silent });
      this.s.transcript.push(...said.map((text) => ({ t: this.t(), who: 'ai', text })));
      saveSession(this.s);
      logEvent(this.s.id, { t: this.t(), type: 'turn', turn, silent, stage: this.s.stage, notes, ms: r.totalMs, firstMs: r.firstMs });
      this.speakingUntil = Date.now() + said.join(' ').length * 70;   // ~14 chars/s of speech
      this.emit('turn', { turn, silent, stage: this.s.stage });
      this.emit('state', this.stateView());
    } catch (e) {
      console.error('[interview] turn failed:', e.message);
      this.emit('fail', { message: e.message });
      if (this.conv.closed && this.s.state === 'live') {
        // The process died: start a new one that knows the conversation so far.
        this.conv = new Conversation({ system: systemPrompt(this.prob, pastHabits()), model: this.s.model, engine: this.s.engine, turnTimeoutMs: 90000 });
        this.inbox.unshift(`[RESUMED] The call glitched and you lost the thread. Conversation so far:\n${this.s.transcript.map((x) => `${mmss(x.t)} ${x.who === 'ai' ? 'You' : 'Candidate'}: ${x.text}`).join('\n')}`);
      }
    } finally {
      this.busy = false;
      if (this.ending) this.finishEnd();
      else this.kick();
    }
  }

  stateView() { return { stage: this.s.stage, hints: this.s.hints.length, state: this.s.state, paused: this.paused, pausedMs: this.s.pausedMs, t: this.t() }; }

  tick() {
    if (this.s.state !== 'live' || this.paused) return;
    const el = this.t();
    for (const [at, msg] of [[35 * 60000, '[TIME] 10 minutes left.'], [40 * 60000, '[TIME] 5 minutes left. Start moving them toward finishing.'],
      [DURATION_MS, '[TIME] Time is up. Thank them and close the interview in one or two sentences.']]) {
      if (el >= at && !this.timeMarks.has(at)) {
        this.timeMarks.add(at);
        this.push(msg, true);
        if (at === DURATION_MS) this.ending = 'time';
      }
    }
    const quietFor = Date.now() - Math.max(this.lastActivity, this.speakingUntil);
    if (!this.busy && quietFor > SILENCE_MS && Date.now() - this.lastSilenceWake > SILENCE_MS && el > 60000) {
      this.lastSilenceWake = Date.now();
      logEvent(this.s.id, { t: el, type: 'silence', ms: quietFor });
      this.push(`[SILENCE] No speech or typing for ${Math.round(quietFor / 1000)} seconds.`, true);
    }
  }

  async done(source) {
    if (this.running) return;
    this.running = true;
    this.lastActivity = Date.now();
    this.emit('verdict-pending', {});
    try {
      const v = await runTests(this.prob, this.code);
      v.t = this.t(); v.source = source;
      this.s.doneRuns.push(v);
      saveSession(this.s);
      logEvent(this.s.id, { t: v.t, type: 'done', source, passed: v.passed, total: v.total, ok: v.ok, tooSlow: v.tooSlow });
      this.push(`[DONE] The candidate says they're done (${source === 'button' ? 'pressed I\'m done' : 'said so'}).\nPRIVATE hidden test results (never reveal tests): ${verdictText(v)}`, true);
    } finally { this.running = false; }
  }

  end(reason) {
    if (this.s.state !== 'live') return;
    this.ending = reason || 'ended';
    if (!this.busy) this.finishEnd();
  }

  finishEnd() {
    if (this.s.state !== 'live') return;
    if (this.paused) { this.s.pausedMs += Date.now() - this.pausedAt; this.paused = false; }
    clearInterval(this.timer);
    this.s.state = 'ended';
    this.s.endedAt = Date.now();
    this.s.endReason = this.ending;
    this.s.finalCode = this.code;
    this.s.debrief = { state: 'pending' };
    saveSession(this.s);
    logEvent(this.s.id, { t: this.t(), type: 'end', reason: this.ending });
    this.emit('ended', { reason: this.ending });
    this.conv.close();
    setTimeout(() => { for (const res of this.clients) try { res.end(); } catch {} live.delete(this.s.id); }, 1500);
    debrief(this.s.id).catch((e) => console.error('[interview] debrief failed:', e.message));
    remux(this.s.id);
  }
}

// Complete sentences at the start of `text` (a sentence ends at . ? ! followed by a space; "3.5" doesn't).
// With final, the rest counts as one more sentence.
function sentences(text, final) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!'.?!'.includes(text[i])) continue;
    let j = i + 1;
    while (j < text.length && '.?!"\')]'.includes(text[j])) j++;
    if (j < text.length && /\s/.test(text[j])) {
      const sent = text.slice(start, j).trim();
      if (sent) out.push(sent);
      while (j < text.length && /\s/.test(text[j])) j++;
      start = j;
      i = j - 1;
    }
  }
  let used = start;
  if (final) { const tail = text.slice(start).trim(); if (tail) out.push(tail); used = text.length; }
  return { out, used };
}

function parseNotes(raw) {
  const m = String(raw).match(/<notes>\s*([\s\S]*?)\s*<\/notes>/);
  if (!m) return null;
  try { const j = JSON.parse(m[1].slice(m[1].indexOf('{'), m[1].lastIndexOf('}') + 1)); return { stage: j.stage || null, hint: Number(j.hint) || 0, obs: Array.isArray(j.obs) ? j.obs.slice(0, 6) : [] }; }
  catch { return null; }
}

async function runTests(prob, code) {
  const tests = problems.loadTests(prob.slug) || [];
  const r = await runner.run(code, problems.jobFor(prob, tests));
  const fails = r.results.filter((x) => !x.ok);
  const tooSlow = !r.compileError && !r.crashed && fails.length > 0 && fails.every((x) => x.timeout || x.notRun);
  const show = (x) => {
    const t = tests[x.i] || {};
    const args = t.ops ? { ops: t.ops, args: t.args } : t.args;
    return { args: JSON.stringify(args).slice(0, 300), expected: JSON.stringify(t.expected).slice(0, 200), got: x.got === undefined ? null : JSON.stringify(x.got).slice(0, 200), error: x.error || null, line: x.line || null, small: !!t.small, stdout: x.stdout ? x.stdout.slice(0, 300) : null };
  };
  // Smallest failing inputs first: they're the useful ones to talk about.
  const failing = fails.map((x) => ({ x, n: JSON.stringify(tests[x.i] ? tests[x.i].args : '').length })).sort((a, b) => a.n - b.n).slice(0, 4).map(({ x }) => show(x));
  return { ok: r.ok, passed: r.passed, total: r.total, compileError: r.compileError || null, line: r.line || null, crashed: r.crashed || null, tooSlow, failing, ms: r.ms };
}

function verdictText(v) {
  if (v.compileError) return `The code doesn't run: ${v.compileError} (line ${v.line}).`;
  if (v.ok) return `All ${v.total} hidden tests pass.`;
  if (v.tooSlow) return `Correct on all small inputs but too slow: it times out on the large inputs (${v.passed}/${v.total} pass).`;
  return `${v.passed}/${v.total} pass. Failing examples: ${v.failing.map((f) => `input ${f.args} expected ${f.expected} got ${f.error ? f.error + (f.line ? ` at line ${f.line}` : '') : f.got}`).join(' ; ')}`;
}

// ---------- SSE ----------
function writeSse(res, ev) {
  try { res.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`); } catch {}
}

// ---------- the recording ----------
function remux(id) {
  // MediaRecorder's WebM has no index, so seeking in the replay is slow or broken; ffmpeg writes one.
  const src = path.join(sdir(id), 'mic.webm');
  if (!fs.existsSync(src)) return;
  setTimeout(() => {
    const out = path.join(sdir(id), 'mic-indexed.webm');
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c', 'copy', out], { stdio: 'ignore' });
    p.on('error', () => {});
    p.on('exit', (code) => { if (code !== 0) fs.rm(out, { force: true }, () => {}); });
  }, 4000).unref();   // the last audio chunk is still on its way
}

function readRaw(req, file, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(file, { flags: 'a' });
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { req.destroy(); out.end(); reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      out.write(c);
    });
    req.on('end', () => out.end(() => resolve(size)));
    req.on('error', (e) => { out.end(); reject(e); });
  });
}

function serveFile(req, res, file, type) {
  let stat;
  try { stat = fs.statSync(file); } catch { ctx.send(res, 404, { error: 'not found' }); return; }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
}

// ---------- the debrief ----------
const DEBRIEF_SYSTEM = `You are a senior interviewer at a big tech company writing the debrief for a mock coding interview you just ran (the candidate is Matan, preparing for NVIDIA). Be honest and specific, like a real hiring-committee write-up, and constructive: the goal is to show him exactly what to practice. Cite moments with their mm:ss times. Reply with only the JSON object.`;

async function debrief(id) {
  const s = loadSession(id);
  if (!s) return;
  const prob = problems.loadProblem(s.slug);
  if (!prob) { s.debrief = { state: 'failed', error: 'problem file missing' }; saveSession(s); return; }
  s.debrief = { state: 'pending' };
  saveSession(s);
  const events = loadEvents(id);
  // The final code against the hidden tests, even if he never said done.
  let finalRun = null;
  try { finalRun = await runTests(prob, s.finalCode || prob.starter); } catch (e) { console.error('[interview] final run:', e.message); }
  const codeTimeline = events.filter((e) => e.type === 'code');
  const snapshots = codeTimeline.filter((_, i, a) => i === a.length - 1 || i % Math.ceil(a.length / 6) === 0).map((e) => `--- ${mmss(e.t)} ---\n${e.code}`);
  const lines = [];
  for (const e of events) {
    if (e.type === 'said') lines.push(`${mmss(e.t)} CANDIDATE: ${e.text}${e.interrupted ? ' (interrupting you)' : ''}`);
    else if (e.type === 'say') lines.push(`${mmss(e.t)} YOU: ${e.text}`);
    else if (e.type === 'silence') lines.push(`${mmss(e.t)} [silent for ${Math.round(e.ms / 1000)} s]`);
    else if (e.type === 'hint') lines.push(`${mmss(e.t)} [pressed the hint button]`);
    else if (e.type === 'done') lines.push(`${mmss(e.t)} [said done: ${e.passed}/${e.total} hidden tests${e.tooSlow ? ', too slow' : ''}]`);
    else if (e.type === 'board') lines.push(`${mmss(e.t)} [drew on the board]`);
  }
  const durMs = (s.endedAt || Date.now()) - s.startedAt - (s.pausedMs || 0);
  const prompt = `Problem: ${prob.title} (LeetCode ${prob.difficulty}). Optimal: ${prob.complexity.time} time, ${prob.complexity.space} space.
Statement:
${prob.statement}

Reference solution:
${prob.reference}

Interview length: ${mmss(durMs)} of 45:00 (ended: ${s.endReason || 'ended'}). Hints given: ${s.hints.length} (${s.hints.map((h) => `rung ${h.level} at ${mmss(h.t)}`).join(', ') || 'none'}).

Transcript (speech to text, may have small errors):
${lines.join('\n') || '(nothing said)'}

Your private notes during the interview:
${s.notes.map((n) => `${mmss(n.t)} [${n.area}${n.good === false ? ', concern' : n.good ? ', good' : ''}] ${n.note}`).join('\n') || '(none)'}

"Done" attempts: ${s.doneRuns.map((v) => `${mmss(v.t)}: ${verdictText(v)}`).join(' | ') || 'never said done'}
Final code against the hidden tests: ${finalRun ? verdictText(finalRun) : 'not run'}

Code as it evolved:
${snapshots.join('\n') || '(no code changes)'}

Final code:
${s.finalCode || prob.starter}

Write the debrief as JSON:
{
 "overall": "strong_hire" | "hire" | "lean_no" | "no_hire",
 "summary": "<2-3 sentences: how it went overall>",
 "scores": {
   "communication":   { "score": 1-4, "why": "<one sentence>", "evidence": [ { "t": "mm:ss", "note": "<what happened>" } ] },
   "problem_solving": { ... }, "coding": { ... }, "verification": { ... }
 },
 "timeline": [ { "t": "mm:ss", "kind": "good" | "concern" | "hint" | "info", "note": "<key moment>" } ],   (5-10 moments)
 "codeReview": { "summary": "<his final code: correct? clean?>", "yours": "O(...) time, O(...) space", "best": "${prob.complexity.time} time, ${prob.complexity.space} space", "issues": ["<bugs, style, edge cases missed>"], "better": "<the optimal idea in 1-2 sentences, if he didn't reach it>" },
 "workOn": ["<exactly 3 concrete things to practice, most important first, e.g. 'State the brute force and its complexity out loud before optimizing'>"],
 "gaps": [ { "concept": "<a DSA concept he's shaky on, if any, e.g. 'When to shrink a sliding window'>", "why": "<evidence>" } ]   (0-2; only real concept gaps, not habits)
}
Scores: 4 = strong (would pass at a top company), 3 = solid, 2 = weak, 1 = clearly lacking. Evidence: 1-3 items per area.`;
  try {
    const text = await ask(prompt, { system: DEBRIEF_SYSTEM, model: DEBRIEF_MODEL, timeoutMs: 6 * 60000 });
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const areas = ['communication', 'problem_solving', 'coding', 'verification'];
    const nums = areas.map((a) => Number(j.scores && j.scores[a] && j.scores[a].score)).filter((x) => x >= 1 && x <= 4);
    const fresh = loadSession(id) || s;
    fresh.debrief = { state: 'ready', at: Date.now(), model: DEBRIEF_MODEL, ...j };
    fresh.overallScore = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    fresh.finalRun = finalRun;
    fresh.verdict = finalRun ? { ok: finalRun.ok, passed: finalRun.passed, total: finalRun.total, tooSlow: finalRun.tooSlow } : null;
    saveSession(fresh);
    try { writeVaultNote(fresh, prob); } catch (e) { console.error('[interview] vault note:', e.message); }
    try { addGaps(fresh); } catch (e) { console.error('[interview] gaps:', e.message); }
  } catch (e) {
    const fresh = loadSession(id) || s;
    fresh.debrief = { state: 'failed', error: e.message.slice(0, 300) };
    fresh.finalRun = finalRun;
    fresh.verdict = finalRun ? { ok: finalRun.ok, passed: finalRun.passed, total: finalRun.total, tooSlow: finalRun.tooSlow } : null;
    saveSession(fresh);
    throw e;
  }
}

const OVERALL = { strong_hire: 'Strong hire', hire: 'Hire', lean_no: 'Lean no hire', no_hire: 'No hire' };
const AREA = { communication: 'Communication', problem_solving: 'Problem solving', coding: 'Coding', verification: 'Verification' };

function writeVaultNote(s, prob) {
  const d = s.debrief;
  const date = new Date(s.startedAt);
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const safe = prob.title.replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
  const v = s.verdict;
  const md = `---
date: ${ymd}
problem: "${prob.title}"
leetcode: ${prob.url}
difficulty: ${prob.difficulty}
patterns: [${prob.patterns.join(', ')}]
interviewer: ${MODELS[s.model] || s.model}
overall: ${OVERALL[d.overall] || d.overall}
tags: [interview, mock-interview]
---

# Mock interview: ${prob.title}

**${OVERALL[d.overall] || d.overall}** · ${v ? (v.ok ? `all ${v.total} hidden tests pass` : v.tooSlow ? 'correct but too slow' : `${v.passed}/${v.total} hidden tests pass`) : 'not tested'} · ${s.hints.length} hint${s.hints.length === 1 ? '' : 's'} · ${mmss((s.endedAt || s.startedAt) - s.startedAt - (s.pausedMs || 0))} · interviewer ${MODELS[s.model] || s.model}

${d.summary || ''}

## Work on
${(d.workOn || []).map((x) => `- ${x}`).join('\n')}

## Scores
${Object.entries(AREA).map(([k, name]) => { const a = (d.scores || {})[k] || {}; return `- **${name}: ${a.score || '?'}/4**. ${a.why || ''}${(a.evidence || []).map((e) => `\n  - ${e.t}: ${e.note}`).join('')}`; }).join('\n')}

## Key moments
${(d.timeline || []).map((x) => `- ${x.t} (${x.kind}) ${x.note}`).join('\n')}

## Code review
${d.codeReview ? `${d.codeReview.summary || ''}\n\n- Yours: ${d.codeReview.yours || '?'}\n- Best: ${d.codeReview.best || '?'}\n${(d.codeReview.issues || []).map((x) => `- ${x}`).join('\n')}${d.codeReview.better ? `\n\n${d.codeReview.better}` : ''}` : ''}

> [!example]- Final code
> \`\`\`python
${(s.finalCode || '').split('\n').map((l) => `> ${l}`).join('\n')}
> \`\`\`

Problem note: [[${safe}]]
`;
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  store.writeText(path.join(VAULT_DIR, `${ymd} ${safe} (${s.id.slice(-4)}).md`), md);
}

// Concept gaps from the debrief go to Study next (gaps.js). Their "question" is the interview problem,
// which isn't a quiz question, so the gap stays manual: it shows the concept and offers Teach me.
function addGaps(s) {
  const list = (s.debrief.gaps || []).filter((g) => g && g.concept).slice(0, 2);
  if (!list.length || !ctx.gaps) return;
  const all = ctx.loadQuestions();
  s.gapIds = [];
  list.forEach((g, i) => {
    const gap = ctx.gaps.addGap({
      question: { id: `interview-${s.id}-${i}`, question: `Mock interview: ${s.title}`, subject: 'DSA', topic: 'Interview' },
      text: `${g.concept}: ${g.why || ''}`.trim(), rating: null,
    }, all);
    s.gapIds.push(gap.id);
  });
  saveSession(s);
}

// ---------- home ----------
// Patterns he may have just learned: DSA topics with a finished lesson or 40%+ quiz mastery whose name
// matches a pattern he hasn't marked as known (or dismissed).
const PATTERN_WORDS = {
  'linked-list': /linked[ -]?list/i, heap: /\bheap|priority queue/i, tree: /\b(binary )?trees?\b|\bbst\b/i,
  graph: /\bgraph|\bbfs\b|\bdfs\b|breadth[- ]first|depth[- ]first|topological/i, dp: /dynamic programming|\bdp\b|memoi[sz]/i,
  backtracking: /backtrack/i, 'bit-manipulation': /\bbit(wise| manipulation|mask)/i, greedy: /\bgreedy/i,
  trie: /\btrie\b|prefix tree/i, recursion: /\brecursion|recursive/i, math: /number theory|\bprimes?\b/i,
};
function suggestions() {
  const p = problems.patterns();
  const found = new Map();
  try {
    const stats = ctx.computeStats();
    for (const t of (stats && stats.topics) || []) {
      if (t.subject !== 'DSA' || (t.mastery || 0) < 40) continue;
      for (const [k, re] of Object.entries(PATTERN_WORDS)) if (re.test(t.topic)) found.set(k, `quiz topic “${t.topic}”`);
    }
  } catch {}
  try {
    const teach = require('./teach');
    for (const l of teach.listSessions()) {
      if (!l || l.phase !== 'done') continue;
      const goal = String(l.goal || l.title || '');
      for (const [k, re] of Object.entries(PATTERN_WORDS)) if (re.test(goal) && !found.has(k)) found.set(k, `lesson “${goal.slice(0, 60)}”`);
    }
  } catch {}
  return [...found].filter(([k]) => !p.known.includes(k) && !p.dismissed.includes(k))
    .map(([k, source]) => ({ pattern: k, name: problems.PATTERNS[k], source, unlocks: problems.unlocks(k) }));
}

function sessionSummary(s) {
  return {
    id: s.id, slug: s.slug, title: s.title, difficulty: s.difficulty, patterns: s.patterns, model: s.model,
    startedAt: s.startedAt, endedAt: s.endedAt || null, state: s.state, verdict: s.verdict || null,
    overall: s.debrief && s.debrief.overall, overallScore: s.overallScore ?? null, debriefState: s.debrief ? s.debrief.state : null,
    scores: s.debrief && s.debrief.scores ? Object.fromEntries(Object.entries(s.debrief.scores).map(([k, v]) => [k, v && v.score])) : null,
    hints: s.hints.length, rating: s.rating || null,
    latency: medianFirst(s),
  };
}
function medianFirst(s) {
  const xs = (s.latency || []).filter((x) => !x.silent && x.firstMs).map((x) => x.firstMs).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
}

function home() {
  const sessions = listSessions();
  const hist = sessions.map((s) => ({ slug: s.slug, startedAt: s.startedAt, difficulty: s.difficulty, verdict: s.verdict, overallScore: s.overallScore, patterns: s.patterns }));
  const p = problems.patterns();
  const models = {};
  for (const s of sessions) {
    const m = (models[s.model] ||= { sessions: 0, latency: [], ratings: [] });
    m.sessions++;
    const l = medianFirst(s); if (l) m.latency.push(l);
    if (s.rating && s.rating.stars) m.ratings.push(s.rating.stars);
  }
  for (const m of Object.values(models)) {
    m.latency = m.latency.length ? Math.round(m.latency.sort((a, b) => a - b)[Math.floor(m.latency.length / 2)]) : null;
    m.rating = m.ratings.length ? Math.round((m.ratings.reduce((a, b) => a + b, 0) / m.ratings.length) * 10) / 10 : null;
    delete m.ratings;
  }
  // Locked patterns and what each would unlock, for "learn next".
  const next = Object.keys(problems.PATTERNS).filter((k) => !p.known.includes(k)).map((k) => ({ pattern: k, name: problems.PATTERNS[k], unlocks: problems.unlocks(k) }))
    .filter((x) => x.unlocks > 0).sort((a, b) => b.unlocks - a.unlocks);
  // Average score per area: the last 5 debriefs vs the ones before.
  const scored = sessions.filter((s) => s.debrief && s.debrief.state === 'ready' && s.debrief.scores);
  const avg = (list, k) => { const xs = list.map((s) => Number(s.debrief.scores[k] && s.debrief.scores[k].score)).filter((x) => x >= 1); return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null; };
  const trend = scored.length ? Object.fromEntries(['communication', 'problem_solving', 'coding', 'verification'].map((k) => [k, { recent: avg(scored.slice(0, 5), k), before: avg(scored.slice(5), k) }])) : null;
  return {
    trend,
    patterns: { known: p.known, all: problems.PATTERNS, next },
    suggestions: suggestions(),
    problems: problems.listForClient(hist),
    sessions: sessions.map(sessionSummary),
    models,
    modelNames: MODELS,
    engine: llm.engineFor('interview'),
    live: [...live.keys()],
  };
}

// ---------- HTTP ----------
async function handle(req, res, url, c) {
  const p = url.pathname;
  if (!p.startsWith('/api/interview')) return false;
  if (await problems.handle(req, res, url, c)) return true;
  if (req.method === 'GET' && p === '/api/interview/home') { c.send(res, 200, home()); return true; }

  if (req.method === 'POST' && p === '/api/interview/start') {
    const b = await c.readBody(req);
    const prob = problems.loadProblem(String(b.slug || ''));
    if (!prob || !problems.isReady(prob.slug)) { c.send(res, 400, { error: 'That problem isn\'t prepared yet.' }); return true; }
    // The picker sends a tier (sonnet = faster, opus = deeper); on Gemini it means Flash / Pro.
    const engine = llm.engineFor('interview');
    if (!llm.engineStatus(engine).ok) { c.send(res, 503, { error: llm.engineStatus(engine).why }); return true; }
    const model = modelKey(b.model === 'opus' ? 'opus' : 'sonnet', engine);
    const voice = b.voice === 'elevenlabs' ? { engine: 'elevenlabs' } : { engine: 'local', voice: /^[ab][fm]_[a-z]{2,20}$/.test(String(b.voice || '')) ? b.voice : null };
    // One call at a time: a new one ends any other.
    for (const l of live.values()) l.end('replaced by a new interview');
    const id = `iv-${Date.now().toString(36)}`;
    fs.mkdirSync(sdir(id), { recursive: true });
    const s = {
      id, slug: prob.slug, title: prob.title, difficulty: prob.difficulty, patterns: prob.patterns, model, engine,
      startedAt: Date.now(), durationMs: DURATION_MS, state: 'live', stage: 'intro', voice, pausedMs: 0,
      hints: [], notes: [], doneRuns: [], transcript: [], latency: [], debrief: null,
    };
    saveSession(s);
    const l = new Live(s, prob);
    live.set(id, l);
    logEvent(id, { t: 0, type: 'start', model, slug: prob.slug });
    l.push('[START] The candidate just joined the call. Greet them in one sentence, then introduce the problem in one or two sentences (the full statement is on their screen) and invite questions.', true);
    problems.topUp();   // the next problems get prepared while this one runs
    c.send(res, 200, { session: { id, startedAt: s.startedAt, durationMs: DURATION_MS, model, voice, pausedMs: 0 }, problem: problems.publicView(prob), serverNow: Date.now() });
    return true;
  }

  const m = p.match(/^\/api\/interview\/(iv-[a-z0-9]+)(?:\/([a-z-]+))?(?:\/(\d+)\.png)?$/);
  if (!m) return false;
  const [, id, action, n] = m;
  const l = live.get(id);

  if (req.method === 'GET' && action === 'stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (!l) { writeSse(res, { id: 0, type: 'ended', data: { reason: 'not live' } }); res.end(); return true; }
    const last = Number(req.headers['last-event-id'] || 0);
    for (const ev of l.history) if (ev.id > last) writeSse(res, ev);
    l.clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
    req.on('close', () => { clearInterval(ping); l.clients.delete(res); });
    return true;
  }

  if (req.method === 'POST' && action === 'event') {
    if (!l) { c.send(res, 409, { error: 'This interview has ended.' }); return true; }
    const b = await c.readBody(req);
    if (l.paused && !['spoke', 'mic', 'code'].includes(b.type)) { c.send(res, 409, { error: 'The interview is paused.' }); return true; }
    const t = Number.isFinite(b.t) ? Math.max(0, Math.min(b.t, l.t() + 5000)) : l.t();
    switch (b.type) {
      case 'said': {
        const text = String(b.text || '').trim().slice(0, 4000);
        if (!text) break;
        l.lastActivity = Date.now();
        l.s.transcript.push({ t, who: 'me', text });
        logEvent(id, { t, type: 'said', text, interrupted: b.interrupted || null, dur: b.dur || null });
        if (b.interrupted && b.interrupted.heard !== undefined) l.inbox.push(`[INTERRUPTED] They cut you off. They heard: "${String(b.interrupted.heard).slice(-400)}"${b.interrupted.unheard ? ` (${b.interrupted.unheard} of your sentences went unsaid)` : ''}.`);
        // "I'm done": the interviewer hears it together with the test results.
        if (DONE_RE.test(text) && !l.running) { l.inbox.push(`[SAID] (${mmss(t)}) ${text}`); l.done('said'); }
        else l.push(`[SAID] (${mmss(t)}) ${text}`, true);
        break;
      }
      case 'code':
        if (typeof b.code === 'string' && b.code !== l.code) {
          l.code = b.code.slice(0, 50000);
          l.lastActivity = Date.now();
          logEvent(id, { t, type: 'code', code: l.code });
        }
        break;
      case 'board': {
        if (typeof b.desc === 'string') { l.board = b.desc; l.lastActivity = Date.now(); }
        let file = null;
        if (typeof b.png === 'string' && b.png.startsWith('data:image/png;base64,')) {
          const data = b.png.slice(22);
          const k = (l.s.boards = (l.s.boards || 0) + 1);
          file = `${k}.png`;
          fs.writeFileSync(path.join(sdir(id), `board-${k}.png`), Buffer.from(data, 'base64'));
          if (b.freehand) l.boardPng = data;
        }
        logEvent(id, { t, type: 'board', desc: b.desc ? String(b.desc).slice(0, 20000) : null, file });
        saveSession(l.s);
        break;
      }
      case 'hint':
        logEvent(id, { t, type: 'hint' });
        l.push('[HINT REQUEST] They pressed the hint button. Give the next hint rung, briefly.', true);
        break;
      case 'done':
        l.done('button');
        break;
      case 'spoke':
        logEvent(id, { t, type: 'spoke', turn: b.turn, seq: b.seq });
        break;
      case 'mic':
        l.s.micStartT = t; saveSession(l.s);
        logEvent(id, { t, type: 'mic' });
        break;
      default:
        c.send(res, 400, { error: 'unknown event' }); return true;
    }
    c.send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && action === 'audio') {
    const s = loadSession(id);
    if (!s) { c.send(res, 404, { error: 'not found' }); return true; }
    const file = path.join(sdir(id), 'mic.webm');
    let have = 0; try { have = fs.statSync(file).size; } catch {}
    await readRaw(req, file, MAX_AUDIO_BYTES - have);
    c.send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && action === 'pause') {
    const b = await c.readBody(req);
    if (!l) { c.send(res, 409, { error: 'This interview has ended.' }); return true; }
    l.pause(!!b.paused);
    c.send(res, 200, { ...l.stateView(), serverNow: Date.now() });
    return true;
  }

  if (req.method === 'POST' && action === 'end') {
    const b = await c.readBody(req);
    if (l) l.end(String(b.reason || 'ended by you').slice(0, 60));
    c.send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && action === 'rate') {
    const b = await c.readBody(req);
    const s = loadSession(id);
    if (!s) { c.send(res, 404, { error: 'not found' }); return true; }
    s.rating = { stars: Math.max(1, Math.min(5, Number(b.stars) || 0)), note: String(b.note || '').slice(0, 500), at: Date.now() };
    saveSession(s);
    c.send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && action === 'redebrief') {
    const s = loadSession(id);
    if (!s || s.state !== 'ended') { c.send(res, 400, { error: 'not ended' }); return true; }
    debrief(id).catch(() => {});
    c.send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && action === 'delete') {
    if (l) l.end('deleted');
    setTimeout(() => fs.rm(sdir(id), { recursive: true, force: true }, () => {}), l ? 2500 : 0);
    c.send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && action === 'audio') {
    const fixed = path.join(sdir(id), 'mic-indexed.webm');
    serveFile(req, res, fs.existsSync(fixed) ? fixed : path.join(sdir(id), 'mic.webm'), 'audio/webm');
    return true;
  }
  if (req.method === 'GET' && action === 'board' && n) {
    serveFile(req, res, path.join(sdir(id), `board-${n}.png`), 'image/png');
    return true;
  }
  if (req.method === 'GET' && !action) {
    const s = loadSession(id);
    if (!s) { c.send(res, 404, { error: 'not found' }); return true; }
    const prob = problems.loadProblem(s.slug);
    const hasAudio = fs.existsSync(path.join(sdir(id), 'mic.webm'));
    c.send(res, 200, {
      session: s, events: loadEvents(id), hasAudio, live: !!l, serverNow: Date.now(),
      liveTurn: l ? l.turn : 0, liveCode: l ? l.code : null, livePaused: l ? l.paused : false,
      livePausedMs: l ? l.s.pausedMs + (l.paused ? Date.now() - l.pausedAt : 0) : 0,
      problem: prob ? { ...problems.publicView(prob), url: prob.url, complexity: prob.complexity, reference: s.state === 'ended' ? prob.reference : null } : null,
    });
    return true;
  }
  return false;
}

module.exports = { init, handle, home, listSessions, loadSession, runTests, verdictText, parseNotes, sentences, debrief, DONE_RE };
