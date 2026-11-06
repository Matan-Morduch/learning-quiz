// Interview problem bank: NVIDIA's LeetCode problems, the patterns Matan knows, and prepared problems
// (statement, starter code, hidden tests, reference solution, hints) that the interview uses.
//
// Files:
//   interview/catalog.json                      the NVIDIA list (freq, score, hand-tagged patterns)
//   data/interview/patterns.json                { known: [...], dismissed: [...] }
//   data/interview/problems/<slug>.json         a prepared problem (see prepare())
//   data/interview/problems/<slug>.tests.json   its hidden tests [{args|ops, expected, small}]
//   data/interview/prep.json                    preparation state per slug { state, error?, at }
//   Learning/DSA/Interview/Problems/<Title>.md  a readable copy in the vault (solutions folded)
//
// Preparing a problem: Claude writes the statement, starter code, examples, a reference solution, a
// brute force and a test-case generator. Then the server checks it: the reference must pass LeetCode's
// examples, the generator makes 30–80 cases, the reference's answers become the expected answers, and the
// brute force must agree on every small case. One repair round with the errors; then it's marked failed.
// The time limit comes from the reference's slowest case (×25, 300 ms–4 s), so an O(n²) answer to an
// O(n) problem times out on the large cases.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const runner = require('./interview-runner');
const { ask } = require('./interview/claude');

const CATALOG_FILE = path.join(__dirname, 'interview', 'catalog.json');
let DATA = null, PROB_DIR = null, PATTERNS_FILE = null, PREP_FILE = null, VAULT_DIR = null;

const PATTERNS = {
  arrays: 'Arrays & strings', 'hash-map': 'Hash map / set', 'two-pointers': 'Two pointers',
  'sliding-window': 'Sliding window', stack: 'Stack', 'binary-search': 'Binary search',
  'linked-list': 'Linked list', heap: 'Heap', tree: 'Trees', graph: 'Graphs (BFS/DFS)', dp: 'Dynamic programming',
  backtracking: 'Backtracking', 'bit-manipulation': 'Bit manipulation', greedy: 'Greedy', math: 'Math',
  recursion: 'Recursion', trie: 'Trie',
};
const START_KNOWN = ['arrays', 'hash-map', 'two-pointers', 'sliding-window', 'stack', 'binary-search'];
const PREP_MODEL = process.env.QUIZ_INTERVIEW_PREP_MODEL || 'opus';
const READY_AHEAD = 6;      // keep this many eligible problems prepared ahead
const PARALLEL = 2;

function init(ctx) {
  DATA = path.join(ctx.DATA_DIR, 'interview');
  PROB_DIR = path.join(DATA, 'problems');
  PATTERNS_FILE = path.join(DATA, 'patterns.json');
  PREP_FILE = path.join(DATA, 'prep.json');
  VAULT_DIR = path.join(ctx.LEARNING_DIR, 'DSA', 'Interview', 'Problems');
  fs.mkdirSync(PROB_DIR, { recursive: true });
  // Preparations cut off by a restart start again.
  const prep = loadPrep();
  for (const [slug, p] of Object.entries(prep)) if (p.state === 'running' || p.state === 'queued') { p.state = 'queued'; queue.push(slug); }
  savePrep(prep);
  if (!process.env.QUIZ_INTERVIEW_NO_AUTOPREP) setTimeout(() => { topUp(); pump(); }, 3000).unref();
}

// ---------- catalog + patterns ----------
let catalogCache = null;
function catalog() {
  if (!catalogCache) catalogCache = store.readJson(CATALOG_FILE, { problems: [] });
  return catalogCache;
}
const bySlug = (slug) => catalog().problems.find((p) => p.slug === slug) || null;

