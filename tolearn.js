// 📚 To Learn: lists of things to learn, each item one click from a Teach lesson.
// Paste a raw list (e.g. an agent's "what you need to know to explain X") and Claude turns it into
// sections of short items: duplicates merged, learning order kept, and each item matched against the
// study notes and finished lessons you already have ("have" = covered, "partial" = partly covered).
//
// Data: data/tolearn.json  { lists: [{ id, title, goal, created, updated, state, error, source,
//   items: [{ id, section, title, detail, subject, step, status, have, session }] }] }
//   status: todo | have | skip | done   (a linked lesson's progress is read live from teach.js)
//
// Endpoints:
//   GET  /api/tolearn                      → { lists, subjects, available }
//   POST /api/tolearn/import {text,title?}  → the new list (state 'organizing'; Claude runs in the background)
//   POST /api/tolearn/<list>/retry          → organize again from the saved source text
//   POST /api/tolearn/<list>/update {title?, goal?}
//   POST /api/tolearn/<list>/delete
//   POST /api/tolearn/<list>/add {title, detail?, section?}
//   POST /api/tolearn/<list>/item/<item> {status?, title?, detail?, delete?}
// Saving from a lesson (the selection toolbar and the teacher's "save for later" chips in ui/teach.js):
//   GET  /api/tolearn/capture?lesson=<id>  → { lists: [{id, title}], defaultList: id | 'new', newTitle }
//   POST /api/tolearn/capture/suggest {text, lessonId, turn?} → { title, detail } (Claude names it)
//   POST /api/tolearn/capture {lessonId, turn?, text?, title?, detail?, why?, kind?, listId? | newListTitle?, refine?}
//     → { item, list: {id, title}, captures }  the item gets
//     origin: { lessonId, lessonGoal, subject, quote, why, turn, kind: 'selection' | 'later', ts }
//     and the lesson remembers it in s.captures (teach.js addCapture), so its marks survive a reload.
// Teach links an item to its lesson with attach() (body.toLearn on /api/teach/start).
const fs = require('fs');
const store = require('./store');
const path = require('path');
const crypto = require('crypto');

let ctx = null;
let FILE = null;
const STATUSES = ['todo', 'have', 'skip', 'done'];
const running = new Set();
const CAPTURE_LIST = 'From lessons';        // the list captures go to when no list fits the lesson
const CAPTURE_SECTION = 'Saved from lessons';

const SYSTEM_PROMPT = `You organize a learner's "things to learn" list for a personal learning app. Each item will become the goal of one tutoring lesson, so items must be concrete, teachable in one sitting (20-40 minutes), and phrased as what he should understand.

Input: <raw_list> (pasted text: often from another AI, may repeat sections, be badly formatted, or mix ideas with reading material), <his_notes> (study notes he already wrote, with their section headings and quiz mastery 0-100, null = no quiz yet) and <finished_lessons>.

Do this:
- Keep the source's sections and its learning order. If it gives a "suggested order", use that order for "step" (1 = learn first). Otherwise step follows the list order.
- Merge duplicates (pasted lists often repeat whole blocks). Never invent topics that aren't in the list, and don't drop real ones.
- Split an item only when it holds two unrelated ideas; merge tiny items that can't stand alone as a lesson.
- title: at most 70 characters, plain words, no numbering. detail: one or two sentences keeping the source's specifics (numbers, names, why it matters for the goal). Keep his project-specific context (e.g. "our handler waits ~220 ms on the DB") because it makes the lesson concrete.
- Reading/measuring items (docs, source code, talks, dashboards) are fine: keep them as items, phrased as what to learn from them.
- subject: the best matching folder from <subjects>, or null when none fits.
- have: compare against <his_notes> and <finished_lessons>. "covered" only when a note or lesson clearly teaches that exact idea at the needed depth. "partial" when it touches it but misses the specific point. null otherwise. Mastery under 40 means he wrote the note but doesn't hold it yet: say so in why. Be strict; a vaguely related note is not "partial".
- title of the list: short (at most 6 words). goal: the end target in one sentence (the "explain it like a professor" sentence if the source has one), else null.

Reply with ONLY a JSON object:
{"title": "...", "goal": "..." | null, "sections": [{"title": "...", "items": [{"title": "...", "detail": "...", "subject": "..." | null, "step": 1, "have": null | {"kind": "covered" | "partial", "note": "exact note title or lesson goal", "why": "one short sentence"}}]}]}`;

