// Multiple-choice answering (server side: mcq.js).
// An "Answer" segmented control on the setup screen: Write / Multiple choice / Auto. Auto = multiple choice
// for new questions and box 0–1 (recognition first), writing from box 2 on (recall once it's sticking).
// Options come from the server without correctness; it's revealed only after the learner commits.
(() => {
  const Q = window.Quiz;
  if (!Q) return;
  const STYLE_KEY = 'answerStyle';
  const IDK = 'idk';
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  const ic = (n) => (Q.icon ? Q.icon(n) : '');
  const PHONE = window.matchMedia('(max-width: 700px)');   // the step-by-step phone flow (CSS: #quiz.mcq-phone)
  const quiz = () => Q.$('quiz');

  const css = document.createElement('style');
  css.textContent = `
    .mcq { margin: 0 0 4px; }
    .mcq .stem { font: var(--headline); margin-bottom: 12px; }
    .mcq .opts { display: flex; flex-direction: column; gap: 8px; }
    /* options: large rounded selectable rows with a radio; the letter shortcut sits quietly on the right */
    .mcq .opt { display: flex; gap: 12px; align-items: flex-start; justify-content: flex-start; width: 100%; min-height: 52px; padding: 14px 16px;
      text-align: left; background: var(--surface-2); color: var(--label); border-radius: var(--r-lg); font: var(--body); line-height: 1.4;
      box-shadow: inset 0 0 0 1px transparent; transition: background var(--dur), box-shadow var(--dur); }
    .mcq .opt:hover:not(:disabled) { background: var(--surface-3); }
    .mcq .opt .radio { flex: none; width: 20px; height: 20px; margin-top: 2px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--separator-strong);
      background: var(--surface); transition: box-shadow var(--dur), background var(--dur); }
    .mcq .opt .txt { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .mcq .opt .k { flex: none; font: 500 12px/1 var(--font); color: var(--label-3); padding: 4px 6px; border-radius: 5px; background: var(--fill); margin-top: 2px; }
    .mcq .opt.sel { background: var(--accent-tint); box-shadow: inset 0 0 0 1.5px var(--accent); }
    .mcq .opt.sel .radio { background: var(--surface); box-shadow: inset 0 0 0 6px var(--accent); }
    .mcq .opt.idk { background: transparent; color: var(--label-2); box-shadow: inset 0 0 0 1px var(--separator); }
    .mcq .opt.idk.sel { color: var(--label); box-shadow: inset 0 0 0 1.5px var(--accent); background: var(--accent-tint); }
    .mcq .opt:disabled { cursor: default; opacity: 1; }
    .mcq .opt.right { background: color-mix(in srgb, var(--green) 13%, var(--surface)); box-shadow: inset 0 0 0 1.5px var(--green); }
    .mcq .opt.right .radio { box-shadow: inset 0 0 0 6px var(--green); }
    .mcq .opt.wrong { background: color-mix(in srgb, var(--red) 10%, var(--surface)); box-shadow: inset 0 0 0 1.5px var(--red); }
    .mcq .opt.wrong .radio { box-shadow: inset 0 0 0 6px var(--red); }
    .mcq .opt .why { display: block; margin-top: 6px; font: var(--footnote); color: var(--label-2); }
    .mcq .row { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-top: 10px; font: var(--footnote); color: var(--label-3); }
    .mcq .loading { display: flex; align-items: center; gap: 10px; padding: 18px 16px; border-radius: var(--r-lg); background: var(--surface-2); font: var(--subhead); color: var(--label-2); }
    .mcq .loading .spinner { margin: 0; }
    .mcq .err { font: var(--subhead); color: var(--label-2); margin: 0; }
    .mcq-result .verdict-line { display: flex; align-items: center; gap: 8px; font: var(--title3); margin: 0; }
    .mcq-result .verdict-line .sure { font: var(--subhead); color: var(--label-2); margin-left: 2px; }
    .mcq-result .expl { margin-top: 10px; background: var(--surface-2); border-radius: var(--r); padding: 10px 14px; font: var(--subhead); }
    .mcq-result details.more { margin-top: 10px; }
    .mcq-result details.more > summary { cursor: pointer; font: var(--subhead); color: var(--accent); padding: 6px 0; list-style: none; }
    .mcq-result details.more > summary::-webkit-details-marker { display: none; }
    .mcq-result details.more[open] > summary { margin-bottom: 8px; }
    .mcq-result details.more .expl { margin: 0 0 10px; }
    /* After checking, the pick is marked on the options themselves: no "Your answer" echo, and the
       reference answer and past answers wait behind "More" (index.html #yoursBox, #refBox, #past). */
    /* confidence first, then the (folded) thinking field: the tap you make on every question sits highest */
    #quiz.mcq-on #answerExtras { display: flex; flex-direction: column; }
    #quiz.mcq-on #answerExtras .think-conf { order: -1; }
    .mcq-result { scroll-margin-bottom: 170px; }
    #quiz.mcq-done #yoursBox, #quiz.mcq-done #past, #quiz.mcq-done:not(.mcq-more) #refBox, #quiz.mcq-done .mcq .row { display: none; }
    @media (max-width: 700px) {
      .mcq .opts { gap: 6px; }
      .mcq .opt { min-height: 48px; padding: 12px 14px; }
    }
    @media (hover: none) and (pointer: coarse) { .mcq .opt .k { display: none; } }

    /* ---- phone: one step at a time, no scrolling to act (#quiz.mcq-phone) ----
       1. choose: just the options, plus small Thinking / Write buttons
       2. picked: all options stay (tap another to change), how sure and Check appear below, one screen
       3. checked: the verdict, all options (right in green, a wrong pick in red), why (this part scrolls); Next sits in the run's bottom bar */
    .mcq .think-btn, .mcq .short { display: none; }
    @media (max-width: 700px) {
      #quiz.mcq-phone .mcq .think-btn { display: inline-flex; }
      #quiz.mcq-phone .mcq .row { margin-top: 12px; justify-content: flex-start; gap: 4px 8px; }
      #quiz.mcq-phone .mcq .row .kh { display: none; }
      #quiz.mcq-phone:not(.mcq-picked):not(.mcq-done) #revealControls { display: none; }
      #quiz.mcq-phone:not(.mcq-picked):not(.mcq-done):not(.mcq-thinking) #answerExtras { display: none; }
      #quiz.mcq-phone:not(.mcq-picked) #answerExtras .think-conf { display: none; }
      #quiz.mcq-phone.mcq-thinking .mcq .think-btn { display: none; }
      #quiz.mcq-phone.mcq-picked .mcq .write { display: none; }
      #quiz.mcq-phone #revealControls { position: static; margin: 16px 0 0; padding: 0; background: none; box-shadow: none;
        -webkit-backdrop-filter: none; backdrop-filter: none; }
      /* step 3: every option stays, compact; the ones you didn't pick and weren't right step back */
      #quiz.mcq-phone.mcq-done .mcq .opts { gap: 8px; }
      #quiz.mcq-phone.mcq-done .mcq .opt { padding: 11px 14px; min-height: 0; font-size: clamp(15px, calc(.8vw + 1.4dvh), 19px); }
      #quiz.mcq-phone.mcq-done .mcq .opt:not(.right):not(.wrong) { color: var(--label-2); }
      #quiz.mcq-phone.mcq-done .mcq .opt:not(.right):not(.wrong) .radio { opacity: .6; }
      #quiz.mcq-phone.mcq-done .mcq .opt.idk:not(.wrong) { display: none; }
      #quiz.mcq-phone.mcq-done .mcq .opt .why { font-size: .85em; line-height: 1.4; }
      #quiz.mcq-phone.mcq-done .mcq .row { display: none; }
      #quiz.mcq-phone .mcq > .verdict-line { display: flex; align-items: center; gap: 8px; font: var(--title3); margin: 0 0 10px; }
      #quiz.mcq-phone .mcq > .verdict-line svg { width: 24px; height: 24px; }
      #quiz.mcq-phone .mcq > .verdict-line.ok svg { color: var(--green); } #quiz.mcq-phone .mcq > .verdict-line.no svg { color: var(--red); }
      #quiz.mcq-phone .mcq > .verdict-line.idk svg { color: var(--label-3); }
      #quiz.mcq-phone .mcq > .verdict-line .sure { font: var(--subhead); color: var(--label-2); }
      #quiz.mcq-phone .mcq-result .picked { margin: 8px 0 0; font: var(--subhead); color: var(--label-2); }
      #quiz.mcq-phone #decideBox { position: static; margin: 12px 0 0; padding: 0; background: none; box-shadow: none;
        -webkit-backdrop-filter: none; backdrop-filter: none; }
      #quiz.mcq-phone #dcNext { display: none; }
      #quiz.mcq-phone.mcq-done #after { margin-top: 4px; padding-top: 0; border-top: 0; }
      #quiz.mcq-phone.mcq-done #after .mcq-result { margin-top: 12px; }
      #quiz.mcq-phone:not(.mcq-thinking) #answerExtras .think-field { display: none; }
      body.quizzing:has(#quiz.mcq-phone:not(.mcq-done)) #chat { display: none; }

      /* Full screen: no card, the question fills the space between the top and the bottom bar. Steps 1–2
         stretch to that height (the options grow, the buttons sit at the bottom by the thumb); step 3 just
         flows and scrolls. Text scales with the screen (vw for width, dvh for height). */
      body.quizzing:has(#quiz.mcq-phone) .wrap { padding: calc(env(safe-area-inset-top) + 10px) 16px 0; }
      body.quizzing:has(#quiz.mcq-phone) .quiz-area { padding-bottom: 0; gap: 16px; }
      #quiz.mcq-phone { background: none; box-shadow: none; border-radius: 0; padding: 0 0 16px; display: flex; flex-direction: column; }
      #quiz.mcq-phone:not(.mcq-done) { min-height: calc(100vh - env(safe-area-inset-top) - 10px - var(--statusbar-h, 44px));
        min-height: calc(100dvh - env(safe-area-inset-top) - 10px - var(--statusbar-h, 44px)); }
      #quiz.mcq-phone .q { font-size: clamp(20px, calc(1.6vw + 2dvh), 32px); line-height: 1.25; }
      #quiz.mcq-phone:not(.mcq-done) > #beforeInput { flex: 1; display: flex; flex-direction: column; }
      #quiz.mcq-phone:not(.mcq-done) .mcq { flex: 1; display: flex; flex-direction: column; margin: 0; }
      #quiz.mcq-phone:not(.mcq-done) .mcq .opts { flex: 1; gap: 10px; }
      #quiz.mcq-phone:not(.mcq-picked):not(.mcq-done) .mcq .opt { flex: 1 1 auto; align-items: center; }
      #quiz.mcq-phone .mcq .opt { font-size: clamp(16px, calc(.9vw + 1.5dvh), 21px); line-height: 1.35; padding: 14px 16px; border-radius: var(--r-xl, 18px);
        transition: padding .2s var(--ease), background var(--dur), box-shadow var(--dur); }
      #quiz.mcq-phone .mcq .opt .radio { margin-top: 0; }
      #quiz.mcq-phone .mcq .opt:not(.sel):not(.right):not(.wrong):not(.idk) { background: var(--surface); box-shadow: var(--shadow-1), 0 0 0 .5px var(--separator); }
      #quiz.mcq-phone .mcq .row { margin-top: 10px; flex-wrap: nowrap; }
      #quiz.mcq-phone .mcq .long { display: none; } #quiz.mcq-phone .mcq .short { display: inline; }
      /* step 2: the options stop stretching to make room for how sure + Check on the same screen */
      #quiz.mcq-phone.mcq-picked .mcq .opts { gap: 8px; }
      #quiz.mcq-phone.mcq-picked .mcq .opt { padding: 11px 14px; min-height: 0; }
      #quiz.mcq-phone.mcq-picked .think-conf { margin-top: 4px; }
      #quiz.mcq-phone.mcq-picked #revealControls { margin-top: 12px; }
      /* only the subject above the question: box, score and focus badges aren't worth the room here */
      #quiz.mcq-phone #meta .badge:not(:first-child) { display: none; }
      #quiz.mcq-phone #meta .badge:first-child { background: none; padding: 0; font: 600 14px/18px var(--font); color: var(--label-2); }
      #quiz.mcq-phone #meta { margin-bottom: 6px; }
      #quiz.mcq-phone .mcq .row .btn { font-size: 16px; min-height: 40px; }
      #quiz.mcq-phone.mcq-picked .think-conf .tc-label { font-size: 17px; }
      #quiz.mcq-phone.mcq-picked .think-conf .segmented button { height: 44px; font-size: 16px; }
      #quiz.mcq-phone #reveal { min-height: 54px; font-size: 18px; }
      #quiz.mcq-phone .mcq-result .expl { font-size: clamp(18px, calc(1vw + 1.6dvh), 22px); line-height: 1.5; padding: 14px 16px; }
      #quiz.mcq-phone .mcq-result .expl .picked { font: inherit; color: var(--label-2); margin-top: 12px; }
      #quiz.mcq-phone .mcq-result details.more > summary { font-size: 18px; padding: 10px 0; }
      #quiz.mcq-phone .mcq-result details.more li { font-size: 17px; line-height: 1.45; }
      body.quizzing:has(#quiz.mcq-phone) .quiz-area { padding-bottom: 24px; }
    }
    .mcq-result .verdict-line svg { width: 24px; height: 24px; }
    .mcq-result .verdict-line.ok svg { color: var(--green); } .mcq-result .verdict-line.no svg { color: var(--red); } .mcq-result .verdict-line.idk svg { color: var(--label-3); }
    .mcq-result ul { list-style: none; padding: 0; margin: 0; background: var(--surface-2); border-radius: var(--r); overflow: hidden; }
    .mcq-result li { position: relative; display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 10px 14px; font: var(--subhead); line-height: 21px; }
    .mcq-result li + li::before { content: ""; position: absolute; top: 0; left: 40px; right: 0; border-top: 1px solid var(--separator); }
    .mcq-result li > svg { width: 17px; height: 17px; margin-top: 2px; flex: none; color: var(--label-4); }
    .mcq-result li.right > svg { color: var(--green); } .mcq-result li.wrong-pick > svg { color: var(--red); }
    .mcq-result li .mine { font: 600 12px/1 var(--font); color: var(--label-2); background: var(--fill); padding: 2px 6px; border-radius: 4px; margin-left: 6px; vertical-align: 1px; }
    .mcq-result .why { color: var(--label-2); margin-top: 2px; }
    .mcq-result .note { display: flex; gap: 6px; align-items: center; color: var(--label-2); font: var(--footnote); margin-top: 12px; }
    .mcq-result .note svg { width: 14px; height: 14px; }
  `;
  document.head.appendChild(css);

  // ---------- answer style: a segmented control on the setup screen ----------
  // Stored values stay 'write' | 'mcq' | 'auto' (localStorage answerStyle).

  const STYLES = [['write', 'Write', 'Type or dictate your answer'], ['mcq', 'Multiple choice', 'Pick from options the AI writes'],
    ['auto', 'Auto', 'Multiple choice for new and weak questions (box 0–1), writing once a question is sticking (box 2+)']];
  const getStyle = () => { try { return localStorage.getItem(STYLE_KEY) || 'write'; } catch { return 'write'; } };
  const controls = [];
  const paintAll = () => controls.forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === getStyle())));
  function addStyleSelect(containerId) {
    const host = Q.$(containerId);
    if (!host) return;
    const row = document.createElement('div');
    row.className = 'opt-row';
    row.innerHTML = `<span class="opt-label">Answer</span><div class="segmented" role="group" aria-label="How to answer">${
      STYLES.map(([v, label, title]) => `<button type="button" data-v="${v}" title="${title}">${label}</button>`).join('')}</div>`;
    const seg = row.querySelector('.segmented');
    seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      try { localStorage.setItem(STYLE_KEY, b.dataset.v); } catch {}
      paintAll();                     // keep both tabs' controls in sync
    }));
    controls.push(seg);
    host.appendChild(row);
    paintAll();
  }
  addStyleSelect('smartExtras');
  addStyleSelect('subjectExtras');

  function usesMcq(cur) {
    const style = getStyle();
    if (style === 'mcq') return true;
    if (style === 'auto') return !cur.stats || cur.stats.box <= 1;
    return false;
  }

  // Thinking + confidence from ui/think.js, if it exposes the current question's widgets.
  function thinkState() {
    const t = Q.think;
    if (!t) return { thinking: '', confidence: null, field: null };
    const field = t.current || null;
    const conf = t.currentConfidence || (field && field.confidence) || null;
    let thinking = '';
    try { thinking = field && typeof field.value === 'string' ? field.value.trim() : ''; } catch {}
    let confidence = null;
    try { confidence = conf && typeof conf.value === 'number' ? conf.value : null; } catch {}
    return { thinking, confidence, field };
  }

  // ---------- question card ----------

  Q.on('showQuestion', (cur) => {
    cur.mcq = null;
    if (!usesMcq(cur)) return;
    const m = cur.mcq = { state: 'loading', choice: null, data: null, result: null, checkPromise: null };
    Q.$('input').classList.add('hidden');
    m.el = document.createElement('div');
    m.el.className = 'mcq';
    Q.$('beforeInput').appendChild(m.el);
    Q.$('quiz').classList.add('mcq-on');
    Q.$('quiz').classList.toggle('mcq-phone', PHONE.matches);
    setRevealLabel('Check');
    load(cur);
  });

  // The main button reads "Check" in multiple choice (index.html resets it to "Show answer" per question).
  function setRevealLabel(text) {
    const b = Q.$('reveal');
    if (b && b.firstChild && b.firstChild.nodeType === 3) b.firstChild.textContent = text + ' ';
  }

  function writeInstead(cur) {
    if (!cur.mcq) return;
    cur.mcq.el.remove();
    cur.mcq = null;
    quiz().classList.remove('mcq-on', 'mcq-phone', 'mcq-picked', 'mcq-thinking');
    setRevealLabel('Show answer');
    Q.$('input').classList.remove('hidden');
    Q.$('input').focus();
  }

  async function load(cur) {
    const m = cur.mcq;
    const started = Date.now();
    const tick = setInterval(() => {
      if (cur.mcq !== m || m.state !== 'loading') return clearInterval(tick);
      const s = m.el.querySelector('.secs');
      if (s) s.textContent = `${Math.round((Date.now() - started) / 1000)}s`;
    }, 1000);
    renderLoading(cur);
    try {
      const data = await Q.api('api/mcq?id=' + encodeURIComponent(cur.question.id));
      if (cur.mcq !== m) return;              // switched to writing, or moved on
      m.data = data;
      m.state = 'ready';
      renderOptions(cur);
    } catch (e) {
      if (cur.mcq !== m) return;
      m.state = 'error';
      m.el.innerHTML = `<p class="err">Couldn't load the options: ${Q.esc(e.message)}</p>
        <div class="row"><button class="btn btn-sm retry" type="button">${ic('refresh')}Try again</button><button class="btn btn-plain btn-sm write" type="button">${ic('pencil')}<span class="long">Answer in writing instead</span><span class="short">Write instead</span></button></div>`;
      m.el.querySelector('.retry').onclick = () => { m.state = 'loading'; load(cur); };
      m.el.querySelector('.write').onclick = () => writeInstead(cur);
    } finally { clearInterval(tick); }
  }

  function renderLoading(cur) {
    const m = cur.mcq;
    m.el.innerHTML = `<div class="loading"><span class="spinner"></span><span>The AI is writing the options… <span class="secs">0s</span><br><span style="color:var(--label-3)">First time only; they're saved for next time.</span></span></div>
      <div class="row"><span></span><button class="btn btn-plain btn-sm write" type="button">${ic('pencil')}<span class="long">Answer in writing instead</span><span class="short">Write instead</span></button></div>`;
    m.el.querySelector('.write').onclick = () => writeInstead(cur);
  }

  function renderOptions(cur) {
    const m = cur.mcq, d = m.data;
    const all = [...d.options, { key: IDK, text: "I don't know", idk: true }];
    // Claude's reworded stem ("Which statement best describes…") isn't shown: the question above says it.
    m.el.innerHTML = `<div class="opts" role="radiogroup">${all.map((o, i) =>
      `<button class="opt${o.idk ? ' idk' : ''}" type="button" role="radio" aria-checked="false" data-key="${Q.esc(o.key)}"><span class="radio"></span><span class="txt">${Q.inline(o.text)}</span><span class="k">${LETTERS[i]}</span></button>`).join('')}</div>
      <div class="row"><span class="kh">Press A–${LETTERS[all.length - 1]} to pick, ⌘↩ to check</span>
      <button class="btn btn-plain btn-sm think-btn" type="button">${ic('mic')}Thinking</button>
      <button class="btn btn-plain btn-sm write" type="button">${ic('pencil')}<span class="long">Answer in writing instead</span><span class="short">Write instead</span></button></div>`;
    m.options = all;
    m.el.querySelectorAll('.opt').forEach((b) => (b.onclick = () => pick(cur, b.dataset.key)));
    m.el.querySelector('.write').onclick = () => writeInstead(cur);
    m.el.querySelector('.think-btn').onclick = () => {
      // Opens the thinking field and starts recording into it (typing when dictation isn't set up).
      quiz().classList.add('mcq-thinking');
      try {
        const f = thinkState().field;
        if (!f) return;
        const micBtn = Q.think.available && f.el.querySelector('.tm-btn');
        if (micBtn) { f.open(); micBtn.click(); } else f.focus();
      } catch {}
    };
  }

  function pick(cur, key) {
    const m = cur.mcq;
    if (!m || m.state !== 'ready' || Q.revealed) return;
    m.choice = key;
    m.el.querySelectorAll('.opt').forEach((b) => { b.classList.toggle('sel', b.dataset.key === key); b.setAttribute('aria-checked', b.dataset.key === key); });
    if (quiz().classList.contains('mcq-phone')) {
      quiz().classList.add('mcq-picked');
      requestAnimationFrame(() => Q.$('reveal').scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }

  // A–E / 1–5 pick before reveal, unless the learner is typing somewhere.
  document.addEventListener('keydown', (e) => {
    const cur = Q.current;
    if (!cur || !cur.mcq || cur.mcq.state !== 'ready' || Q.revealed) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (['TEXTAREA', 'INPUT', 'SELECT'].includes(tag) || (document.activeElement && document.activeElement.isContentEditable)) return;
    const k = e.key.toUpperCase();
    let i = LETTERS.indexOf(k);
    if (i < 0 && /^[1-9]$/.test(e.key)) i = Number(e.key) - 1;
    const opt = cur.mcq.options && cur.mcq.options[i];
    if (opt) { e.preventDefault(); pick(cur, opt.key); }
  });

  // ---------- reveal ----------

  Q.on('beforeReveal', (cur) => {
    const m = cur.mcq;
    if (!m) return;
    const o = m.options && m.options.find((x) => x.key === m.choice);
    if (!o) m.choice = IDK;                    // revealed without picking = "I don't know"
    m.pickedText = o && !o.idk ? o.text : "I don't know";
    cur.answerOverride = o && !o.idk ? `Picked: ${o.text}` : "I don't know";
    const { thinking, confidence } = thinkState();
    m.confidence = confidence;
    // The pick alone is the grade: right or wrong. With written thinking the AI still reads it,
    // but only to comment on the reasoning; its score is never shown or counted.
    cur.skipAiGrade = !thinking;
    cur.aiFeedbackOnly = !!thinking;
    if (m.state === 'ready') {
      m.checkPromise = Q.api('api/mcq/check', { id: cur.question.id, key: m.choice })
        .then((r) => (m.result = r))
        .catch((e) => { m.checkError = e.message; return null; });
    }
  });

  Q.on('afterReveal', async (cur) => {
    const m = cur.mcq;
    if (!m) return;
    m.el.querySelectorAll('.opt').forEach((b) => (b.disabled = true));
    const box = document.createElement('div');
    box.className = 'answer mcq-result';
    Q.$('afterExtras').appendChild(box);
    if (!m.checkPromise) {
      box.innerHTML = '<h3 class="section-label">Result</h3><p class="muted" style="margin:0">The options weren\'t ready, so this one counts as “I don\'t know”.</p>';
      Q.suggestRating('again');
      return;
    }
    box.innerHTML = '<h3 class="section-label">Result</h3><span class="spinner"></span><span class="muted">Checking…</span>';
    const r = await m.checkPromise;
    if (cur !== Q.current) return;
    if (!r) { box.innerHTML = `<h3 class="section-label">Result</h3><p class="muted" style="margin:0">Couldn't check the answer: ${Q.esc(m.checkError || '')}</p>`; return; }
    const onPhone = quiz().classList.contains('mcq-phone');
    quiz().classList.remove('mcq-picked', 'mcq-thinking');
    quiz().classList.add('mcq-done');
    const head = r.dontKnow ? ['idk', 'question', 'You didn\'t know this one'] : r.correct ? ['ok', 'check-circle', 'Correct'] : ['no', 'x-circle', 'Not quite'];
    const sure = typeof m.confidence === 'number' ? `<span class="sure">· you were ${m.confidence}% sure</span>` : '';
    const mine = r.options.find((o) => o.key === m.choice);
    const traps = r.options.filter((o) => !o.correct && o.misconception && o.key !== m.choice);
    const why = r.explanation ? `<div class="expl prose"><b>Why:</b> ${Q.md(r.explanation)}</div>` : '';
    const verdict = `<div class="verdict-line ${head[0]}">${ic(head[1])}${head[2]}${sure}</div>`;
    // Phone: the verdict goes above the options; elsewhere it heads the result box.
    if (onPhone) m.el.insertAdjacentHTML('afterbegin', verdict);
    // Right: just the verdict, the reasoning on request. Wrong or "I don't know": the reason up front.
    box.innerHTML = `${onPhone ? '' : verdict}
      ${r.correct ? '' : why}
      <details class="more"><summary>${r.correct ? 'Why it’s right' : 'More'}</summary>
        ${r.correct ? why : ''}
        ${traps.length ? `<ul>${traps.map((o) => `<li>${ic('minus-circle')}<div>${Q.inline(o.text)}<div class="why">Trap: ${Q.inline(o.misconception)}</div></div></li>`).join('')}</ul>` : ''}
        <div class="note">${ic('info')}Multiple choice counts for less: it can't take a question past box 2. Answer in writing to master it.</div>
      </details>`;
    // A miss: bring the explanation into view above the bottom bar (a right answer needs no reading).
    // On a phone the whole result starts at the top instead.
    if (onPhone) window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (!r.correct) requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    // "More" also opens the reference answer (and past answers stay out of the way).
    const more = box.querySelector('details.more');
    more.addEventListener('toggle', () => Q.$('quiz').classList.toggle('mcq-more', more.open));
    // Mark the options on the card; a wrong pick shows the mix-up behind it right where you tapped.
    m.el.querySelectorAll('.opt').forEach((b) => {
      const o = r.options.find((x) => x.key === b.dataset.key);
      b.classList.remove('sel');
      if (o && o.correct) b.classList.add('right');
      else if (b.dataset.key === m.choice) {
        b.classList.add('wrong');
        if (mine && mine.misconception) b.querySelector('.txt').insertAdjacentHTML('beforeend', `<span class="why">Trap: ${Q.inline(mine.misconception)}</span>`);
      }
    });
    cur.pickScore = r.correct ? 100 : 0;
    // The rating comes from the pick. 2+ hints or low confidence cap a right pick at Hard (as ui/practice.js does).
    const hinted = (cur.hints || []).length >= 2;
    if (!r.correct) Q.suggestRating('again');
    else if (hinted || (typeof m.confidence === 'number' && m.confidence <= 50)) Q.suggestRating('hard');
    else Q.suggestRating('good');
  });

  // ---------- saved data ----------

  Q.on('payload', (cur) => {
    const m = cur.mcq;
    if (!m || !Q.revealed) return null;
    const out = { format: 'mcq', choice: m.pickedText || "I don't know" };
    if (m.result) out.correct = !!m.result.correct;
    return out;
  });

  // Test mode scores multiple choice as 100 / 0 from the pick, even when the AI read the thinking.
  // The promise covers rating before the check returns.
  Q.on('resultItem', (cur) => {
    const m = cur.mcq;
    if (!m) return null;
    if (m.result) return { format: 'mcq', aiScore: m.result.correct ? 100 : 0, aiPromise: Promise.resolve(m.result.correct ? 100 : 0) };
    if (m.checkPromise) return { format: 'mcq', aiPromise: m.checkPromise.then((r) => (r ? (r.correct ? 100 : 0) : null)) };
    return { format: 'mcq', aiScore: 0, aiPromise: Promise.resolve(0) };   // revealed before options loaded = didn't know
  });

  // ---------- warm the cache for a run ----------

  Q.on('runStart', (kind) => {
    if (kind === 'smart' || getStyle() === 'write') return;     // Smart review picks one at a time
    const s = Q.session;
    if (!s || !Array.isArray(s.queue)) return;
    const ids = s.queue
      .filter((item) => getStyle() === 'mcq' || !item.stats || item.stats.box <= 1)
      .slice(0, 15).map((item) => item.question.id);
    if (ids.length) Q.api('api/mcq/warm', { ids }).catch(() => {});
  });
})();