function patterns() {
  const p = store.readJson(PATTERNS_FILE, null) || { known: START_KNOWN.slice(), dismissed: [] };
  p.known = (p.known || []).filter((k) => PATTERNS[k]);
  p.dismissed = p.dismissed || [];
  return p;
}
function savePatterns(p) { store.writeJson(PATTERNS_FILE, p); }
function setKnown(pattern, on) {
  if (!PATTERNS[pattern]) throw Object.assign(new Error('unknown pattern'), { status: 400 });
  const p = patterns();
  p.known = on ? [...new Set([...p.known, pattern])] : p.known.filter((k) => k !== pattern);
  if (on) p.dismissed = p.dismissed.filter((k) => k !== pattern);
  savePatterns(p);
  if (on) topUp();
  return p;
}
function dismiss(pattern) {
  const p = patterns();
  p.dismissed = [...new Set([...p.dismissed, pattern])];
  savePatterns(p);
  return p;
}

const eligibleFor = (known) => catalog().problems.filter((x) => x.testable && x.patterns.length && x.patterns.every((k) => known.includes(k)));
function eligible() { return eligibleFor(patterns().known); }
// How many more problems a pattern would unlock (everything else it needs already known).
function unlocks(pattern) {
  const known = patterns().known;
  if (known.includes(pattern)) return 0;
  return eligibleFor([...known, pattern]).length - eligibleFor(known).length;
}

// ---------- prepared problems ----------
const probFile = (slug) => path.join(PROB_DIR, `${slug}.json`);
const testsFile = (slug) => path.join(PROB_DIR, `${slug}.tests.json`);
function loadProblem(slug) { return /^[a-z0-9-]+$/.test(slug) ? store.readJson(probFile(slug), null) : null; }
function loadTests(slug) { return store.readJson(testsFile(slug), null); }
function isReady(slug) { return fs.existsSync(probFile(slug)) && fs.existsSync(testsFile(slug)); }
function loadPrep() { return store.readJson(PREP_FILE, {}); }
function savePrep(p) { store.writeJson(PREP_FILE, p); }
function setPrep(slug, patch) { const p = loadPrep(); p[slug] = { ...(p[slug] || {}), ...patch, at: Date.now() }; savePrep(p); }

// What the candidate may see: no solutions, tests, hints or follow-ups.
function publicView(prob) {
  if (!prob) return null;
  const { slug, title, difficulty, statement, starter, patterns: pats, method } = prob;
  return { slug, title, difficulty, statement, starter, patterns: pats, method };
}

// The job for the runner, from a prepared problem and its tests.
function jobFor(prob, tests) {
  return { method: prob.method || null, compare: prob.compare || 'exact', inplace: prob.inplace ?? null,
    check: prob.check || null, timeLimitMs: prob.timeLimitMs || 2000, tests: tests.map((t) => ({ ...(t.ops ? { ops: t.ops } : {}), args: t.args, expected: t.expected })) };
}

// ---------- preparing ----------
const queue = [];
let running = 0;

function enqueue(slug, { front = false } = {}) {
  const c = bySlug(slug);
  if (!c || !c.testable) throw Object.assign(new Error('not a problem we can prepare'), { status: 400 });
  if (isReady(slug)) return 'ready';
  const st = loadPrep()[slug];
  if (st && (st.state === 'running')) return 'running';
  if (queue.includes(slug)) { if (front) { queue.splice(queue.indexOf(slug), 1); queue.unshift(slug); } return 'queued'; }
  front ? queue.unshift(slug) : queue.push(slug);
  setPrep(slug, { state: 'queued', error: null });
  pump();
  return 'queued';
}

// Keep READY_AHEAD eligible problems ready (or being prepared), in pick order.
function topUp() {
  const prep = loadPrep();
  const order = pickOrder();
  let have = 0;
  for (const c of order) {
    if (have >= READY_AHEAD) break;
    const st = prep[c.slug];
    if (isReady(c.slug) || queue.includes(c.slug) || (st && st.state === 'running')) { have++; continue; }
    if (st && st.state === 'failed' && (st.tries || 0) >= 2) continue;
    enqueue(c.slug);
    have++;
  }
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const slug = queue.shift();
    running++;
    setPrep(slug, { state: 'running' });
    prepare(slug)
      .then(() => setPrep(slug, { state: 'ready', error: null }))
      .catch((e) => {
        console.error(`[interview] preparing ${slug} failed:`, e.message);
        const st = loadPrep()[slug] || {};
        setPrep(slug, { state: 'failed', error: e.message.slice(0, 500), tries: (st.tries || 0) + 1 });
      })
      .finally(() => { running--; pump(); });
  }
}