const CAPTURE_PROMPT = `In a tutoring lesson the learner selected a passage of the teacher's reply to learn it properly later. Turn it into one item for his "to learn" list.
- title: at most 70 characters, a clear topic name for a future lesson, in plain words (e.g. "How Go's runtime handles blocking syscalls (M:N threading)"). Name the idea itself, not "the passage" or "this part". Keep the specific names, systems and terms from the passage.
- detail: one or two sentences that keep the context: what lesson it came up in and what the teacher said or skipped about it, so a later lesson knows why he saved it.
Reply with ONLY a JSON object: {"title": "...", "detail": "..."}`;

function init(c) {
  ctx = c;
  FILE = path.join(ctx.DATA_DIR, 'tolearn.json');
  // A server restart cut off an organize run: start it again.
  setTimeout(() => {
    for (const l of load().lists) if (l.state === 'organizing') organize(l.id).catch(() => {});
  }, 1500).unref();
}

function load() {
  const d = store.readJson(FILE, null);
  if (d && Array.isArray(d.lists)) return d;
  return { lists: [] };
}
function save(d) {
  store.writeJson(FILE, d);
}
// Read, change, write in one step (Node is single-threaded, so nothing interleaves between them).
function mutate(fn) {
  const d = load();
  const out = fn(d);
  save(d);
  return out;
}
const now = () => new Date().toISOString();
const newId = (p) => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const err = (msg, status) => Object.assign(new Error(msg), { status });

function subjects() {
  return fs.readdirSync(ctx.LEARNING_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !/^[_.]/.test(d.name)).map((d) => d.name).sort();
}

function teach() { try { return require('./teach'); } catch { return null; } }
function lessons() {
  const t = teach();
  try { return t && t.listSessions ? t.listSessions() : []; } catch { return []; }
}

// What he already has: notes (with headings and mastery) and finished lessons.
function catalog() {
  let notes = [];
  try {
    const map = require('./topicmap').mapFor(ctx);
    const byTitle = new Map(map.nodes.map((n) => [n.title, n]));
    notes = require('./topicmap').scanNotes().notes.map((n) => ({
      title: n.title, subject: n.subject, headings: n.headings.slice(0, 14),
      mastery: byTitle.get(n.title) ? byTitle.get(n.title).stats.mastery : null,
    }));
  } catch (e) { console.error('[tolearn] notes', e.message); }
  const done = lessons().filter((s) => s.phase === 'done').map((s) => s.goal);
  return { notes, done };
}

// A note counts as "have" only once its quiz shows it's held (no quiz yet = trust the note).
const SOLID = 40;
function solid(notes, title) {
  const n = notes.find((x) => x.title === title);
  return !n || n.mastery == null || n.mastery >= SOLID;
}
function masteryByNote() {
  try {
    return new Map(require('./topicmap').mapFor(ctx).nodes.map((n) => [n.title, n.stats.mastery]));
  } catch { return new Map(); }
}

