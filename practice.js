// Practice upgrades, server side:
//  - the hint ladder (R0 redirect → R3 name the concept). Hints go through the run's own Claude session,
//    so the tutor sees them in context and the grade that follows knows how much help the learner needed.
//  - saved practice runs (data/practice-runs.json): every unfinished practice is kept until it is finished
//    or discarded, so it can be continued later, on any device, even after starting another one.

const fs = require('fs');
const path = require('path');

const MAX_RUNS = 20;   // oldest unfinished runs beyond this are dropped

let RUNS_FILE = null;
function loadRuns() {
  try { return JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8')); } catch { return []; }
}
function saveRuns(runs) {
  const tmp = RUNS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(runs, null, 1));
  fs.renameSync(tmp, RUNS_FILE);
}
const str = (x, max = 300) => String(x ?? '').slice(0, max);
// Only the fields a run needs to be continued; results keep what the summary screen shows.
function cleanRun(r) {
  const ids = Array.isArray(r.ids) ? r.ids.map((x) => str(x, 200)).filter(Boolean).slice(0, 2000) : [];
  return {
    id: str(r.id, 80), kind: r.kind === 'plan' ? 'plan' : 'practice', subject: str(r.subject),
    back: typeof r.back === 'string' && r.back.startsWith('/') ? str(r.back, 500) : null,
    ids, index: Math.max(0, Math.min(ids.length, Number(r.index) || 0)),
    results: (Array.isArray(r.results) ? r.results : []).slice(0, 2000).map((x) => ({
      id: str(x.id, 200), question: str(x.question, 1000), topic: str(x.topic), rating: str(x.rating, 10),
      ms: Number(x.ms) || 0, ...(typeof x.aiScore === 'number' ? { aiScore: x.aiScore } : {}),
      ...(x.format === 'mcq' ? { format: 'mcq' } : {}),
    })),
    elapsedMs: Number(r.elapsedMs) || 0,
    startedAt: Number(r.startedAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

// The run's Claude session, or a fresh one if it's gone (same rule as aiSessionFor in server.js).
function sessionFor(body, ai) {
  try { return ai.getSession(body.session); } catch {
    if (!ai.isAvailable()) throw new Error(ai.unavailableReason());
    return ai.openSession({ kind: body.kind || 'smart', subject: body.subject || 'mixed' });
  }
}

module.exports = {
  init(ctx) { RUNS_FILE = path.join(ctx.DATA_DIR, 'practice-runs.json'); },

  async handle(req, res, url, ctx) {
    // Unfinished practice runs, newest first.
    if (req.method === 'GET' && url.pathname === '/api/practice/runs') {
      ctx.send(res, 200, { runs: loadRuns().sort((a, b) => b.updatedAt - a.updatedAt) });
      return true;
    }
    // Save (create or update) a run. A finished run is removed instead.
    if (req.method === 'POST' && url.pathname === '/api/practice/runs/save') {
      const run = cleanRun(await ctx.readBody(req));
      if (!run.id || !run.ids.length) { ctx.send(res, 400, { error: 'run needs an id and questions' }); return true; }
      let runs = loadRuns().filter((r) => r.id !== run.id);
      if (run.index < run.ids.length) runs.push(run);
      runs = runs.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RUNS);
      saveRuns(runs);
      ctx.send(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/practice/runs/delete') {
      const { id } = await ctx.readBody(req);
      saveRuns(loadRuns().filter((r) => r.id !== id));
      ctx.send(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/practice/hint') {
      const body = await ctx.readBody(req);
      const q = ctx.loadQuestions().find((x) => x.id === body.id);
      if (!q) { ctx.send(res, 404, { error: 'question not found' }); return true; }
      try {
        const s = sessionFor(body, ctx.ai);
        const h = await s.hint(q, body.answer || '', body.level, body.extra || null);
        ctx.send(res, 200, { ...h, session: s.id });
      } catch (e) { ctx.send(res, 502, { error: e.message }); }
      return true;
    }
    return false;
  },
};