const WRITER_SYSTEM = `You prepare LeetCode problems for a mock-interview app that runs Python 3.12 solutions against hidden tests. Output only the requested tagged sections, nothing else. Be exact: your reference solution's answers become the expected answers, and the app checks it against your brute force and against LeetCode's examples.`;

function writerPrompt(c) {
  return `Prepare LeetCode problem "${c.title}" (https://leetcode.com/problems/${c.slug}/), difficulty ${c.difficulty}.
Use LeetCode's real problem: same statement, same function/class signature, same examples and constraints.

Reply with exactly these sections:

<meta>
{ "method": "<the Solution method name, e.g. twoSum; null for a design problem (a class with methods, e.g. MinStack)>",
  "className": "<design problems only: the class name>",
  "compare": "exact" | "unordered" (the answer is a list in any order) | "unordered-inner" (a list of lists, any order at both levels) | "float",
  "inplace": null | <index of the argument the method modifies in place and returns nothing, e.g. 0 for sortColors(nums)>,
  "needsCheck": true | false (true only when several different answers are all correct and compare can't express it),
  "examples": [ { "args": [<the method's arguments as JSON>], "expected": <LeetCode's output> } ]   (design: { "ops": [...], "args": [[...], ...], "expected": [...] }),
  "complexity": { "time": "O(...)", "space": "O(...)" },
  "hints": ["<4 hints, each stronger: 1 point their attention at something, 2 a guiding question, 3 name the kind of idea, 4 name the technique/data structure. None gives code.>"],
  "followups": ["<2-3 follow-up questions an interviewer would ask after a working solution>"],
  "mistakes": ["<3-5 common mistakes and edge cases candidates miss>"] }
</meta>
<statement>
The problem as Markdown: the description, then "### Example 1" … (Input/Output/Explanation as on LeetCode, in \`code\`), then "### Constraints" as a list. No title heading, no hints, no solution.
</statement>
<starter>
The exact LeetCode Python3 starter code (class Solution with the method signature and a body of just \`pass\`; design problems: the class with its methods). Use List[int] style types; List/Optional are already imported.
</starter>
<reference>
A correct, optimal Python solution (same class/method names). No imports needed beyond the standard library (collections, heapq, bisect, itertools, functools, math are preloaded; import anything else explicitly).
</reference>
<brute>
A simple, obviously-correct brute-force solution with the same interface (can be slow; it only runs on small inputs).
</brute>
<gen>
def cases():
    # Return 30-80 test cases: a list of argument lists, e.g. [[nums, target], ...]
    # (design problems: a list of {"ops": [...], "args": [[...], ...]}).
    # Include: every edge case (empty/minimum sizes allowed by the constraints, one element, duplicates,
    # negatives, extremes of the value ranges, already-sorted/reversed, all-equal...), many small random
    # cases, and 3-5 LARGE cases near the maximum constraints (so an O(n^2) answer to an O(n) problem is
    # too slow). Use random.Random(<fixed seed>) so cases are the same every run. Respect every constraint
    # and any guarantee in the statement (e.g. "exactly one solution exists"): build inputs that satisfy it.
    ...
</gen>
<check>
Only when needsCheck is true: def check(args, got, expected) -> bool that accepts any correct answer
(args are the original arguments; expected is the reference's answer). Otherwise leave this section empty.
</check>`;
}