async function organize(listId) {
  if (running.has(listId)) return;
  const list = load().lists.find((l) => l.id === listId);
  if (!list) return;
  running.add(listId);
  try {
    if (!ctx.ai.isAvailable()) throw new Error(ctx.ai.unavailableReason());
    const { notes, done } = catalog();
    const prompt = [
      `<subjects>${subjects().join(', ')}</subjects>`,
      `<his_notes>\n${notes.map((n) => `- "${n.title}" (${n.subject}, mastery ${n.mastery == null ? 'null' : n.mastery}): ${n.headings.join(' · ')}`).join('\n') || '(none)'}\n</his_notes>`,
      `<finished_lessons>\n${done.map((g) => `- ${g}`).join('\n') || '(none)'}\n</finished_lessons>`,
      list.title ? `<his_title>${list.title}</his_title>` : '',
      `<raw_list>\n${list.source}\n</raw_list>`,
    ].filter(Boolean).join('\n\n');
    const out = ctx.ai.extractJson(await ctx.ai.askOnce(prompt, SYSTEM_PROMPT));
    if (!out || !Array.isArray(out.sections)) throw new Error('The AI returned no sections');
    const known = new Set([...notes.map((n) => n.title), ...done]);
    const subs = new Set(subjects());
    const items = [];
    for (const sec of out.sections) {
      for (const it of Array.isArray(sec.items) ? sec.items : []) {
        const title = clean(it.title, 120);
        if (!title) continue;
        const h = it.have && known.has(String(it.have.note)) && ['covered', 'partial'].includes(it.have.kind)
          ? { kind: it.have.kind, note: String(it.have.note), why: clean(it.have.why, 300) } : null;
        items.push({
          id: `i${items.length + 1}`, section: clean(sec.title, 100) || 'Items', title, detail: clean(it.detail, 600),
          subject: subs.has(it.subject) ? it.subject : null, step: Number(it.step) || items.length + 1,
          status: h && h.kind === 'covered' && solid(notes, h.note) ? 'have' : 'todo', have: h, session: null,
        });
      }
    }
    if (!items.length) throw new Error('The AI found no items in that text');
    mutate((d) => {
      const l = d.lists.find((x) => x.id === listId);
      if (!l) return;
      Object.assign(l, { items, state: 'ready', error: null, updated: now() });
      if (!l.titleSet) l.title = clean(out.title, 80) || l.title || 'To learn';
      if (!l.goal) l.goal = out.goal ? clean(out.goal, 800) : null;
    });
  } catch (e) {
    console.error('[tolearn] organize', e.message);
    mutate((d) => { const l = d.lists.find((x) => x.id === listId); if (l) Object.assign(l, { state: 'error', error: e.message, updated: now() }); });
  } finally { running.delete(listId); }
}

// The list as the browser sees it: each item's lesson progress is read from the lesson itself.
function forClient(l, sessions, mastery = new Map()) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const items = (l.items || []).map((it) => {
    const s = it.session && byId.get(it.session);
    const lesson = s ? { id: s.id, phase: s.phase, busy: s.busy, steps: s.steps, updated: s.updated } : null;
    // A finished lesson finishes the item, unless he moved it back himself.
    const status = lesson && lesson.phase === 'done' && it.status === 'todo' && !it.reopened ? 'done' : it.status;
    const have = it.have ? { ...it.have, isNote: mastery.has(it.have.note), mastery: mastery.has(it.have.note) ? mastery.get(it.have.note) : null } : null;
    // A capture's lesson may be deleted since; the link then stays as plain text.
    const origin = it.origin ? { ...it.origin, lessonExists: byId.has(it.origin.lessonId) } : null;
    return { ...it, status, lesson, have, origin };
  });
  const counted = items.filter((x) => x.status !== 'skip');
  return {
    id: l.id, kind: l.kind || null, title: l.title, goal: l.goal, created: l.created, updated: l.updated, state: l.state, error: l.error,
    organizing: running.has(l.id), items,
    progress: { total: counted.length, done: counted.filter((x) => x.status === 'done' || x.status === 'have').length },
  };
}

function lists() {
  const sessions = lessons();
  const mastery = masteryByNote();
  return load().lists.map((l) => forClient(l, sessions, mastery));
}

// Teach calls this when a lesson starts from an item, so the item shows "Continue".
function attach(listId, itemId, sessionId) {
  mutate((d) => {
    const it = d.lists.find((l) => l.id === listId)?.items.find((x) => x.id === itemId);
    if (it) { it.session = sessionId; if (it.status !== 'todo') it.status = 'todo'; delete it.reopened; }
  });
}

