// 🗺 Topic map: one node per study note, arrows = "understand this first".
// Edges come from three places:
//   - the learner's own [[wikilinks]] between notes          → kind 'link'  (no direction implied, drawn dotted)
//   - the reading order of "… - Study Path" hub notes        → kind 'prereq', source 'path'
//   - prerequisites Claude infers from the notes' content    → kind 'prereq', source 'claude', with a one-line why
// Claude's edges are cached in data/topic-map.json with a fingerprint of the note set, so Claude only runs
// again when notes are added/changed (or on POST /api/map/rebuild). GET never waits for Claude.
//
// Endpoints:
//   GET  /api/map                → { nodes, edges, frontier, building, startedAt, cancellable, builtAt, aiAvailable, error, solidAt }
//   POST /api/map/rebuild        → starts a background rebuild, replies { building: true }
//   POST /api/map/rebuild/cancel → stops the running build (kills the claude process); the previous edges stay

const fs = require('fs');
const store = require('./store');
const path = require('path');

// QUIZ_MAP_CACHE lets a test server use a scratch copy instead of the real cache.
const CACHE_FILE = process.env.QUIZ_MAP_CACHE || path.join(__dirname, 'data', 'topic-map.json');
const { LEARNING_DIR, posixRel } = require('./config');   // QUIZ_LEARNING_DIR, else the folder above _quiz
const VAULT_DIR = path.resolve(LEARNING_DIR, '..');
const VAULT_NAME = process.env.QUIZ_VAULT || path.basename(VAULT_DIR);

// Files in a subject folder that aren't study notes (logs, todo lists, generated dashboards).
const NOT_NOTES = /^(goal log|todo|readme|quiz progress|index)$/i;
// "Solid" = average Leitner box ≥ 2 of 5, i.e. every question recalled well on two separate days.
// Good enough to build on; full mastery (box 4-5) takes weeks of spacing and shouldn't block new topics.
const SOLID = 40;
const RETRY_FAILED_MS = 10 * 60 * 1000;   // a failed Claude build is retried at most every 10 minutes
const EXCERPT = 800;

let building = null;      // the running background build: { promise, controller, startedAt }
let lastFail = null;      // { fingerprint, at, error }
// The learner stopped a build: don't start another automatically until the notes change again
// (or they ask for one). Otherwise the next GET would start right back up.
let cancelledFingerprint = null;

// ---------- reading the vault ----------

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
}

// Note body without frontmatter, code blocks, inline code and raw HTML/SVG: what's left is prose and
// real [[links]] (bash's `[[ -f $f ]]` lives in code and must not count as a link).
function cleanBody(text) {
  return text.replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/<[^>\n]+>/g, '');
}

function wikilinks(body) {
  // [[Target|alias]] / [[Target#Heading]] → Target
  return [...body.matchAll(/\[\[([^\]\n]+?)\]\]/g)].map((m) => m[1].split('|')[0].split('#')[0].trim()).filter(Boolean);
}

// Every .md directly in Learning/<Subject>/. Study Path notes come back as hubs, not notes.
function scanNotes() {
  const notes = [], hubs = [];
  for (const d of (fs.existsSync(LEARNING_DIR) ? fs.readdirSync(LEARNING_DIR, { withFileTypes: true }) : [])) {
    if (!d.isDirectory() || /^[_.]/.test(d.name)) continue;
    const dir = path.join(LEARNING_DIR, d.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const title = f.replace(/\.md$/, '');
      if (NOT_NOTES.test(title)) continue;
      const file = path.join(dir, f);
      const raw = fs.readFileSync(file, 'utf8');
      const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
      const body = cleanBody(raw);
      const item = {
        title, subject: d.name, file: `${d.name}/${f}`, size: raw.length,
        headings: [...body.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim()),
        body,
      };
      if (/ - Study Path$/i.test(title) || /^tags:.*\bhub\b/m.test(fm)) hubs.push(item);
      else notes.push(item);
    }
  }
  return { notes, hubs };
}