function section(text, tag) {
  const m = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`));
  if (!m) return null;
  return m[1].replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
}

function parseWriter(text) {
  const metaRaw = section(text, 'meta');
  if (!metaRaw) throw new Error('no <meta> section');
  const meta = JSON.parse(metaRaw.slice(metaRaw.indexOf('{'), metaRaw.lastIndexOf('}') + 1));
  const out = { meta };
  for (const k of ['statement', 'starter', 'reference', 'brute', 'gen', 'check']) out[k] = section(text, k) || '';
  for (const k of ['statement', 'starter', 'reference', 'brute', 'gen']) if (!out[k]) throw new Error(`no <${k}> section`);
  if (!meta.needsCheck) out.check = '';
  return out;
}

const isSmall = (t) => JSON.stringify(t.args).length <= 1500;

// Checks a written problem; returns { tests, timeLimitMs, notes } or throws with what went wrong.
async function validate(w) {
  const m = w.meta;
  const design = !m.method;
  const base = { method: m.method || null, compare: m.compare || 'exact', inplace: m.inplace ?? null, check: w.check || null };
  // 1. the reference passes LeetCode's examples
  const ex = (m.examples || []).map((e) => ({ ...(e.ops ? { ops: e.ops } : {}), args: e.args, expected: e.expected }));
  if (!ex.length) throw new Error('no examples');
  const r1 = await runner.run(w.reference, { ...base, timeLimitMs: 5000, tests: ex });
  if (r1.compileError) throw new Error(`reference doesn't compile: ${r1.compileError} (line ${r1.line})`);
  const badEx = r1.results.filter((x) => !x.ok);
  if (badEx.length) throw new Error(`reference fails example(s): ${badEx.map((x) => `#${x.i + 1} args=${JSON.stringify(ex[x.i].args).slice(0, 200)} expected=${JSON.stringify(ex[x.i].expected)} got=${JSON.stringify(x.got)} ${x.error || ''}`).join('; ')}`);
  // 2. generate cases
  const g = await runner.run(w.gen, { mode: 'gen', wallMs: 30000 });
  if (g.compileError || !Array.isArray(g.cases)) throw new Error(`gen failed: ${g.compileError || g.crashed || 'no cases'}`);
  let cases = g.cases.map((c) => (design ? { ops: c.ops, args: c.args } : { args: c }));
  if (design && cases.some((c) => !Array.isArray(c.ops) || !Array.isArray(c.args))) throw new Error('gen: design cases need ops and args');
  if (!design && cases.some((c) => !Array.isArray(c.args))) throw new Error('gen: each case must be a list of arguments');
  if (cases.length < 10) throw new Error(`gen made only ${cases.length} cases`);
  cases = cases.slice(0, 100);
  // 3. the reference's answers become expected
  const r2 = await runner.run(w.reference, { ...base, check: null, timeLimitMs: 10000, wallMs: 120000, tests: cases });
  if (r2.compileError || r2.crashed) throw new Error(`reference failed on generated cases: ${r2.compileError || r2.crashed}`);
  const bad2 = r2.results.filter((x) => !x.ok);
  if (bad2.length) throw new Error(`reference errors on generated cases: ${bad2.slice(0, 3).map((x) => `args=${JSON.stringify(cases[x.i].args).slice(0, 200)}: ${x.error}`).join('; ')} (are the cases within the constraints?)`);
  const tests = cases.map((c, i) => ({ ...c, expected: r2.results[i].got, small: isSmall(c), refMs: r2.results[i].ms }));
  // 4. the brute force agrees on the small cases
  const small = tests.filter((t) => t.small);
  if (small.length < 5) throw new Error('fewer than 5 small cases');
  const r3 = await runner.run(w.brute, { ...base, timeLimitMs: 5000, wallMs: 120000, tests: small });
  if (r3.compileError) throw new Error(`brute force doesn't compile: ${r3.compileError}`);
  const bad3 = r3.results.filter((x) => !x.ok && !x.timeout);
  if (bad3.length) throw new Error(`reference and brute force disagree: ${bad3.slice(0, 3).map((x) => `args=${JSON.stringify(small[x.i].args).slice(0, 200)} reference=${JSON.stringify(small[x.i].expected).slice(0, 200)} brute=${JSON.stringify(x.got).slice(0, 200)} ${x.error || ''}`).join('; ')}`);
  // 5. the time limit, and whether the large cases tell O(n²) from O(n)
  const maxRef = Math.max(...tests.map((t) => t.refMs || 0));
  const timeLimitMs = Math.round(Math.min(4000, Math.max(300, maxRef * 25 + 100)));
  const notes = [];
  const large = tests.filter((t) => !t.small);
  if (large.length) {
    const r4 = await runner.run(w.brute, { ...base, timeLimitMs, wallMs: 60000, tests: large.slice(0, 2) });
    notes.push(r4.results.some((x) => x.timeout) ? 'large cases catch a brute force' : 'a brute force passes the large cases too');
  } else notes.push('no large cases');
  return { tests: tests.map(({ refMs, ...t }) => t), timeLimitMs, notes };
}

async function prepare(slug) {
  const c = bySlug(slug);
  let text = await ask(writerPrompt(c), { system: WRITER_SYSTEM, model: PREP_MODEL, timeoutMs: 8 * 60000 });
  let w, v, lastErr;
  for (let round = 0; round < 2; round++) {
    try {
      w = parseWriter(text);
      v = await validate(w);
      break;
    } catch (e) {
      lastErr = e;
      if (round === 1) break;
      console.warn(`[interview] ${slug}: first version rejected (${e.message.slice(0, 200)}); asking for a fix`);
      text = await ask(`${writerPrompt(c)}\n\nYour previous answer was:\n${text}\n\nThe app rejected it: ${e.message}\n\nFix the problem and reply again with all sections, complete.`,
        { system: WRITER_SYSTEM, model: PREP_MODEL, timeoutMs: 8 * 60000 });
    }
  }
  if (!v) throw lastErr;
  const m = w.meta;
  const prob = {
    slug, title: c.title, difficulty: c.difficulty, patterns: c.patterns, freq: c.freq, score: c.score,
    url: `https://leetcode.com/problems/${slug}/`,
    method: m.method || null, className: m.className || null, compare: m.compare || 'exact', inplace: m.inplace ?? null,
    check: w.check || null, statement: w.statement, starter: w.starter, reference: w.reference, brute: w.brute, gen: w.gen,
    examples: m.examples, complexity: m.complexity || {}, hints: (m.hints || []).slice(0, 4), followups: m.followups || [],
    mistakes: m.mistakes || [], timeLimitMs: v.timeLimitMs, notes: v.notes, tests: v.tests.length,
    preparedAt: new Date().toISOString(), model: PREP_MODEL,
  };
  store.writeJson(testsFile(slug), v.tests);
  store.writeJson(probFile(slug), prob);
  try { writeVaultNote(prob); } catch (e) { console.error('[interview] vault note:', e.message); }
  console.log(`[interview] prepared ${slug}: ${v.tests.length} tests, limit ${v.timeLimitMs} ms, ${v.notes.join('; ')}`);
  return prob;
}

const fence = (code) => code.split('\n').map((l) => `> ${l}`).join('\n');
function writeVaultNote(p) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  const safe = p.title.replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
  const md = `---
leetcode: ${p.url}
difficulty: ${p.difficulty}
patterns: [${p.patterns.join(', ')}]
nvidia-frequency: ${p.freq}
tags: [interview, leetcode]
---

# ${p.title}

${p.statement}

> [!tip]- Hints
${p.hints.map((h, i) => `> ${i + 1}. ${h}`).join('\n')}

> [!example]- Solution (${p.complexity.time || '?'} time, ${p.complexity.space || '?'} space)
> \`\`\`python
${fence(p.reference)}
> \`\`\`

> [!warning]- Common mistakes
${p.mistakes.map((x) => `> - ${x}`).join('\n')}

> [!question]- Follow-ups
${p.followups.map((x) => `> - ${x}`).join('\n')}
`;
  store.writeText(path.join(VAULT_DIR, `${safe}.md`), md);
}