// A captured item: where it came from, so the new lesson builds on what that lesson already covered.
function originLine(o) {
  return `He saved this item during an earlier lesson, "${o.lessonGoal}"${o.subject ? ` (${o.subject})` : ''}. ` +
    (o.quote ? `He selected this from that teacher's reply: "${o.quote}" ` : '') +
    (o.why ? `That teacher deferred it: ${o.why.replace(/[.\s]+$/, '')}. ` : '') +
    `So he knows that lesson's context; this lesson goes into what it left out.\n`;
}

// What the teacher should know about the item's list: the end goal, where this item sits, what he has.
function contextFor(listId, itemId) {
  const l = load().lists.find((x) => x.id === listId);
  const it = l && l.items.find((x) => x.id === itemId);
  if (!it) return null;
  const sorted = [...l.items].sort((a, b) => a.step - b.step);
  const mark = (x) => (x.id === it.id ? '→ ' : x.status === 'have' || x.status === 'done' ? '✓ ' : x.status === 'skip' ? '– ' : '  ');
  return `<learning_list title="${l.title}">\n` +
    (l.goal ? `His end goal for the whole list: ${l.goal}\n` : '') +
    (l.kind === 'captures' ? `This lesson is one item of that list (things he saved during other lessons). Teach THIS item only.\n`
      : `This lesson is one item of that list. Teach THIS item only, at the depth the end goal needs; tie it to the end goal where it helps, and leave the other items to their own lessons.\n`) +
    `This item: ${it.title}${it.detail ? `: ${it.detail}` : ''}\n` +
    (it.origin ? originLine(it.origin) : '') +
    (it.have ? `He may partly have this already (${it.have.kind}: ${it.have.why} — note "${it.have.note}"); probe it instead of assuming.\n` : '') +
    // A list of saved-from-lessons items is a pile, not a learning path: no order to show.
    (l.kind === 'captures' ? '' : `The list in learning order (✓ = he has it, → = this lesson, – = skipped):\n` +
      sorted.map((x) => `${mark(x)}${x.step}. [${x.section}] ${x.title}`).join('\n') + '\n') +
    `</learning_list>`;
}

// ---------- saving from a lesson ----------

// The lesson a capture comes from (teach.js), or a 404.
function lessonOf(id) {
  const t = teach();
  const s = t && t.loadSession && t.loadSession(String(id || ''));
  if (!s) throw err('lesson not found', 404);
  return s;
}

// Where a capture goes by default: the list the lesson started from, else the "From lessons" list
// (made on the first save). Matching by subject put captures into unrelated lists, so it's not used.
function defaultList(d, s) {
  const src = s.source || {};
  if (src.type === 'tolearn' && d.lists.some((l) => l.id === src.list)) return src.list;
  const own = d.lists.find((l) => l.kind === 'captures');
  return own ? own.id : 'new';
}

// The teacher reply a capture sits in (its prose, for Claude's context).
function turnText(s, turn) {
  const t = Number.isInteger(turn) ? s.turns[turn] : null;
  return t && t.role === 'teacher' ? String(t.say || '') : '';
}

async function suggest(text, s, turn) {
  const prompt = [
    `<lesson goal="${clean(s.goal, 300)}"${s.subject ? ` subject="${s.subject}"` : ''}></lesson>`,
    turnText(s, turn) ? `<teacher_reply>\n${turnText(s, turn).slice(0, 4000)}\n</teacher_reply>` : '',
    `<selected>\n${text}\n</selected>`,
  ].filter(Boolean).join('\n\n');
  const out = ctx.ai.extractJson(await ctx.ai.askOnce(prompt, CAPTURE_PROMPT));
  const title = clean(out && out.title, 90);
  if (!title) throw new Error('The AI returned no title');
  return { title, detail: clean(out.detail, 600) };
}