// Question topic → the note its file names with "Source note: [[Title]]" (same rule as ai-grader.js).
function topicSources(questions) {
  const out = {};
  for (const q of questions) {
    const key = `${q.subject} / ${q.topic}`;
    if (key in out) continue;
    try {
      const m = fs.readFileSync(path.join(LEARNING_DIR, q.file), 'utf8').match(/Source note:\s*\[\[([^\]|#]+)/);
      out[key] = { subject: q.subject, topic: q.topic, file: q.file, note: m ? m[1].trim() : null };
    } catch { out[key] = { subject: q.subject, topic: q.topic, file: q.file, note: null }; }
  }
  return out;
}

function obsidianUrl(relFile) {
  const rel = posixRel(VAULT_DIR, path.join(LEARNING_DIR, relFile)).replace(/\.md$/, '');
  return `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(rel)}`;
}

function fingerprintOf(notes) {
  return notes.map((n) => `${n.subject}/${n.title}:${n.size}`).sort().join('|');
}

// ---------- the graph (without Claude) ----------

// Nodes + a name resolver. Question topics whose note is missing (e.g. "Dynamic Arrays") still get a
// node, so every question is somewhere on the map; their link opens the Questions file instead.
function baseGraph(ctx) {
  const { notes, hubs } = scanNotes();
  const sources = topicSources(ctx.loadQuestions());
  const nodes = [];
  const byName = new Map();     // lowercase note title or quiz-topic name → node
  const used = new Set();
  const addNode = (n) => {
    let id = slug(n.title);
    while (used.has(id)) id += '-2';
    used.add(id);
    const node = { id, ...n, topics: [] };
    nodes.push(node);
    byName.set(n.title.toLowerCase(), node);
    return node;
  };
  for (const n of notes) addNode(n);
  for (const [key, s] of Object.entries(sources)) {
    let node = s.note && byName.get(s.note.toLowerCase());
    if (!node) node = byName.get(s.topic.toLowerCase()) || addNode({ title: s.topic, subject: s.subject, file: s.file, size: 0, headings: [], body: '', topicOnly: true });
    node.topics.push(key);
    if (!byName.has(s.topic.toLowerCase())) byName.set(s.topic.toLowerCase(), node);   // [[Process API]] → its note
  }
  const resolve = (name) => byName.get(name.toLowerCase()) || null;

  // Wikilinks between notes: one edge per pair, from the note that links.
  const links = new Map();
  for (const n of nodes) for (const t of wikilinks(n.body)) {
    const m = resolve(t);
    if (!m || m === n) continue;
    const pair = [n.id, m.id].sort().join('>');
    const e = links.get(pair);
    if (e) { if (e.from !== n.id) e.mutual = true; } else links.set(pair, { from: n.id, to: m.id, kind: 'link' });
  }

  // Study Path hubs: consecutive same-subject notes in the reading order → prerequisite edges.
  const pathEdges = [];
  const hubOrders = [];
  for (const h of hubs) {
    const sec = h.body.match(/^##[^\n]*reading order[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/im);
    const order = [];
    for (const t of wikilinks(sec ? sec[1] : h.body)) {
      const m = resolve(t);
      if (m && m.subject === h.subject && !order.includes(m)) order.push(m);
    }
    hubOrders.push({ hub: h.title, order: order.map((m) => m.title) });
    for (let i = 1; i < order.length; i++) {
      pathEdges.push({ from: order[i - 1].id, to: order[i].id, kind: 'prereq', source: 'path', strength: 3,
        why: `Reading order in "${h.title}"` });
    }
  }
  return { nodes, notes, hubs, hubOrders, links: [...links.values()], pathEdges, resolve };
}

// ---------- Claude: inferred prerequisites ----------

const SYSTEM_PROMPT = `You are a computer-science teacher mapping prerequisites between a learner's study notes.
For every pair where one note should really be understood BEFORE another, output a directed edge.
Only real dependencies: B uses A's ideas and would be hard to follow without them. Not "same subject", not "related", not "mentions".
Cross-subject edges are welcome when real (e.g. a note on processes before one on signals; binary numbers before bitmasks or buffers indexed by bits).
Prefer direct edges; skip an edge A→C when A→B→C already covers it. No cycles.
Reply with ONLY a JSON object in a \`\`\`json fence:
{"edges":[{"before":"n3","after":"n7","why":"one short line: what B needs from A","strength":1|2|3}]}
strength: 3 = can't follow B at all without A, 2 = clearly helps, 1 = mild. Use the note keys (n1, n2, ...).`;

function promptFor(g) {
  const items = g.nodes.map((n, i) => {
    n._key = `n${i + 1}`;
    const excerpt = n.body.replace(/^#.*$/gm, '').replace(/^>\s*\[![^\]]*\][-+]?/gm, '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT);
    return `<note key="${n._key}" subject="${n.subject}" title="${n.title}">\n` +
      (n.topicOnly ? '(no note yet: only quiz questions on this topic)\n' : '') +
      (n.headings.length ? `headings: ${n.headings.slice(0, 25).join(' · ')}\n` : '') +
      (excerpt ? `start: ${excerpt}\n` : '') + '</note>';
  });
  const keyOf = new Map(g.nodes.map((n) => [n.id, n._key]));
  const hints = [
    ...g.hubOrders.filter((h) => h.order.length > 1).map((h) => `- study path "${h.hub}": ${h.order.join(' → ')}`),
    ...g.links.map((l) => `- ${keyOf.get(l.from)} links to ${keyOf.get(l.to)}${l.mutual ? ' (both ways)' : ''}`),
  ];
  return [
    `<notes>\n${items.join('\n')}\n</notes>`,
    hints.length ? `<learner_signals>\nThe learner's own reading orders and [[links]] (links don't say which comes first):\n${hints.join('\n')}\n</learner_signals>` : '',
    'Reply with only the JSON object.',
  ].filter(Boolean).join('\n\n');
}

async function build(ctx, signal) {
  const g = baseGraph(ctx);
  const fingerprint = fingerprintOf(g.nodes);
  try {
    const out = ctx.ai.extractJson(await ctx.ai.askOnce(promptFor(g), SYSTEM_PROMPT, { signal }));
    const byKey = new Map(g.nodes.map((n) => [n._key, n]));
    const find = (k) => byKey.get(String(k || '').trim()) || g.resolve(String(k || '').trim());
    const edges = [];
    const seen = new Set();
    for (const e of Array.isArray(out.edges) ? out.edges : []) {
      const a = find(e.before), b = find(e.after);
      if (!a || !b || a === b || seen.has(`${a.id}>${b.id}`)) continue;
      seen.add(`${a.id}>${b.id}`);
      edges.push({ from: a.title, to: b.title, why: String(e.why || '').slice(0, 200),
        strength: Math.max(1, Math.min(3, Number(e.strength) || 2)) });
    }
    store.writeJson(CACHE_FILE, { fingerprint, builtAt: new Date().toISOString(), edges });
    lastFail = null;
  } catch (e) {
    if (e.name === 'AbortError') {   // stopped on purpose: keep the old edges, no error, no retry
      cancelledFingerprint = fingerprint;
      return;
    }
    console.error('[topicmap] Claude build failed:', e.message);
    lastFail = { fingerprint, at: Date.now(), error: e.message };
  }
}

function startBuild(ctx) {
  if (!building) {
    const controller = new AbortController();
    const run = { controller, startedAt: new Date().toISOString() };
    run.promise = build(ctx, controller.signal).finally(() => { if (building === run) building = null; });
    building = run;
  }
  return building.promise;
}

// Stop the running build. Resolves once it has settled (askOnce rejects right away on abort).
async function cancelBuild() {
  if (!building) return false;
  const run = building;
  run.controller.abort();
  await run.promise;
  return true;
}

function loadCache() {
  return store.readJson(CACHE_FILE, null);
}

// ---------- graph clean-up ----------

// Drop the weakest edge of each cycle until there are none (Claude's edge loses to the study path on a tie).
function breakCycles(nodes, edges) {
  for (;;) {
    const out = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) out.get(e.from).push(e);
    const state = new Map();   // 1 = on the DFS stack, 2 = done
    const stack = [];
    let cycle = null;
    const dfs = (id) => {
      state.set(id, 1);
      for (const e of out.get(id)) {
        if (cycle) return;
        if (state.get(e.to) === 1) { cycle = [...stack.slice(stack.findIndex((x) => x.from === e.to)), e]; return; }
        if (!state.get(e.to)) { stack.push(e); dfs(e.to); stack.pop(); }
      }
      state.set(id, 2);
    };
    for (const n of nodes) if (!state.get(n.id) && !cycle) dfs(n.id);
    if (!cycle) return edges;
    const rank = (e) => e.strength * 10 + (e.source === 'path' ? 5 : 0);
    const weakest = cycle.reduce((w, e) => (rank(e) < rank(w) ? e : w));
    edges = edges.filter((e) => e !== weakest);
  }
}

// An edge A→C is "redundant" when another route A→…→C exists. The page draws those faintly.
function markRedundant(edges) {
  const out = new Map();
  for (const e of edges) (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e.to);
  const reach = (from, to, skip) => {
    const stack = (out.get(from) || []).filter((x) => x !== skip);
    const seen = new Set();
    while (stack.length) {
      const x = stack.pop();
      if (x === to) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(out.get(x) || []));
    }
    return false;
  };
  for (const e of edges) if (reach(e.from, e.to, e.to)) e.redundant = true;
}

// ---------- the map the page gets ----------

function mapFor(ctx) {
  const g = baseGraph(ctx);
  const fingerprint = fingerprintOf(g.nodes);
  const cache = loadCache();
  const aiAvailable = ctx.ai.isAvailable();

  // Notes changed (or never built) → rebuild in the background; meanwhile serve what we have.
  const stale = !cache || cache.fingerprint !== fingerprint;
  const failedRecently = lastFail && lastFail.fingerprint === fingerprint && Date.now() - lastFail.at < RETRY_FAILED_MS;
  const cancelled = cancelledFingerprint === fingerprint;
  if (stale && aiAvailable && !building && !failedRecently && !cancelled) startBuild(ctx);

  // Prerequisite edges: study paths + Claude's cached ones whose notes still exist.
  const byTitle = new Map(g.nodes.map((n) => [n.title, n]));
  let prereqs = [...g.pathEdges];
  for (const e of cache?.edges || []) {
    const a = byTitle.get(e.from), b = byTitle.get(e.to);
    if (!a || !b || a === b) continue;
    const dup = prereqs.find((p) => p.from === a.id && p.to === b.id);
    if (dup) { dup.why = e.why || dup.why; dup.source = 'path+claude'; continue; }
    prereqs.push({ from: a.id, to: b.id, kind: 'prereq', source: 'claude', why: e.why, strength: e.strength });
  }
  prereqs = breakCycles(g.nodes, prereqs);
  markRedundant(prereqs);
  // A wikilink that duplicates a prerequisite adds nothing to the picture.
  const hasPrereq = new Set(prereqs.flatMap((e) => [`${e.from}>${e.to}`, `${e.to}>${e.from}`]));
  const links = g.links.filter((l) => !hasPrereq.has(`${l.from}>${l.to}`));

  // Per-note stats: the note's quiz topics added up.
  const topicStats = new Map(ctx.computeStats().topics.map((t) => [`${t.subject} / ${t.topic}`, t]));
  // computeStats' "due" counts never-seen questions too; "reviews due" = answered before and due again.
  const progress = ctx.loadProgress();
  const now = Date.now();
  const dueSeen = {};
  for (const q of ctx.loadQuestions()) {
    const st = progress[q.id];
    if (st && ctx.isDue(st, now)) dueSeen[`${q.subject} / ${q.topic}`] = (dueSeen[`${q.subject} / ${q.topic}`] || 0) + 1;
  }
  const openGaps = ctx.gaps.listForClient().open;
  const nodes = g.nodes.map((n) => {
    const s = { total: 0, seen: 0, mastered: 0, weak: 0, due: 0, boxSum: 0, dueSeen: 0 };
    for (const k of n.topics) {
      const t = topicStats.get(k);
      if (t) for (const f of Object.keys(s)) if (f !== 'dueSeen') s[f] += t[f];
      s.dueSeen += dueSeen[k] || 0;
    }
    const mastery = s.total ? Math.round((s.boxSum / (s.total * ctx.MAX_BOX)) * 100) : null;
    const gaps = openGaps
      .filter((x) => x.analysis?.note?.title === n.title || n.topics.includes(`${x.subject} / ${x.topic}`))
      .map((x) => ({ id: x.id, concept: x.analysis?.concept || x.texts?.[x.texts.length - 1]?.text?.slice(0, 80) || 'gap',
        question: x.sourceQuestion, url: x.url || null }));
    const { boxSum, ...rest } = s;
    return {
      id: n.id, title: n.title, subject: n.subject, topics: n.topics, topicOnly: !!n.topicOnly,
      stats: { ...rest, mastery }, gaps,
      url: obsidianUrl(n.file),
    };
  });

  // 🌱 Frontier: not solid yet, and everything it builds on is solid (or has no quiz to tell).
  // Foundations (no prerequisites) only count while mostly unseen, so "keep practising X" doesn't crowd it.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const solid = (n) => n.stats.mastery !== null && n.stats.mastery >= SOLID;
  const frontier = nodes.filter((n) => {
    if (solid(n)) return false;
    const pre = prereqs.filter((e) => e.to === n.id).map((e) => byId.get(e.from));
    if (!pre.every((p) => solid(p) || p.stats.mastery === null)) return false;
    return pre.length > 0 || n.stats.seen < n.stats.total / 2 || !n.stats.total;
  }).map((n) => n.id);

  return {
    nodes,
    edges: [...prereqs.map(({ from, to, kind, source, why, strength, redundant }) =>
      ({ from, to, kind, source, why: why || '', strength, redundant: !!redundant })),
    ...links.map(({ from, to, kind, mutual }) => ({ from, to, kind, why: '', mutual: !!mutual }))],
    frontier,
    solidAt: SOLID,
    building: !!building,
    startedAt: building ? building.startedAt : null,
    cancellable: !!building,
    builtAt: cache?.builtAt || null,
    stale: stale && !!cache,
    paused: stale && cancelled && !building,   // the learner stopped the automatic update for this note set
    aiAvailable,
    error: lastFail && lastFail.fingerprint === fingerprint ? lastFail.error : null,
  };
}

async function handle(req, res, url, ctx) {
  if (req.method === 'GET' && url.pathname === '/api/map') {
    ctx.send(res, 200, mapFor(ctx));
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/map/rebuild') {
    if (!ctx.ai.isAvailable()) { ctx.send(res, 503, { error: ctx.ai.unavailableReason() }); return true; }
    lastFail = null;
    cancelledFingerprint = null;
    startBuild(ctx);
    ctx.send(res, 200, { building: true });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/map/rebuild/cancel') {
    const stopped = await cancelBuild();
    ctx.send(res, 200, { cancelled: stopped, building: !!building });
    return true;
  }
  return false;
}

module.exports = { handle, mapFor, startBuild, cancelBuild, scanNotes, SOLID };