// ---------- picking ----------
// Eligible problems in the order they should come: never-done first by NVIDIA score (Easy/Medium before
// Hard until he has passed 3 Mediums), then problems not done in 14 days, weakest-pattern first.
function pickOrder(history = []) {
  const doneAt = new Map();
  for (const s of history) if (s.slug) doneAt.set(s.slug, Math.max(doneAt.get(s.slug) || 0, s.startedAt || 0));
  const passedMediums = history.filter((s) => s.difficulty === 'Medium' && s.verdict && s.verdict.ok).length;
  const weak = new Map();   // pattern → average overall (lower = weaker)
  for (const s of history) if (typeof s.overallScore === 'number') for (const k of s.patterns || []) {
    const w = weak.get(k) || { sum: 0, n: 0 }; w.sum += s.overallScore; w.n++; weak.set(k, w);
  }
  const weakness = (c) => Math.min(...c.patterns.map((k) => (weak.has(k) ? weak.get(k).sum / weak.get(k).n : 2.5)));
  const fresh = [], again = [];
  for (const c of eligible()) {
    if (!doneAt.has(c.slug)) fresh.push(c);
    else if (Date.now() - doneAt.get(c.slug) > 14 * 864e5) again.push(c);
  }
  const hardLater = (c) => (c.difficulty === 'Hard' && passedMediums < 3 ? 1 : 0);
  fresh.sort((a, b) => hardLater(a) - hardLater(b) || b.score - a.score);
  again.sort((a, b) => weakness(a) - weakness(b) || b.score - a.score);
  return [...fresh, ...again];
}