// Raw selected text as a fallback title: first sentence-ish, trimmed to 70 characters.
function rawTitle(text) {
  const t = clean(text, 400).replace(/^[>"“'\s]+|["”'\s]+$/g, '');
  return t.length <= 70 ? t : t.slice(0, 69).replace(/\s+\S*$/, '') + '…';
}

function capture(body) {
  const s = lessonOf(body.lessonId);
  const kind = body.kind === 'later' ? 'later' : 'selection';
  const quote = kind === 'selection' ? String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
  const title = clean(body.title, 120) || rawTitle(quote);
  if (!title) throw err('Nothing to save', 400);
  const turn = Number.isInteger(body.turn) && s.turns[body.turn] ? body.turn : null;
  const origin = { lessonId: s.id, lessonGoal: clean(s.goal, 300), subject: s.subject || null, quote: quote || null,
    why: clean(body.why, 400) || null, turn, kind, ts: now() };
  const detail = clean(body.detail, 600) || [origin.why, `Came up in the lesson “${origin.lessonGoal}”.`].filter(Boolean).join(' ');
  const subs = new Set(subjects());
  const out = mutate((d) => {
    const want = body.listId || defaultList(d, s);   // no list given (a "later" chip): the default one
    let l = want !== 'new' ? d.lists.find((x) => x.id === want) : null;
    if (want !== 'new' && !l) throw err('list not found', 404);
    if (!l) {
      const name = clean(body.newListTitle, 80) || CAPTURE_LIST;
      l = d.lists.find((x) => x.kind === 'captures' && x.title === name);
      if (!l) {
        l = { id: newId('l'), kind: 'captures', title: name, titleSet: true, goal: null, created: now(), updated: now(),
          state: 'ready', error: null, source: '', items: [] };
        d.lists.unshift(l);
      }
    }
    const n = l.items.reduce((mx, x) => Math.max(mx, Number(String(x.id).slice(1)) || 0), 0) + 1;
    const step = l.items.reduce((mx, x) => Math.max(mx, x.step || 0), 0) + 1;
    const it = { id: `i${n}`, section: l.kind === 'captures' ? (s.subject || 'Saved') : CAPTURE_SECTION, title, detail,
      subject: subs.has(s.subject) ? s.subject : null, step, status: 'todo', have: null, session: null, origin };
    l.items.push(it);
    l.updated = now();
    return { item: it, list: { id: l.id, title: l.title } };
  });
  const t = teach();
  const captures = t && t.addCapture ? t.addCapture(s.id, { turn, quote: quote || null, later: kind === 'later' ? title : null,
    title, itemId: out.item.id, listId: out.list.id, ts: origin.ts }) : [];
  // Saved before Claude named it: name it now, unless he edits it first.
  if (body.refine && quote && ctx.ai.isAvailable()) {
    suggest(quote, s, turn).then((sg) => mutate((d) => {
      const it = d.lists.find((l) => l.id === out.list.id)?.items.find((x) => x.id === out.item.id);
      if (it && it.title === title) { it.title = sg.title; if (sg.detail) it.detail = sg.detail; }
    })).catch((e) => console.error('[tolearn] refine', e.message));
  }
  return { ...out, captures };
}

async function handle(req, res, url, c) {
  ctx = ctx || c;
  const p = url.pathname;
  if (!p.startsWith('/api/tolearn')) return false;
  const send = ctx.send;
  try {
    if (req.method === 'GET' && p === '/api/tolearn') {
      return send(res, 200, { lists: lists(), subjects: subjects(), available: ctx.ai.isAvailable() }), true;
    }
    if (req.method === 'GET' && p === '/api/tolearn/capture') {
      const s = lessonOf(url.searchParams.get('lesson'));
      const d = load();
      const def = defaultList(d, s);
      return send(res, 200, { lists: d.lists.filter((l) => l.state === 'ready').map((l) => ({ id: l.id, title: l.title })),
        defaultList: def, newTitle: CAPTURE_LIST }), true;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    const body = await ctx.readBody(req).catch(() => { throw err('invalid JSON body', 400); }) || {};

    if (p === '/api/tolearn/capture/suggest') {
      const text = String(body.text || '').trim().slice(0, 3000);
      if (text.length < 2) throw err('Select some text first', 400);
      if (!ctx.ai.isAvailable()) throw err(ctx.ai.unavailableReason(), 503);
      const s = lessonOf(body.lessonId);
      return send(res, 200, await suggest(text, s, Number.isInteger(body.turn) ? body.turn : null)), true;
    }
    if (p === '/api/tolearn/capture') return send(res, 200, capture(body)), true;

    if (p === '/api/tolearn/import') {
      const text = String(body.text || '').trim().slice(0, 60000);
      if (text.length < 3) throw err('Paste the list first', 400);
      if (!ctx.ai.isAvailable()) throw err(ctx.ai.unavailableReason(), 503);
      const title = clean(body.title, 80);
      const l = { id: newId('l'), title: title || 'New list', titleSet: !!title, goal: null, created: now(), updated: now(),
        state: 'organizing', error: null, source: text, items: [] };
      mutate((d) => { d.lists.unshift(l); });
      organize(l.id).catch(() => {});
      return send(res, 200, forClient(l, [])), true;
    }

    const m = p.match(/^\/api\/tolearn\/([\w-]+)\/([a-z]+)(?:\/([\w-]+))?$/);
    if (!m) throw err('not found', 404);
    const [, listId, action, itemId] = m;
    if (!load().lists.some((l) => l.id === listId)) throw err('list not found', 404);

    if (action === 'retry') {
      if (!load().lists.find((l) => l.id === listId).source) throw err('This list has no pasted text to organize', 400);
      mutate((d) => { Object.assign(d.lists.find((l) => l.id === listId), { state: 'organizing', error: null }); });
      organize(listId).catch(() => {});
    } else if (action === 'delete') {
      mutate((d) => { d.lists = d.lists.filter((l) => l.id !== listId); });
      return send(res, 200, { ok: true }), true;
    } else if (action === 'update') {
      mutate((d) => {
        const l = d.lists.find((x) => x.id === listId);
        if (body.title != null && clean(body.title, 80)) { l.title = clean(body.title, 80); l.titleSet = true; }
        if (body.goal !== undefined) l.goal = clean(body.goal, 800) || null;
        l.updated = now();
      });
    } else if (action === 'add') {
      const title = clean(body.title, 120);
      if (!title) throw err('Write the item first', 400);
      mutate((d) => {
        const l = d.lists.find((x) => x.id === listId);
        const n = l.items.reduce((mx, x) => Math.max(mx, Number(x.id.slice(1)) || 0), 0) + 1;
        const step = l.items.reduce((mx, x) => Math.max(mx, x.step), 0) + 1;
        const section = clean(body.section, 100) || (l.items.length ? l.items[l.items.length - 1].section : 'Items');
        l.items.push({ id: `i${n}`, section, title, detail: clean(body.detail, 600), subject: null, step, status: 'todo', have: null, session: null });
        l.updated = now();
      });
    } else if (action === 'item' && itemId) {
      mutate((d) => {
        const l = d.lists.find((x) => x.id === listId);
        const it = l.items.find((x) => x.id === itemId);
        if (!it) throw err('item not found', 404);
        if (body.delete) l.items = l.items.filter((x) => x !== it);
        else {
          if (body.status !== undefined) {
            if (!STATUSES.includes(body.status)) throw err('bad status', 400);
            // Moving a finished lesson's item back to "to learn" sticks.
            if (body.status === 'todo') it.reopened = true; else delete it.reopened;
            it.status = body.status;
          }
          if (body.title != null && clean(body.title, 120)) it.title = clean(body.title, 120);
          if (body.detail != null) it.detail = clean(body.detail, 600);
        }
        l.updated = now();
      });
    } else throw err('not found', 404);

    const l = load().lists.find((x) => x.id === listId);
    return send(res, 200, forClient(l, lessons(), masteryByNote())), true;
  } catch (e) {
    if (!e.status) console.error('[tolearn]', e);
    return send(res, e.status || 500, { error: e.message }), true;
  }
}

module.exports = { init, handle, attach, contextFor, lists };
