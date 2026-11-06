// Practice upgrades, front end:
//  - Hint ladder before reveal (4 rungs, one per click; never the answer). Hints used go in `extra.hints`,
//    and 2+ hints cap the suggested rating at "hard" (the idea didn't come to mind unaided).
//  - After the AI grade: suggested rating, miss class (what kind of miss it was), confidence calibration note,
//    and for a misconception ("structural") a one-click "Add to Study next".
//  - "What Claude has learned about you" panel on the Smart-review tab (data/learner-model.json via api/learner).
(() => {
  if (!window.Quiz) return;
  const { esc, md, inline } = Quiz;

  const RUNGS = ['redirect your attention', 're-describe the pattern', 'name the family of ideas', 'name the concept'];
  const MISS = {
    cue: ['Cue miss', 'the right idea never came to mind: practise recalling it from different prompts'],
    discrimination: ['Mix-up', 'a similar idea won over the right one: compare the two side by side'],
    execution: ['Execution slip', 'right idea, applied or traced wrongly: redo the steps slowly'],
    careless: ['Careless', 'a slip, you know this one'],
    structural: ['Misconception', 'something you believe is itself wrong: worth repairing at the root'],
  };
  const RANK = { again: 0, hard: 1, good: 2, easy: 3 };

  const ic = (n) => (Quiz.icon ? Quiz.icon(n) : '');

  const css = document.createElement('style');
  css.textContent = `
  .px-hints { display: flex; flex-direction: column; gap: 8px; }
  .px-hints:empty { display: none; }
  .px-hint { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--yellow) 14%, var(--surface)); font: var(--subhead); line-height: 1.45; }
  .px-hint > svg { width: 18px; height: 18px; flex: none; margin-top: 1px; color: color-mix(in srgb, var(--orange) 85%, var(--label)); }
  .px-hint .px-label { font: 600 13px/18px var(--font); color: var(--label-2); margin-bottom: 2px; }
  .px-hint p { margin: 0; }
  .px-hint-btn svg { color: color-mix(in srgb, var(--orange) 85%, var(--label)); }
  .px-after { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 18px; font: var(--subhead); }
  .px-after .px-line { display: flex; align-items: center; gap: 8px; color: var(--label-2); flex-basis: 100%; }
  .px-after .px-line svg { width: 16px; height: 16px; flex: none; color: var(--label-3); }
  .px-chip { --c: var(--label-2); display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: var(--r-pill); font: 600 12px/1 var(--font);
    color: color-mix(in srgb, var(--c) 85%, var(--label)); background: color-mix(in srgb, var(--c) 15%, transparent); white-space: nowrap; }
  .px-chip.cue { --c: var(--orange); } .px-chip.discrimination { --c: var(--blue); }
  .px-chip.execution { --c: var(--purple); } .px-chip.careless { --c: var(--label-2); }
  .px-chip.structural { --c: var(--red); }
  .px-cal { color: var(--label); }

  /* "What Claude has learned about you": a grouped section with a disclosure row */
  details.px-learner { margin: 0 0 32px; }
  details.px-learner > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 12px 16px;
    background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1); font: var(--body); color: var(--label); transition: border-radius var(--dur); }
  details.px-learner > summary::-webkit-details-marker { display: none; }
  details.px-learner > summary .lead { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: #fff; flex: none;
    background: linear-gradient(160deg, var(--purple), var(--indigo)); }
  details.px-learner > summary .lead svg { width: 17px; height: 17px; }
  details.px-learner > summary .grow { flex: 1; min-width: 0; }
  details.px-learner > summary small { display: block; font: var(--footnote); color: var(--label-2); }
  details.px-learner > summary .chev { width: 14px; height: 14px; color: var(--label-3); transition: transform var(--dur) var(--ease); }
  details.px-learner[open] > summary .chev { transform: rotate(90deg); }
  details.px-learner[open] > summary { border-radius: var(--r-lg) var(--r-lg) 0 0; }
  .px-learner .px-body { background: var(--surface); border-radius: 0 0 var(--r-lg) var(--r-lg); box-shadow: var(--shadow-1); padding: 4px 16px 18px;
    font: var(--subhead); line-height: 1.45; position: relative; }
  .px-learner .px-body::before { content: ""; position: absolute; top: 0; left: 16px; right: 0; border-top: 1px solid var(--separator); }
  .px-learner h4 { margin: 18px 0 8px; font: 600 13px/18px var(--font); color: var(--label-2); }
  .px-learner ul { margin: 0; padding: 0; list-style: none; }
  .px-learner li { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 6px; }
  .px-learner li > svg { width: 16px; height: 16px; flex: none; margin-top: 2px; color: var(--label-3); }
  .px-learner .over { color: var(--red); } .px-learner .under { color: var(--blue); } .px-learner .calibrated { color: var(--green); }
  .px-learner .px-topic { margin: 10px 0; }
  .px-learner .px-topic .btn { margin-left: 4px; }
  .px-learner .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  `;
  document.head.appendChild(css);

  // ---------- hint ladder ----------

  let hintBtn = null, hintBox = null, hintCur = null;
  // Pref quiz.hints (Settings): off hides the hint button (hints already shown stay).
  const hintsOn = () => { try { return !Quiz.prefs || Quiz.prefs.get('quiz.hints') !== false; } catch { return true; } };
  const syncHintBtn = () => { if (hintBtn) hintBtn.classList.toggle('hidden', !hintsOn()); };
  window.addEventListener('quiz:prefs', (e) => { if ((e.detail?.changed || []).includes('quiz.hints')) syncHintBtn(); });

  // Thinking typed into ui/think.js's field (if present) helps Claude find where the learner is stuck.
  function thinkingText() {
    const ta = document.querySelector('#answerExtras details.think-field textarea');
    return ta ? ta.value.trim() : '';
  }

  async function askHint() {
    const cur = hintCur;
    if (!cur || Quiz.revealed) return;
    const level = cur.hints.length;
    if (level >= RUNGS.length) return;
    hintBtn.disabled = true;
    hintBtn.innerHTML = '<span class="spinner"></span>Thinking of a hint…';
    try {
      const data = await Quiz.api('api/practice/hint', {
        ...Quiz.aiRunInfo(), id: cur.question.id, answer: Quiz.$('input').value, level,
        extra: { thinking: thinkingText() || undefined },
      });
      Quiz.adoptSession(data);
      if (cur !== Quiz.current || Quiz.revealed) return;   // moved on, or revealed while the AI was thinking
      cur.hints.push(data.text);
      const el = document.createElement('div');
      el.className = 'px-hint';
      el.innerHTML = `${ic('hint')}<div><div class="px-label">Hint ${level + 1} of ${RUNGS.length} · ${esc(RUNGS[level])}</div>${md(data.text || '')}</div>`;
      hintBox.appendChild(el);
    } catch (e) {
      Quiz.showToast(`Couldn't get a hint: ${e.message}`);
    }
    if (cur !== Quiz.current || !hintBtn) return;   // beforeReveal removed the button meanwhile
    hintBtn.disabled = cur.hints.length >= RUNGS.length;
    hintBtn.innerHTML = cur.hints.length >= RUNGS.length ? `${ic('hint')}No more hints` : `${ic('hint')}Another hint`;
  }

  Quiz.on('showQuestion', (cur) => {
    cur.hints = [];
    hintCur = cur;
    if (hintBtn) hintBtn.remove();   // #revealControls isn't emptied between questions
    hintBtn = null;
    hintBox = document.createElement('div');
    hintBox.className = 'px-hints';
    Quiz.$('answerExtras').appendChild(hintBox);
    if (!Quiz.aiAvailable) return;
    hintBtn = document.createElement('button');
    hintBtn.type = 'button';
    hintBtn.className = 'btn btn-plain px-hint-btn';
    hintBtn.title = `A small nudge, never the answer. Each click goes one step further (up to ${RUNGS.length}).`;
    hintBtn.innerHTML = `${ic('hint')}Hint`;
    hintBtn.onclick = askHint;
    const reveal = Quiz.$('reveal');
    reveal.after(hintBtn);
    syncHintBtn();
  });

  Quiz.on('beforeReveal', () => { if (hintBtn) hintBtn.remove(); hintBtn = null; });

  Quiz.on('payload', (cur) => {
    const out = {};
    if (cur.hints && cur.hints.length) out.hints = cur.hints.length;
    if (cur.ai && cur.ai.status === 'done' && cur.ai.fb.missClass) out.missClass = cur.ai.fb.missClass;
    return out;
  });

  // ---------- after reveal: suggested rating, miss class, calibration ----------

  const capped = (r, cur) => (r && (cur.hints || []).length >= 2 && RANK[r] > RANK.hard ? 'hard' : r);
  const suggestedNow = () => document.querySelector('.rate button.suggested')?.dataset.r || null;

  function renderAfter(cur, fb) {
    const parts = [];
    if (fb.missClass && MISS[fb.missClass]) {
      const [name, meaning] = MISS[fb.missClass];
      parts.push(`<span class="px-chip ${fb.missClass}">${esc(name)}</span><span class="secondary">${esc(meaning)}</span>`);
    }
    if (fb.calibration) parts.push(`<span class="px-line px-cal">${ic('target')}<span>${inline(fb.calibration)}</span></span>`);
    if ((cur.hints || []).length) parts.push(`<span class="px-line">${ic('hint')}<span>${cur.hints.length} hint${cur.hints.length > 1 ? 's' : ''} used</span></span>`);
    if (!parts.length) return;
    const el = document.createElement('div');
    el.className = 'px-after';
    el.innerHTML = parts.join('');
    if (fb.missClass === 'structural') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-tinted';
      b.innerHTML = `${ic('flag')}Add to Study next`;
      b.onclick = async () => {
        b.disabled = true;
        const text = (fb.misconceptions && fb.misconceptions[0] && fb.misconceptions[0].what) || fb.verdict || 'Misconception on this question';
        try {
          await Quiz.api('api/gaps', { id: cur.question.id, text, rating: null, answer: cur.answerText || '' });
          b.innerHTML = `${ic('check')}Added to Study next`;
          Quiz.showToast('Added to Study next. The AI is matching it to your notes…');
          Quiz.loadGaps();
        } catch (e) { b.disabled = false; Quiz.showToast(`Couldn't save it: ${e.message}`); }
      };
      el.appendChild(b);
    }
    Quiz.$('afterExtras').appendChild(el);
  }

  Quiz.on('afterReveal', (cur) => {
    // 2+ hints: whatever an earlier module suggested is capped at "hard" right away.
    const before = suggestedNow();
    if (before && capped(before, cur) !== before) Quiz.suggestRating(capped(before, cur));
    if (!cur.ai) return;
    const started = Date.now();
    const poll = setInterval(() => {
      if (cur !== Quiz.current || !cur.ai || Date.now() - started > 5 * 60 * 1000) return clearInterval(poll);
      if (cur.ai.status === 'pending') return;
      clearInterval(poll);
      if (cur.ai.status !== 'done') return;
      const fb = cur.ai.fb;
      // Written answers: the AI read the reasoning, so its rating wins. Multiple choice: the pick rates it.
      const r = cur.aiFeedbackOnly ? null : capped(fb.suggestedRating, cur);
      if (r) Quiz.suggestRating(r);
      renderAfter(cur, fb);
    }, 1000);
  });

  // ---------- learner model panel (Smart-review tab) ----------

  let panel = null;
  function mountPanel() {
    const host = Quiz.$('smartMore') || Quiz.$('smartExtras');
    if (!host || panel) return;
    panel = document.createElement('details');
    panel.className = 'px-learner';
    panel.innerHTML = `<summary><span class="lead">${ic('person')}</span><span class="grow">What the AI has learned about you<small>Confidence, kinds of misses and recurring misconceptions</small></span>${ic('chevron-right').replace('class="icon ', 'class="icon chev ')}</summary><div class="px-body muted">Loading…</div>`;
    panel.addEventListener('toggle', () => { if (panel.open) loadPanel(); });
    host.appendChild(panel);
  }

  const calWord = (c) => (c.flag === 'over' ? 'over-confident' : c.flag === 'under' ? 'under-confident' : c.flag === 'calibrated' ? 'well calibrated' : 'not enough rated answers yet');

  async function loadPanel() {
    const body = panel.querySelector('.px-body');
    let m;
    try { m = await Quiz.api('api/learner'); } catch (e) { body.textContent = `Couldn't load: ${e.message}`; return; }
    const subj = Object.entries(m.subjects || {}).filter(([, s]) => s.confN);
    const topics = Object.entries(m.topics || {}).sort((a, b) => (b[1].notes || []).length - (a[1].notes || []).length || b[1].answers - a[1].answers);
    const withNotes = topics.filter(([, t]) => (t.notes || []).length);
    const mc = {};
    for (const s of Object.values(m.subjects || {})) for (const [k, n] of Object.entries(s.missClasses || {})) mc[k] = (mc[k] || 0) + n;
    const html = [];
    html.push('<h4>How sure you are vs. how often you\'re right</h4>');
    html.push(subj.length ? `<ul>${subj.map(([name, s]) => `<li>${ic('chart')}<span><b>${esc(name)}</b>: <span class="${s.flag}">${calWord(s)}</span> <span class="secondary">· ${s.avgConfidence}% sure on average, right ${s.accuracyWhenRated}% · ${s.confN} answers${s.highConfidenceWrong ? ` · ${s.highConfidenceWrong} sure but wrong` : ''}</span></span></li>`).join('')}</ul>`
      : '<p class="secondary" style="margin:0">Set “How sure are you?” when answering and this fills in.</p>');
    if (Object.keys(mc).length) {
      html.push('<h4>Kinds of misses</h4>');
      html.push(`<div class="chips">${Object.entries(mc).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="px-chip ${k}">${esc((MISS[k] || [k])[0])} × ${n}</span>`).join('')}</div>`);
    }
    html.push('<h4>Recurring misconceptions & how you reason</h4>');
    if (withNotes.length) {
      html.push(withNotes.slice(0, 6).map(([k, t]) => `<div class="px-topic"><b>${esc(t.topic)}</b> <span class="secondary">${esc(t.subject)}</span>
        <ul style="margin-top:6px">${t.notes.slice(0, 4).map((n) => `<li>${ic(n.kind === 'pattern' ? 'thought' : 'warning')}<span>${inline(n.text)} <span class="secondary">· since ${esc(n.since)}</span></span></li>`).join('')}</ul></div>`).join(''));
    } else html.push('<p class="secondary" style="margin:0">Nothing distilled yet. The AI updates this after every few answers on a topic.</p>');
    const stale = topics.filter(([, t]) => t.pending > 0).slice(0, 5);
    if (stale.length && Quiz.aiAvailable) {
      html.push(`<h4>New answers since the last update</h4><div class="px-topic">${stale.map(([k, t]) => `${esc(t.topic)} <button class="btn btn-plain btn-sm" type="button" data-topic="${esc(k)}">${ic('refresh')}Update</button>`).join(' ')}</div>`);
    }
    body.classList.remove('muted');
    body.innerHTML = html.join('');
    body.querySelectorAll('button[data-topic]').forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>Updating…';
      try { await Quiz.api('api/learner/refresh', { topic: b.dataset.topic }); loadPanel(); } catch (e) { Quiz.showToast(`Couldn't update: ${e.message}`); b.disabled = false; b.innerHTML = `${ic('refresh')}Update`; }
    }));
  }

  mountPanel();
  Quiz.on('tab', (t) => { if (t === 'smart') { mountPanel(); if (panel && panel.open) loadPanel(); } });
})();