// ---------- HTTP ----------
function listForClient(history) {
  const prep = loadPrep();
  const done = new Map();
  for (const s of history) if (s.slug) done.set(s.slug, (done.get(s.slug) || 0) + 1);
  const order = pickOrder(history);
  const rank = new Map(order.map((c, i) => [c.slug, i]));
  return eligible().map((c) => ({
    slug: c.slug, title: c.title, difficulty: c.difficulty, patterns: c.patterns, freq: c.freq, score: c.score, recent: c.recent,
    ready: isReady(c.slug), prep: prep[c.slug] ? { state: prep[c.slug].state, error: prep[c.slug].error || null } : null,
    done: done.get(c.slug) || 0, rank: rank.has(c.slug) ? rank.get(c.slug) : 9999,
  })).sort((a, b) => a.rank - b.rank);
}

async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith('/api/interview/problems') && !p.startsWith('/api/interview/patterns')) return false;
  if (req.method === 'POST' && p === '/api/interview/patterns') {
    const b = await ctx.readBody(req);
    const r = b.dismiss ? dismiss(String(b.dismiss)) : setKnown(String(b.pattern || ''), !!b.known);
    ctx.send(res, 200, r);
    return true;
  }
  if (req.method === 'POST' && p === '/api/interview/problems/prepare') {
    const b = await ctx.readBody(req);
    const prep = loadPrep()[b.slug];
    if (prep && prep.state === 'failed') setPrep(b.slug, { state: 'queued', tries: 0 });
    ctx.send(res, 200, { state: enqueue(String(b.slug || ''), { front: true }) });
    return true;
  }
  const m = p.match(/^\/api\/interview\/problems\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && m) {
    const prob = loadProblem(m[1]);
    if (!prob) ctx.send(res, 404, { error: 'not prepared' });
    else ctx.send(res, 200, publicView(prob));
    return true;
  }
  return false;
}

module.exports = {
  init, handle, PATTERNS, catalog, bySlug, patterns, setKnown, dismiss, eligible, unlocks, loadProblem, loadTests,
  isReady, publicView, jobFor, enqueue, topUp, pickOrder, listForClient, prepare, validate, parseWriter, writeVaultNote,
};
