// Interview tab (computer only): live mock coding interviews with an AI interviewer.
// Server: interview.js + interview-problems.js (see docs/INTERVIEW-PLAN.md).
//
// Screens, all inside #tab-interview except the call:
//   home     next problem + Start, the patterns he knows, every eligible NVIDIA problem, past interviews
//   room     the call, full screen (body.interview-on): call bar, problem, Python editor, board
//   session  ?tab=interview&session=<id>: the debrief, hidden-test verdict and a replay
//
// The call: Quiz.handsfree keeps the mic open (Whisper on the server); this file is its talk target
// (Quiz.talkTarget). The interviewer's sentences arrive over SSE and are spoken with the server's local
// voice (POST api/voice/tts {purpose: 'live'}), else the browser's. Speaking cuts the interviewer off.
// Code snapshots go up when typing pauses, the board when it changes, the mic recording every 5 s.
(() => {
  const Q = window.Quiz;
  if (!Q) return;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const esc = (s) => Q.esc(String(s ?? ''));
  const HERE = new URL('.', (document.currentScript && document.currentScript.src) || location.href);
  const $tab = () => document.getElementById('tab-interview');
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const parseT = (s) => { const m = /^(\d+):(\d{2})$/.exec(String(s || '').trim()); return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null; };
  const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const isPhone = () => matchMedia('(max-width: 700px)').matches || (matchMedia('(pointer: coarse)').matches && innerWidth < 1000);
  const OVERALL = { strong_hire: ['Strong hire', 'green'], hire: ['Hire', 'green'], lean_no: ['Lean no hire', 'orange'], no_hire: ['No hire', 'red'] };
  const AREAS = { communication: 'Communication', problem_solving: 'Problem solving', coding: 'Coding', verification: 'Verification' };
  const DIFF = { Easy: 'green', Medium: 'orange', Hard: 'red' };
  const MODEL_NAMES = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', 'gemini-flash': 'Gemini Flash', 'gemini-pro': 'Gemini Pro', 'gemini-flash-lite': 'Gemini Flash-Lite' };
  // The picker stores a tier (sonnet = faster, opus = deeper); on a Gemini engine (Settings → AI) it reads Flash / Pro.
  let ivEngine = 'claude';
  const isGem = () => String(ivEngine).startsWith('gemini');
  const pickName = (k) => (isGem() ? { sonnet: 'Gemini Flash', opus: 'Gemini Pro' } : { sonnet: 'Sonnet', opus: 'Opus' })[k] || MODEL_NAMES[k] || k;

  const css = `
  @media (max-width: 700px) { .side .tab[data-tab="interview"] { display: none; } }
  #tab-interview { max-width: 1100px; }
  .iv-card { background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1); padding: var(--sp5); margin-bottom: var(--sp5); }
  .iv-next { display: grid; grid-template-columns: 1fr auto; gap: var(--sp4); align-items: center; }
  .iv-next h2 { font: var(--title2); margin: 2px 0 6px; }
  .iv-next .iv-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: var(--label-2); font: var(--subhead); }
  .iv-go { display: flex; flex-direction: column; gap: var(--sp2); align-items: stretch; min-width: 220px; }
  .iv-sub { font: var(--footnote); color: var(--label-2); }
  .iv-pats { display: flex; flex-wrap: wrap; gap: 6px; margin-top: var(--sp2); }
  .iv-pat { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 14px; border: 1px solid var(--separator-strong);
    background: transparent; color: var(--label-2); font: 500 13px/1 var(--font); cursor: pointer; }
  .iv-pat.on { background: var(--accent-tint); border-color: transparent; color: var(--accent); font-weight: 600; }
  .iv-pat small { font: 12px var(--font); color: var(--label-3); }
  .iv-pat svg { width: 14px; height: 14px; }
  .iv-banner { display: flex; gap: var(--sp3); align-items: center; padding: var(--sp3) var(--sp4); border-radius: var(--r); background: color-mix(in srgb, var(--green) 12%, transparent); margin-bottom: var(--sp4); }
  .iv-banner p { margin: 0; flex: 1; }
  .iv-rows { display: flex; flex-direction: column; }
  .iv-row { display: grid; grid-template-columns: 1fr auto auto; gap: var(--sp3); align-items: center; padding: 10px 0; border-top: 1px solid var(--separator); }
  .iv-row:first-child { border-top: 0; }
  .iv-row .t { font: var(--body); }
  .iv-row .t small { display: block; font: var(--footnote); color: var(--label-2); margin-top: 2px; }
  .iv-row .st { font: var(--footnote); color: var(--label-2); white-space: nowrap; }
  .iv-row button { white-space: nowrap; }
  .iv-h { display: flex; align-items: baseline; gap: var(--sp3); margin: 0 0 var(--sp3); }
  .iv-h h3 { font: var(--headline); margin: 0; }
  .iv-h .iv-sub { margin-left: auto; }
  .iv-diff { font: 600 12px/1 var(--font); padding: 3px 7px; border-radius: 6px; }
  .iv-diff.green { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
  .iv-diff.orange { color: var(--orange); background: color-mix(in srgb, var(--orange) 14%, transparent); }
  .iv-diff.red { color: var(--red); background: color-mix(in srgb, var(--red) 14%, transparent); }
  .iv-badge { display: inline-flex; align-items: center; gap: 4px; font: 600 12px/1 var(--font); padding: 4px 8px; border-radius: 6px; background: var(--fill); color: var(--label-2); }
  .iv-badge.green { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
  .iv-badge.orange { color: var(--orange); background: color-mix(in srgb, var(--orange) 14%, transparent); }
  .iv-badge.red { color: var(--red); background: color-mix(in srgb, var(--red) 14%, transparent); }
  .iv-models { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sp3); }
  .iv-models div { background: var(--surface-2); border-radius: var(--r); padding: var(--sp3); }
  .iv-models b { font: var(--headline); }
  .iv-phone { padding: var(--sp6); text-align: center; color: var(--label-2); }

  /* ---------- the call ---------- */
  body.interview-on { overflow: hidden; }
  .iv-room { position: fixed; inset: 0; z-index: 60; display: grid; grid-template-rows: auto 1fr; background: var(--window); }
  .iv-bar { display: flex; align-items: center; gap: var(--sp3); padding: 10px var(--sp4); background: var(--material-thick); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); border-bottom: 1px solid var(--separator); min-width: 0; }
  .iv-who { display: flex; align-items: center; gap: 10px; flex: none; }
  .iv-av { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-tint); color: var(--accent); position: relative; }
  .iv-av svg { width: 20px; height: 20px; }
  .iv-av::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--accent); opacity: 0; transform: scale(.9); transition: opacity .2s, transform .2s; }
  .iv-room.ai-speaking .iv-av::after { opacity: .7; transform: scale(1); animation: iv-pulse 1.1s var(--ease) infinite; }
  @keyframes iv-pulse { 50% { transform: scale(1.08); opacity: .35; } }
  .iv-who b { display: block; font: var(--subhead); font-weight: 600; }
  .iv-who span { display: block; font: var(--caption); color: var(--label-2); }
  .iv-cap { flex: 1; min-width: 0; font: var(--callout); color: var(--label); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .iv-cap.me { color: var(--label-2); font-style: italic; }
  .iv-mic { display: flex; align-items: center; gap: 6px; flex: none; color: var(--label-2); }
  .iv-mic svg { width: 18px; height: 18px; }
  .iv-lvl { width: 54px; height: 6px; border-radius: 3px; background: var(--fill); overflow: hidden; }
  .iv-lvl i { display: block; height: 100%; width: 0; background: var(--green); transition: width .08s linear; }
  .iv-mic.hearing svg { color: var(--green); }
  .iv-mic.muted svg { color: var(--red); }
  .iv-time { font: 600 15px/1 var(--font-mono); padding: 6px 10px; border-radius: 8px; background: var(--fill); flex: none; }
  .iv-time.low { color: var(--orange); }
  .iv-time.out { color: var(--red); }
  .iv-acts { display: flex; gap: 6px; flex: none; }
  .iv-acts .btn svg { width: 16px; height: 16px; }
  .iv-main { position: relative; display: grid; grid-template-columns: var(--iv-prob, 340px) minmax(280px, 1fr) var(--iv-board, 40%); min-height: 0; }
  .iv-room.no-prob .iv-main { --iv-prob: 0px !important; }
  .iv-room.no-board .iv-main { --iv-board: 0px !important; }
  .iv-grip { position: absolute; top: 0; bottom: 0; width: 10px; margin-left: -5px; cursor: col-resize; z-index: 4; }
  .iv-grip::after { content: ''; position: absolute; left: 4px; top: 0; bottom: 0; width: 2px; background: transparent; transition: background .15s; }
  .iv-grip:hover::after, .iv-grip.drag::after { background: var(--accent); }
  .iv-room.no-prob .iv-grip[data-g="prob"], .iv-room.no-board .iv-grip[data-g="board"] { display: none; }
  .iv-room.dragging .iv-pane { pointer-events: none; user-select: none; }
  .iv-room.dragging { cursor: col-resize; }
  .iv-paused { position: absolute; inset: 0; z-index: 6; display: grid; place-items: center; background: color-mix(in srgb, var(--window) 88%, transparent); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .iv-paused > div { text-align: center; }
  .iv-paused h2 { font: var(--title1); margin: 0 0 var(--sp2); }
  .iv-paused p { color: var(--label-2); margin: 0 0 var(--sp4); }
  .iv-pre .iv-field { display: flex; align-items: center; gap: var(--sp2); margin: var(--sp3) 0; flex-wrap: wrap; }
  .iv-pre .iv-field label { font: var(--subhead); font-weight: 600; min-width: 130px; }
  .iv-pre select { min-width: 240px; }
  .iv-pane { min-height: 0; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--separator); background: var(--surface); }
  .iv-pane:last-child { border-right: 0; }
  .iv-room.no-prob .iv-prob, .iv-room.no-board .iv-board { display: none; }
  .iv-ph { display: flex; align-items: center; gap: var(--sp2); padding: 8px var(--sp3); border-bottom: 1px solid var(--separator); font: var(--footnote); font-weight: 600; color: var(--label-2); flex: none; }
  .iv-ph .sp { flex: 1; }
  .iv-prob .iv-body { overflow: auto; padding: var(--sp4); font: var(--subhead); line-height: 1.55; }
  .iv-prob h1 { font: var(--title3); margin: 0 0 var(--sp2); }
  .iv-prob h3 { font: var(--headline); margin: var(--sp4) 0 var(--sp2); }
  .iv-prob pre { white-space: pre-wrap; }
  .iv-ed { flex: 1; min-height: 0; }
  .iv-bd { flex: 1; min-height: 0; position: relative; }
  .iv-pre { position: fixed; inset: 0; z-index: 61; display: grid; place-items: center; background: var(--window); padding: var(--sp6); }
  .iv-pre .iv-card { max-width: 560px; width: 100%; }
  .iv-pre h2 { font: var(--title2); margin: 0 0 var(--sp2); }
  .iv-pre ul { margin: var(--sp3) 0; padding-left: 1.2em; color: var(--label-2); }
  .iv-pre li { margin: 4px 0; }
  .iv-pre .iv-lvl { width: 100%; height: 8px; margin: var(--sp3) 0; }
  .iv-over { position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--window) 82%, transparent); z-index: 5; }
  .iv-over > div { text-align: center; }
  .iv-modal { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: rgba(0,0,0,.35); }
  .iv-modal .alert { background: var(--surface); border-radius: var(--r-xl); box-shadow: var(--shadow-3); padding: var(--sp5); max-width: 380px; width: calc(100% - 32px); }
  .iv-modal .alert h3 { font: var(--headline); margin: 0 0 var(--sp2); }
  .iv-modal .alert p { margin: 0 0 var(--sp4); color: var(--label-2); }
  .iv-modal .alert .row { display: flex; gap: var(--sp2); justify-content: flex-end; }

  /* ---------- session: debrief + replay ---------- */
  .iv-top { display: flex; align-items: center; gap: var(--sp3); flex-wrap: wrap; margin-bottom: var(--sp4); }
  .iv-top h2 { font: var(--title2); margin: 0; }
  .iv-top .sp { flex: 1; }
  .iv-sum { font: var(--body); line-height: 1.5; margin: 0 0 var(--sp4); }
  .iv-work ol { margin: 0; padding-left: 1.3em; }
  .iv-work li { margin: 6px 0; line-height: 1.45; }
  .iv-scores { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: var(--sp3); }
  .iv-score { background: var(--surface-2); border-radius: var(--r); padding: var(--sp3) var(--sp4); }
  .iv-score .n { font: 700 22px/1 var(--font-rounded, var(--font)); }
  .iv-score .n small { font: 13px var(--font); color: var(--label-2); }
  .iv-score .n.s4, .iv-score .n.s3 { color: var(--green); } .iv-score .n.s2 { color: var(--orange); } .iv-score .n.s1 { color: var(--red); }
  .iv-score h4 { font: var(--subhead); font-weight: 600; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: baseline; }
  .iv-score p { margin: 0 0 6px; font: var(--footnote); color: var(--label); }
  .iv-ev { font: var(--footnote); color: var(--label-2); margin: 3px 0; }
  .iv-ts { font: 600 12px/1 var(--font-mono); color: var(--accent); background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; }
  .iv-ts:hover { text-decoration: underline; }
  .iv-tl { list-style: none; padding: 0; margin: 0; }
  .iv-tl li { display: flex; gap: var(--sp2); padding: 5px 0; align-items: baseline; }
  .iv-tl .k { width: 8px; height: 8px; border-radius: 50%; flex: none; margin-top: 4px; background: var(--label-3); }
  .iv-tl .k.good { background: var(--green); } .iv-tl .k.concern { background: var(--red); } .iv-tl .k.hint { background: var(--orange); }
  .iv-fail { font: 12px/1.5 var(--font-mono); background: var(--surface-2); border-radius: var(--r-sm); padding: 8px 10px; margin: 6px 0; white-space: pre-wrap; word-break: break-all; }
  .iv-player { display: flex; align-items: center; gap: var(--sp3); margin-bottom: var(--sp3); }
  .iv-player .tm { font: 13px var(--font-mono); color: var(--label-2); min-width: 104px; }
  .iv-scrub { position: relative; flex: 1; height: 28px; cursor: pointer; }
  .iv-scrub .tr { position: absolute; left: 0; right: 0; top: 12px; height: 4px; border-radius: 2px; background: var(--fill); }
  .iv-scrub .pg { position: absolute; left: 0; top: 12px; height: 4px; border-radius: 2px; background: var(--accent); }
  .iv-scrub .mk { position: absolute; top: 6px; width: 3px; height: 16px; border-radius: 2px; margin-left: -1px; background: var(--label-3); }
  .iv-scrub .mk.hint { background: var(--orange); } .iv-scrub .mk.done { background: var(--blue); } .iv-scrub .mk.done.ok { background: var(--green); }
  .iv-scrub .mk.done.bad { background: var(--red); } .iv-scrub .mk.silence { background: var(--label-4); }
  .iv-rp { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--sp3); }
  .iv-tr { max-height: 460px; overflow: auto; background: var(--surface-2); border-radius: var(--r); padding: var(--sp2); }
  .iv-tr div { padding: 6px 8px; border-radius: 8px; font: var(--footnote); line-height: 1.45; cursor: pointer; }
  .iv-tr div:hover { background: var(--fill); }
  .iv-tr div.cur { background: var(--accent-tint); }
  .iv-tr div b { font-weight: 600; margin-right: 4px; }
  .iv-tr div.ai b { color: var(--accent); }
  .iv-tr div.ev { color: var(--label-2); font-style: italic; }
  .iv-rcode { height: 300px; border-radius: var(--r); overflow: hidden; border: 1px solid var(--separator); }
  .iv-rboard { margin-top: var(--sp2); border-radius: var(--r); border: 1px solid var(--separator); background: #fff; min-height: 60px; display: grid; place-items: center; overflow: hidden; }
  .iv-rboard img { max-width: 100%; max-height: 260px; display: block; }
  .iv-rboard span { color: #888; font: var(--footnote); padding: var(--sp3); }
  .iv-stars button { background: none; border: 0; font-size: 22px; cursor: pointer; color: var(--label-4); padding: 0 2px; }
  .iv-stars button.on { color: var(--yellow); }
  details.iv-ref summary { cursor: pointer; font: var(--subhead); font-weight: 600; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- small helpers ----------
  function confirmBox(title, text, ok = 'OK', danger = false) {
    return new Promise((resolve) => {
      const m = el(`<div class="iv-modal"><div class="alert" role="alertdialog"><h3>${esc(title)}</h3><p>${esc(text)}</p>
        <div class="row"><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-a="yes">${esc(ok)}</button></div></div></div>`);
      const done = (v) => { m.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      m.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (a) done(a.dataset.a === 'yes'); else if (e.target === m) done(false); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(m);
      m.querySelector('[data-a="yes"]').focus();
    });
  }
  // Q.md has no headings; LeetCode statements use "### Example 1".
  function richMd(src) {
    const out = [];
    let buf = [], fence = false;
    const flush = () => { if (buf.length) out.push(Q.md(buf.join('\n'))); buf = []; };
    // Example blocks: Input / Output / Explanation each on their own line.
    const text = String(src || '').replace(/\n(\*\*(Input|Output|Explanation)\b)/g, '\n\n$1');
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) fence = !fence;
      const h = !fence && /^#{1,6}\s+(.*)$/.exec(line);
      if (h) { flush(); out.push(`<h3>${Q.inline(h[1])}</h3>`); } else buf.push(line);
    }
    flush();
    return out.join('');
  }
  function bestBrowserVoice() {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const en = vs.filter((v) => /^en[-_]/i.test(v.lang));
    return en.find((v) => /premium/i.test(v.name)) || en.find((v) => /enhanced/i.test(v.name)) || en.find((v) => /natural|neural/i.test(v.name)) || en.find((v) => v.lang === 'en-US') || en[0] || null;
  }
  // The TTS request for a sentence in this interview's voice (null: the browser speaks).
  const ttsBody = (text, v) => (v && v.engine === 'elevenlabs' ? { text, purpose: 'interview', engine: 'elevenlabs' } : { text, purpose: 'interview', voice: (v && v.voice) || undefined });
  const diff = (d) => `<span class="iv-diff ${DIFF[d] || ''}">${esc(d)}</span>`;
  const verdictBadge = (v) => !v ? '' : v.ok ? `<span class="iv-badge green">${icon('check')}All ${v.total} tests pass</span>`
    : v.tooSlow ? `<span class="iv-badge orange">Correct but too slow</span>` : `<span class="iv-badge red">${v.passed}/${v.total} tests pass</span>`;
  const overallBadge = (o) => (o && OVERALL[o] ? `<span class="iv-badge ${OVERALL[o][1]}">${OVERALL[o][0]}</span>` : '');
  const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function setSessionParam(id, push = true) {
    const p = new URLSearchParams(location.search);
    p.set('tab', 'interview');
    if (id) p.set('session', id); else p.delete('session');
    const url = `${location.pathname}?${p}`;
    if (url !== location.pathname + location.search) history[push ? 'pushState' : 'replaceState']({ tab: 'interview' }, '', url);
  }
  function route() {
    if (Q.tab !== 'interview') return;
    const id = new URLSearchParams(location.search).get('session');
    if (id) showSession(id); else showHome();
  }
  window.addEventListener('popstate', () => { if (Q.tab === 'interview' && !room) route(); });
  Q.on('tab', (t) => { if (t === 'interview') route(); else stopPolling(); });

  // ---------- home ----------
  let pollTimer = 0;
  const stopPolling = () => { clearTimeout(pollTimer); pollTimer = 0; };
  let homeData = null;

  async function showHome() {
    stopPolling();
    disposeSession();
    const root = $tab();
    if (!root) return;
    if (!homeData) root.innerHTML = '<p class="muted"><span class="activity"></span> Loading…</p>';
    try { homeData = await Q.api('api/interview/home'); } catch (e) { root.innerHTML = `<p class="muted">Couldn't load interviews: ${esc(e.message)}</p>`; return; }
    if (Q.tab !== 'interview' || new URLSearchParams(location.search).get('session')) return;
    renderHome(homeData);
    // Problems being prepared: check back.
    if (homeData.problems.some((p) => p.prep && (p.prep.state === 'running' || p.prep.state === 'queued')) || homeData.sessions.some((s) => s.debriefState === 'pending')) {
      pollTimer = setTimeout(() => { if (Q.tab === 'interview' && !room) showHome(); }, 6000);
    }
  }

  function renderHome(d) {
    const root = $tab();
    ivEngine = d.engine || 'claude';
    const model = store.get('interview.model', 'sonnet');
    const ready = d.problems.filter((p) => p.ready);
    const next = d.problems[0] || null;
    const pick = next && next.ready ? next : ready[0] || null;
    const known = new Set(d.patterns.known);
    const prepLabel = (p) => p.ready ? 'Ready' : !p.prep ? 'Not prepared' : p.prep.state === 'running' ? 'Preparing…' : p.prep.state === 'queued' ? 'Queued' : p.prep.state === 'failed' ? 'Couldn’t prepare' : '';
    const sugg = d.suggestions.map((s) => `<div class="iv-banner">${icon('sparkles')}<p>You learned <b>${esc(s.name)}</b> (${esc(s.source)}). Add it to interviews?${s.unlocks ? ` ${s.unlocks} more NVIDIA problem${s.unlocks === 1 ? '' : 's'}.` : ''}</p>
      <button class="btn btn-primary btn-sm" data-add="${esc(s.pattern)}">Add</button><button class="btn btn-plain btn-sm" data-dismiss="${esc(s.pattern)}">Not now</button></div>`).join('');
    const phone = isPhone();
    const liveRow = d.sessions.find((x) => x.state === 'live');
    root.innerHTML = `
      ${liveRow && !phone ? `<div class="iv-banner" style="background:color-mix(in srgb, var(--orange) 14%, transparent)">${icon('headphones')}<p>An interview is still running: <b>${esc(liveRow.title)}</b>.</p>
        <button class="btn btn-primary btn-sm" data-rejoin="${esc(liveRow.id)}">Rejoin</button><button class="btn btn-plain btn-sm" data-endlive="${esc(liveRow.id)}">End it</button></div>` : ''}
      ${sugg}
      ${phone ? `<div class="iv-card iv-phone">${icon('person')}<p>Interviews need a computer: an editor, a board and a microphone. Your past interviews are below.</p></div>` : `
      <div class="iv-card iv-next">
        <div>
          <div class="iv-sub">${pick && next && pick.slug !== next.slug ? 'Ready now (the next one is still being prepared)' : 'Next interview'}</div>
          ${pick ? `<h2>${esc(pick.title)}</h2>
          <div class="iv-meta">${diff(pick.difficulty)}<span>NVIDIA frequency ${Math.round(pick.score)}</span>${pick.recent ? `<span class="iv-badge accent">Asked in the last ${pick.recent.window === '30d' ? '30 days' : pick.recent.window === '3m' ? '3 months' : '6 months'}</span>` : ''}
          ${pick.done ? `<span>· done ${pick.done}×</span>` : ''}</div>`
          : `<h2>Preparing your first problems…</h2><div class="iv-sub"><span class="activity"></span> The AI writes each problem's tests and checks them (about a minute each).</div>`}
        </div>
        <div class="iv-go">
          <div class="segmented" id="ivModel">${['sonnet', 'opus'].map((k) => `<button type="button" data-v="${k}" aria-pressed="${k === model}">${pickName(k).replace('Gemini ', '')}</button>`).join('')}</div>
          <button class="btn btn-primary btn-lg" id="ivStart" ${pick ? '' : 'disabled'}>${icon('headphones')} Start interview</button>
          <div class="iv-sub">45 minutes · Python · voice call. Headphones work best.</div>
        </div>
      </div>`}

      <div class="iv-card">
        <div class="iv-h"><h3>Patterns you know</h3><span class="iv-sub">Only problems you can solve with these come up. Click to add or remove.</span></div>
        <div class="iv-pats">${Object.entries(d.patterns.all).map(([k, name]) => {
          const n = (d.patterns.next.find((x) => x.pattern === k) || {}).unlocks;
          return `<button class="iv-pat ${known.has(k) ? 'on' : ''}" data-pat="${esc(k)}" title="${known.has(k) ? 'Known: click to remove' : 'Click to add'}">${known.has(k) ? icon('check') : icon('plus')}${esc(name)}${!known.has(k) && n ? ` <small>+${n}</small>` : ''}</button>`;
        }).join('')}</div>
        ${d.patterns.next.length ? `<p class="iv-sub" style="margin-top:10px">Learn next: <b>${esc(d.patterns.next[0].name)}</b> unlocks ${d.patterns.next[0].unlocks} more NVIDIA problems${d.patterns.next[1] ? `, then ${esc(d.patterns.next[1].name)} (${d.patterns.next[1].unlocks})` : ''}.</p>` : ''}
      </div>

      ${d.sessions.length ? `<div class="iv-card">
        <div class="iv-h"><h3>Past interviews</h3><span class="iv-sub">${d.sessions.length} interview${d.sessions.length === 1 ? '' : 's'}</span></div>
        <div class="iv-rows">${d.sessions.map((s) => `<div class="iv-row">
          <div class="t">${esc(s.title)} ${diff(s.difficulty)}<small>${fmtDate(s.startedAt)} · ${MODEL_NAMES[s.model] || esc(s.model)} · ${s.hints} hint${s.hints === 1 ? '' : 's'}${s.state === 'live' ? ' · in progress' : ''}</small></div>
          <div class="st">${s.debriefState === 'pending' ? '<span class="activity"></span> Writing debrief…' : `${verdictBadge(s.verdict)} ${overallBadge(s.overall)}`}</div>
          <button class="btn btn-sm" data-open="${esc(s.id)}">Open</button></div>`).join('')}</div>
        ${d.trend ? `<div class="iv-h" style="margin-top:var(--sp4)"><h3>Your scores</h3><span class="iv-sub">average of the last 5${Object.values(d.trend).some((x) => x.before) ? ' (before that)' : ''} · out of 4</span></div>
          <div class="iv-scores">${Object.entries(AREAS).map(([k, name]) => { const x = d.trend[k] || {}; return `<div class="iv-score"><h4>${name}<span class="n s${Math.round(x.recent || 0)}">${x.recent ?? '–'}${x.before ? `<small> (${x.before})</small>` : ''}</span></h4></div>`; }).join('')}</div>` : ''}
        ${Object.keys(d.models).length > 1 ? `<div class="iv-h" style="margin-top:var(--sp4)"><h3>Interviewers compared</h3></div><div class="iv-models">${Object.entries(d.models).map(([k, m]) => `<div><b>${MODEL_NAMES[k] || esc(k)}</b><div class="iv-sub">${m.sessions} interview${m.sessions === 1 ? '' : 's'} · first words in ${m.latency ? (m.latency / 1000).toFixed(1) + ' s' : '?'} (median) · your rating ${m.rating ?? '–'}/5</div></div>`).join('')}</div>` : ''}
      </div>` : ''}

      <div class="iv-card">
        <div class="iv-h"><h3>NVIDIA problems you can do</h3><span class="iv-sub">${d.problems.length} problems · ${d.problems.filter((p) => p.ready).length} ready · in the order they'll come</span></div>
        <div class="iv-rows">${d.problems.map((p) => `<div class="iv-row">
          <div class="t">${esc(p.title)} ${diff(p.difficulty)}<small>${p.patterns.map((k) => esc(d.patterns.all[k] || k)).join(' · ')} · NVIDIA ${Math.round(p.score)}${p.done ? ` · done ${p.done}×` : ''}${p.prep && p.prep.state === 'failed' ? ` · <span title="${esc(p.prep.error || '')}">couldn’t prepare</span>` : ''}</small></div>
          <div class="st">${p.prep && p.prep.state === 'running' ? '<span class="activity"></span> ' : ''}${prepLabel(p)}</div>
          ${p.ready ? (phone ? '' : `<button class="btn btn-sm" data-start="${esc(p.slug)}">Start</button>`) : p.prep && (p.prep.state === 'running' || p.prep.state === 'queued') ? '<span></span>' : `<button class="btn btn-sm btn-plain" data-prep="${esc(p.slug)}">${p.prep && p.prep.state === 'failed' ? 'Try again' : 'Prepare'}</button>`}
        </div>`).join('')}</div>
      </div>`;
    const seg = root.querySelector('#ivModel');
    if (seg) seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; store.set('interview.model', b.dataset.v); seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
    const startBtn = root.querySelector('#ivStart');
    if (startBtn) startBtn.onclick = () => pick && openRoom(pick.slug);
    root.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.start) openRoom(b.dataset.start);
        else if (b.dataset.rejoin) rejoin(b.dataset.rejoin);
        else if (b.dataset.endlive) { await Q.api(`api/interview/${b.dataset.endlive}/end`, { reason: 'ended by you' }); setTimeout(showHome, 1500); }
        else if (b.dataset.open) { setSessionParam(b.dataset.open); showSession(b.dataset.open); }
        else if (b.dataset.prep) { b.disabled = true; await Q.api('api/interview/problems/prepare', { slug: b.dataset.prep }); showHome(); }
        else if (b.dataset.pat) {
          const on = !b.classList.contains('on');
          if (!on && !(await confirmBox('Remove this pattern?', `Problems that need ${d.patterns.all[b.dataset.pat]} won't come up until you add it back.`, 'Remove'))) return;
          await Q.api('api/interview/patterns', { pattern: b.dataset.pat, known: on }); showHome();
        } else if (b.dataset.add) { await Q.api('api/interview/patterns', { pattern: b.dataset.add, known: true }); Q.showToast('Added. Its problems are being prepared.'); showHome(); }
        else if (b.dataset.dismiss) { await Q.api('api/interview/patterns', { dismiss: b.dataset.dismiss }); showHome(); }
      } catch (err) { Q.showToast(err.message); }
    };
  }

  // ---------- the call ----------
  let room = null;

  async function openRoom(slug) {
    if (room) return;
    if (isPhone()) { Q.showToast('Interviews need a computer.'); return; }
    stopPolling();
    let prob;
    try { prob = await Q.api(`api/interview/problems/${encodeURIComponent(slug)}`); } catch (e) { Q.showToast(e.message); return; }
    const model = store.get('interview.model', 'sonnet');
    // Before joining: a mic check (and the browser's mic permission, asked once).
    const pre = el(`<div class="iv-pre"><div class="iv-card">
      <h2>${esc(prob.title)}</h2>
      <div class="iv-meta" style="display:flex;gap:6px;align-items:center;color:var(--label-2)">${diff(prob.difficulty)} <span>Interviewer: ${pickName(model)} · 45 minutes · Python</span></div>
      <ul>
        <li>It's a call: just talk. Pause and the interviewer hears you; talk over it to cut it off.</li>
        <li>Think out loud, use the board for your approach, then code. You can't run the code.</li>
        <li>Say “I'm done” (or press I'm done) when you think it works. Hints cost points, like a real interview.</li>
        <li>Headphones are best, so the interviewer doesn't hear itself.</li>
      </ul>
      <div class="iv-field"><label for="ivVoice">Interviewer voice</label><select class="field" id="ivVoice"><option>Loading voices…</option></select>
        <button class="btn btn-sm" data-a="preview" title="Hear this voice">${icon('play')} Preview</button></div>
      <div class="iv-sub iv-voicenote" style="margin:-4px 0 8px"></div>
      <div class="iv-field"><label for="ivPhones">Headphones</label><input type="checkbox" class="switch" id="ivPhones" ${store.get('interview.headphones', '1') === '1' ? 'checked' : ''}>
        <span class="iv-sub">On: just start talking to cut the interviewer off. Off (speakers): you need to talk louder, so it doesn't hear itself.</span></div>
      <div class="iv-sub">${icon('mic')} Say something to check your mic:</div>
      <div class="iv-lvl"><i></i></div>
      <div style="display:flex;gap:var(--sp2);justify-content:flex-end;margin-top:var(--sp4)">
        <button class="btn" data-a="cancel">Cancel</button><button class="btn btn-primary" data-a="join" disabled>${icon('headphones')} Join call</button></div>
    </div></div>`);
    document.body.appendChild(pre);
    let testStream = null, testCtx = null, raf = 0;
    const cleanupTest = () => { cancelAnimationFrame(raf); if (testStream) testStream.getTracks().forEach((t) => t.stop()); if (testCtx) testCtx.close().catch(() => {}); };
    try {
      testStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      testCtx = new AudioContext();
      const an = testCtx.createAnalyser(); an.fftSize = 1024;
      testCtx.createMediaStreamSource(testStream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const bar = pre.querySelector('.iv-lvl i');
      const loop = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; bar.style.width = Math.min(100, Math.sqrt(s / buf.length) * 900) + '%'; raf = requestAnimationFrame(loop); };
      loop();
      pre.querySelector('[data-a="join"]').disabled = false;
    } catch (e) {
      pre.querySelector('.iv-sub').innerHTML = `${icon('warning')} No microphone: ${esc(e.name === 'NotAllowedError' ? 'allow the mic in the browser’s site settings, then try again.' : e.message)}`;
    }
    // Voices: ElevenLabs (natural; uses the account's credits) when it's set up, and the free local voices.
    const sel = pre.querySelector('#ivVoice'), note = pre.querySelector('.iv-voicenote');
    let vstat = null;
    try { vstat = await Q.api('api/voice/status'); } catch {}
    const eleven = !!(vstat && vstat.usable);
    const locals = (vstat && vstat.local && vstat.local.installed && vstat.local.voices) || [];
    sel.innerHTML = (eleven ? `<option value="elevenlabs">${esc((vstat.voice && vstat.voice.name) || 'ElevenLabs')} (natural, ElevenLabs)</option>` : '')
      + locals.map((v) => `<option value="${esc(v.id)}">${esc(v.name)} (free, on the server) · ${esc(v.note || '')}</option>`).join('')
      + '<option value="browser">The browser’s voice</option>';
    const saved = store.get('interview.voice', eleven ? 'elevenlabs' : 'af_heart');
    sel.value = [...sel.options].some((o) => o.value === saved) ? saved : sel.options[0].value;
    const paintNote = () => {
      if (sel.value === 'elevenlabs') {
        const sub = vstat.subscription;
        note.textContent = `Sounds the most human. An interview uses about 2–4k characters${sub && sub.limit ? ` (${(sub.limit - sub.used).toLocaleString()} of ${sub.limit.toLocaleString()} left this month)` : ''}; if they run out, the free voice takes over.`;
      } else note.textContent = sel.value === 'browser' ? '' : 'Free, made on the server. Try Heart or Michael if George sounds stiff.';
    };
    paintNote();
    sel.onchange = () => { store.set('interview.voice', sel.value); paintNote(); };
    pre.querySelector('#ivPhones').onchange = (e) => store.set('interview.headphones', e.target.checked ? '1' : '0');
    let previewAudio = null;
    pre.querySelector('[data-a="preview"]').onclick = async (e) => {
      e.stopPropagation();
      if (previewAudio) previewAudio.pause();
      const v = sel.value;
      try {
        const text = 'Hi, thanks for joining. Take a moment to read the problem, and tell me how you would approach it.';
        if (v === 'browser') { const u = new SpeechSynthesisUtterance(text); const bv = bestBrowserVoice(); if (bv) u.voice = bv; speechSynthesis.speak(u); return; }
        const r = v === 'elevenlabs' ? await Q.api('api/voice/tts', { text, purpose: 'interview', engine: 'elevenlabs' }) : await Q.api('api/voice/preview', { voice: v });
        previewAudio = new Audio(new URL(r.url, location.href).href); previewAudio.play();
      } catch (err) { Q.showToast(`Couldn't play it: ${err.message}`); }
    };
    if (!(Q.think && Q.think.available)) pre.querySelector('.iv-sub').insertAdjacentHTML('afterend', `<p class="iv-sub" style="color:var(--orange)">Dictation (Whisper) isn't available on the server, so the interviewer can't hear you.</p>`);
    pre.onclick = async (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'preview') return;
      cleanupTest();
      if (previewAudio) previewAudio.pause();
      pre.remove();
      if (b.dataset.a === 'join') startCall(slug, prob, model, null, { voice: sel.value, headphones: pre.querySelector('#ivPhones').checked });
      else showHome();
    };
  }

  // resume: rejoining a call still running on the server (after a reload): { session, serverNow, turn, code }.
  async function startCall(slug, prob, model, resume, opts = {}) {
    if (room) return;
    let st = resume;
    if (!st) { try { st = await Q.api('api/interview/start', { slug, model, voice: opts.voice === 'browser' ? null : opts.voice }); } catch (e) { Q.showToast(e.message); return; } }
    const browserOnly = opts.voice === 'browser' || (resume && resume.browserOnly);
    const headphones = opts.headphones ?? store.get('interview.headphones', '1') === '1';
    const skew = st.serverNow - Date.now();
    const S = st.session;
    const voice = S.voice || null;
    // Interview time (pauses don't count), as the server counts it.
    let pausedMs = S.pausedMs || 0, pausedAt = 0;
    const tNow = () => Date.now() + skew - S.startedAt - pausedMs - (pausedAt ? Date.now() - pausedAt : 0);
    document.body.classList.add('interview-on');
    const root = el(`<div class="iv-room ${innerWidth < 1250 ? 'no-board' : ''}">
      <div class="iv-bar">
        <div class="iv-who"><div class="iv-av">${icon('person')}</div><div><b>Interviewer</b><span class="iv-state">Joining…</span></div></div>
        <div class="iv-cap" aria-live="polite"></div>
        <div class="iv-mic" title="Your microphone">${icon('mic')}<div class="iv-lvl"><i></i></div></div>
        <div class="iv-time" title="Time left">45:00</div>
        <div class="iv-acts">
          <button class="btn btn-sm" data-a="prob" title="Show or hide the problem">${icon('note')}</button>
          <button class="btn btn-sm" data-a="board" title="Show or hide the board">${icon('board')}</button>
          <button class="btn btn-sm" data-a="mute" title="Mute your mic">${icon('mic')}</button>
          <button class="btn btn-sm" data-a="pause" title="Pause the interview (the clock stops)">${icon('pause')} Pause</button>
          <button class="btn btn-sm" data-a="hint" title="Ask for a hint (costs points)">${icon('hint')} Hint</button>
          <button class="btn btn-sm btn-tinted" data-a="done" title="Tell the interviewer you're done">${icon('check')} I'm done</button>
          <button class="btn btn-sm btn-destructive" data-a="end">End</button>
        </div>
      </div>
      <div class="iv-main">
        <div class="iv-pane iv-prob"><div class="iv-ph">${icon('note')} Problem</div><div class="iv-body"><h1>${esc(prob.title)}</h1>${richMd(prob.statement)}</div></div>
        <div class="iv-pane"><div class="iv-ph">${icon('terminal')} solution.py<span class="sp"></span><span class="iv-sub">Python 3 · you can't run it</span></div><div class="iv-ed"></div></div>
        <div class="iv-pane iv-board"><div class="iv-ph">${icon('board')} Board<span class="sp"></span><span class="iv-sub">the interviewer sees what you draw</span></div><div class="iv-bd"></div></div>
        <div class="iv-grip" data-g="prob" title="Drag to resize (double-click to reset)"></div><div class="iv-grip" data-g="board" title="Drag to resize (double-click to reset)"></div>
      </div>
    </div>`);
    document.body.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const capEl = $('.iv-cap'), stateEl = $('.iv-state'), timeEl = $('.iv-time');

    // --- resizable panes: drag the dividers; widths are remembered ---
    const main = $('.iv-main');
    const widths = { prob: Number(store.get('interview.w.prob', 0)) || 340, board: Number(store.get('interview.w.board', 0)) || 0 };
    function layout() {
      const W = main.clientWidth;
      const probW = root.classList.contains('no-prob') ? 0 : Math.max(200, Math.min(widths.prob, W - 520));
      const boardW = root.classList.contains('no-board') ? 0 : Math.max(240, Math.min(widths.board || Math.round(W * 0.4), W - probW - 300));
      main.style.setProperty('--iv-prob', `${probW}px`);
      main.style.setProperty('--iv-board', `${boardW}px`);
      $('.iv-grip[data-g="prob"]').style.left = `${probW}px`;
      $('.iv-grip[data-g="board"]').style.left = `${W - boardW}px`;
    }
    main.querySelectorAll('.iv-grip').forEach((g) => {
      g.addEventListener('dblclick', () => { widths[g.dataset.g] = g.dataset.g === 'prob' ? 340 : 0; store.set(`interview.w.${g.dataset.g}`, ''); layout(); });
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        g.setPointerCapture(e.pointerId);
        g.classList.add('drag'); root.classList.add('dragging');
        const box = main.getBoundingClientRect();
        const move = (ev) => {
          if (g.dataset.g === 'prob') widths.prob = ev.clientX - box.left;
          else widths.board = box.right - ev.clientX;
          layout();
        };
        const up = () => {
          g.classList.remove('drag'); root.classList.remove('dragging');
          g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up);
          store.set(`interview.w.${g.dataset.g}`, String(Math.round(widths[g.dataset.g])));
        };
        g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
      });
    });
    const ro = new ResizeObserver(layout); ro.observe(main);
    layout();
    const post = (body) => Q.api(`api/interview/${S.id}/event`, { t: Math.round(tNow()), ...body }).catch((e) => console.warn('[interview] event failed:', e.message));

    const r = room = { id: S.id, ended: false };

    // --- editor ---
    const startCode = (resume && resume.code) || prob.starter;
    const ed = Q.editor.mount($('.iv-ed'), { doc: startCode, onPause: (code) => post({ type: 'code', code }), pauseMs: 1500 });
    let lastCodeSent = startCode;
    const flushCode = async () => { const code = ed.get(); if (code !== lastCodeSent) { lastCodeSent = code; await post({ type: 'code', code }); } };
    ed.ready.then(() => ed.focus());

    // --- board ---
    let cv = null, boardTimer = 0;
    async function mountBoard() {
      if (cv || root.classList.contains('no-board')) return;
      try {
        if (!Q.canvas) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('canvas.js', HERE).href; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        await Q.canvas.load();
        cv = Q.canvas.mount($('.iv-bd'), { lesson: true, minRows: 8, onChange: () => { clearTimeout(boardTimer); boardTimer = setTimeout(sendBoard, 2500); } });
      } catch (e) { $('.iv-bd').innerHTML = `<p class="iv-sub" style="padding:16px">The board couldn't load: ${esc(e.message)}</p>`; }
    }
    async function sendBoard() {
      if (!cv || r.ended) return;
      let desc = cv.describe();
      desc = typeof desc === 'string' ? desc : JSON.stringify(desc);
      const freehand = /freehand/.test(desc);
      let png = null;
      try {
        if (cv.learnerElements().length) {
          const blob = await cv.snapshotPng({ maxSize: 1200 });
          png = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        }
      } catch {}
      post({ type: 'board', desc, png, freehand });
    }
    mountBoard();

    // --- the interviewer's voice ---
    const queue = [];             // {turn, seq, text} waiting to be spoken
    const audios = new Map();     // `${turn}:${seq}` → Promise<Audio|null>
    const dropTurns = new Set();  // turns he cut off: their remaining sentences are dropped
    let current = null;           // the sentence playing
    let heard = [];               // sentences of the current turn already started
    let lastAiText = '', thinking = false, streamDone = new Set();
    let interrupted = null;       // {heard, unheard} for his next message
    let ttsOk = null;
    if (resume) for (let k = 1; k <= resume.turn; k++) dropTurns.add(k);   // already said before the reload
    const synth = window.speechSynthesis || null;
    const voiceRate = () => { const v = Number(Q.prefs && Q.prefs.get ? Q.prefs.get('voice.speed') : 1); return v >= 0.5 && v <= 2 ? v : 1; };
    const forSpeech = (t) => String(t).replace(/[[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
    function serverVoice() {
      if (!ttsOk) ttsOk = Q.api('api/voice/status').then((s) => !!(s && ((s.local && s.local.installed && s.local.state !== 'error') || (voice && voice.engine === 'elevenlabs' && s.usable)))).catch(() => false);
      return ttsOk;
    }
    function audioFor(it) {
      const k = `${it.turn}:${it.seq}`;
      if (!audios.has(k)) audios.set(k, serverVoice().then((ok) => (!ok || browserOnly ? null : Q.api('api/voice/tts', ttsBody(forSpeech(it.text), voice)).then((d) => {
        if (!d || !d.url) return null;
        const a = new Audio(); a.preload = 'auto'; a.src = new URL(d.url, location.href).href; return a;
      }))).catch(() => null));
      return audios.get(k);
    }
    let token = 0;
    function hush() {
      token++;
      if (synth) synth.cancel();
      if (current && current.audio) { current.audio.onended = current.audio.onerror = null; current.audio.pause(); }
      current = null;
    }
    function speak(it) {
      const my = ++token;
      return new Promise((resolve) => {
        let fin = false;
        const end = () => { if (fin) return; fin = true; clearTimeout(guard); resolve(); };
        const guard = setTimeout(end, forSpeech(it.text).split(/\s+/).length * 900 + 5000);
        const browser = () => {
          if (my !== token || !synth) return end();
          const u = new SpeechSynthesisUtterance(forSpeech(it.text));
          const bv = bestBrowserVoice(); if (bv) { u.voice = bv; u.lang = bv.lang; }
          u.rate = voiceRate(); u.onend = end; u.onerror = end;
          speak.u = u; synth.speak(u);
        };
        audioFor(it).then((a) => {
          if (my !== token) return end();
          if (!a) return browser();
          current = { it, audio: a };
          a.playbackRate = voiceRate();
          a.onended = end;
          a.onerror = () => (my === token ? browser() : end());
          a.play().catch(() => (my === token ? browser() : end()));
        });
      });
    }
    let pumping = false;
    async function pump() {
      if (pumping) return;
      pumping = true;
      while (queue.length && !r.ended) {
        const it = queue.shift();
        if (dropTurns.has(it.turn)) continue;
        if (queue[0]) audioFor(queue[0]);
        if (!heard.length || heard[0].turn !== it.turn) heard = [];
        heard.push(it);
        lastAiText = (lastAiText + ' ' + it.text).slice(-600);
        current = { it };
        root.classList.add('ai-speaking');
        capEl.classList.remove('me');
        capEl.textContent = it.text;
        stateEl.textContent = 'Speaking · talk or Esc to cut in';
        post({ type: 'spoke', turn: it.turn, seq: it.seq });
        await speak(it);
        current = null;
      }
      pumping = false;
      root.classList.remove('ai-speaking');
      if (!r.ended) stateEl.textContent = thinking ? 'Thinking…' : 'Listening';
    }
    const aiBusy = () => !!current || queue.some((x) => !dropTurns.has(x.turn));

    Q.talkTarget = {
      interrupt() {
        if (!aiBusy()) return;
        const turn = (current && current.it.turn) || (queue[0] && queue[0].turn);
        interrupted = { heard: heard.filter((x) => x.turn === turn).map((x) => x.text).join(' '), unheard: queue.filter((x) => x.turn === turn).length };
        if (turn) dropTurns.add(turn);
        queue.length = 0;
        hush();
        root.classList.remove('ai-speaking');
      },
      send(text, meta = {}) {
        if (r.ended) return;
        capEl.classList.add('me');
        capEl.textContent = `You: ${text}`;
        const body = { type: 'said', text, dur: meta.ms || null };
        if (interrupted) { body.interrupted = interrupted; interrupted = null; }
        body.t = Math.max(0, Math.round(tNow() - (meta.ms || 0) - 600));   // when he started talking (roughly)
        flushCode().then(() => Q.api(`api/interview/${S.id}/event`, body)).catch((e) => console.warn(e));
      },
      speaking: () => aiBusy(),
      hint: () => `Coding interview in Python. Problem: ${prob.title}. Terms: hash map, dictionary, two pointers, sliding window, stack, binary search, array, index, O of n, time complexity, space complexity, edge case, brute force.`,
      said: () => lastAiText,
      typing: () => ed.typing(),
      easyBargeIn: () => headphones,
    };
    // Esc cuts the interviewer off (when talking over it isn't picked up).
    const onKey = (e) => { if (e.key === 'Escape' && aiBusy() && !document.querySelector('.iv-modal')) { e.preventDefault(); Q.talkTarget && Q.talkTarget.interrupt(); stateEl.textContent = 'Listening'; } };
    document.addEventListener('keydown', onKey, true);

    // --- the stream ---
    const es = new EventSource(`api/interview/${S.id}/stream`);
    const on = (type, f) => es.addEventListener(type, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} f(d); });
    on('thinking', () => { thinking = true; if (!aiBusy()) stateEl.textContent = 'Thinking…'; });
    on('say', (d) => {
      thinking = false;
      if (dropTurns.has(d.turn) || r.ended) return;
      queue.push(d);
      audioFor(d);
      pump();
    });
    on('turn', (d) => { thinking = false; streamDone.add(d.turn); if (!aiBusy()) stateEl.textContent = 'Listening'; });
    on('verdict-pending', () => { stateEl.textContent = 'Checking your code…'; });
    on('state', (d) => { if (typeof d.pausedMs === 'number') { pausedMs = d.pausedMs; if (!d.paused) pausedAt = 0; } if (d.paused !== isPaused) setPaused(d.paused, true); });
    on('fail', (d) => { thinking = false; Q.showToast(`The interviewer had a problem: ${d.message}`); });
    on('ended', (d) => finish(d.reason, true));
    es.onerror = () => { /* EventSource reconnects by itself; Last-Event-ID replays what was missed */ };

    // --- mic: hands-free talk + the recording ---
    const micEl = $('.iv-mic'), lvl = $('.iv-mic .iv-lvl i');
    let muted = false;
    const unsub = Q.handsfree.subscribe(() => {
      const s = Q.handsfree.state;
      micEl.classList.toggle('hearing', s === 'hearing');
      if (s === 'hearing') { stateEl.textContent = 'Hearing you'; }
      else if (s === 'transcribing') stateEl.textContent = 'Got it…';
      else if (!aiBusy()) stateEl.textContent = thinking ? 'Thinking…' : 'Listening';
      lvl.style.width = Math.min(100, Q.handsfree.level * 900) + '%';
    });
    Q.handsfree.start();
    let rec = null, recStream = null, upload = Promise.resolve();
    // (A rejoined call isn't recorded: a second recording can't be appended to the first one's file.)
    if (!resume) try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      if (mime) {
        rec = new MediaRecorder(recStream, { mimeType: mime, audioBitsPerSecond: 32000 });
        rec.ondataavailable = (e) => {
          if (!e.data || !e.data.size) return;
          const blob = e.data;
          upload = upload.then(() => fetch(`api/interview/${S.id}/audio`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: blob })).catch((err) => console.warn('[interview] audio upload:', err.message));
        };
        rec.start(5000);
        post({ type: 'mic' });
      }
    } catch (e) { console.warn('[interview] no recording:', e.message); }

    // --- timer ---
    const tick = setInterval(() => {
      const left = S.durationMs - tNow();
      timeEl.textContent = left >= 0 ? mmss(left) : `+${mmss(-left)}`;
      timeEl.classList.toggle('low', left < 10 * 60000 && left >= 0);
      timeEl.classList.toggle('out', left < 0);
    }, 500);

    // --- pause ---
    let isPaused = false, pausedEl = null;
    async function setPaused(on, fromServer) {
      if (on === isPaused || r.ended) return;
      isPaused = on;
      if (!fromServer) {
        try { const d = await Q.api(`api/interview/${S.id}/pause`, { paused: on }); pausedMs = d.pausedMs; } catch (e) { Q.showToast(e.message); isPaused = !on; return; }
      }
      const pb = $('[data-a="pause"]');
      if (on) {
        pausedAt = Date.now();
        // Whatever it was saying stops, and the rest of that turn is dropped.
        Q.talkTarget.interrupt(); interrupted = null;
        for (const it of queue) dropTurns.add(it.turn);
        queue.length = 0; hush();
        if (!muted) Q.handsfree.stop();
        if (rec && rec.state === 'recording') rec.pause();
        pausedEl = el(`<div class="iv-paused"><div><h2>Paused</h2><p>The clock is stopped and the interviewer is waiting.</p>
          <button class="btn btn-primary btn-lg" data-a="resume">${icon('play')} Resume</button></div></div>`);
        pausedEl.querySelector('[data-a="resume"]').onclick = () => setPaused(false);
        main.appendChild(pausedEl);
        pb.innerHTML = `${icon('play')} Resume`;
        stateEl.textContent = 'Paused';
      } else {
        pausedAt = 0;
        if (pausedEl) { pausedEl.remove(); pausedEl = null; }
        if (!muted) Q.handsfree.start();
        if (rec && rec.state === 'paused') rec.resume();
        pb.innerHTML = `${icon('pause')} Pause`;
        stateEl.textContent = 'Listening';
      }
    }

    // Rejoined while paused: show the paused screen (the server is still paused).
    if (resume && resume.paused) setPaused(true, true);

    // --- buttons ---
    const leaveGuard = (e) => { if (!r.ended) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', leaveGuard);
    $('.iv-acts').onclick = async (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || r.ended) return;
      const a = b.dataset.a;
      if (a === 'pause') { setPaused(!isPaused); return; }
      if (isPaused && a !== 'end') return;
      if (a === 'prob') { root.classList.toggle('no-prob'); layout(); }
      else if (a === 'board') { root.classList.toggle('no-board'); layout(); mountBoard(); }
      else if (a === 'mute') {
        if (isPaused) return;
        muted = !muted;
        if (muted) Q.handsfree.stop(); else Q.handsfree.start();
        micEl.classList.toggle('muted', muted);
        b.innerHTML = icon(muted ? 'speaker-off' : 'mic');
        b.title = muted ? 'Unmute your mic' : 'Mute your mic';
      } else if (a === 'hint') { await flushCode(); post({ type: 'hint' }); stateEl.textContent = 'Thinking…'; }
      else if (a === 'done') { await flushCode(); post({ type: 'done' }); stateEl.textContent = 'Checking your code…'; }
      else if (a === 'end') {
        if (await confirmBox('End the interview?', 'The interviewer writes your debrief right after (about a minute).', 'End interview', true)) {
          await flushCode();
          Q.api(`api/interview/${S.id}/end`, { reason: 'ended by you' }).catch(() => {});
          finish('ended by you');
        }
      }
    };

    async function finish(reason, fromServer) {
      if (r.ended) return;
      r.ended = true;
      queue.length = 0;
      // Let the closing words play out when time ran out; otherwise stop at once.
      if (!(fromServer && /time/.test(reason || ''))) hush();
      else await new Promise((res) => { const w = () => (aiBusy() ? setTimeout(w, 300) : res()); setTimeout(w, 300); setTimeout(res, 15000); });
      hush();
      es.close();
      clearInterval(tick);
      ro.disconnect();
      document.removeEventListener('keydown', onKey, true);
      unsub();
      Q.handsfree.stop();
      Q.talkTarget = null;
      window.removeEventListener('beforeunload', leaveGuard);
      if (rec && rec.state !== 'inactive') { await new Promise((res) => { rec.onstop = res; rec.stop(); setTimeout(res, 2000); }); }
      if (recStream) recStream.getTracks().forEach((t) => t.stop());
      await upload;
      clearTimeout(boardTimer);
      if (cv) cv.dispose();
      ed.dispose();
      root.remove();
      document.body.classList.remove('interview-on');
      room = null;
      homeData = null;
      setSessionParam(S.id);
      showSession(S.id);
    }
  }

  async function rejoin(id) {
    if (room || isPhone()) return;
    try {
      const d = await Q.api(`api/interview/${encodeURIComponent(id)}`);
      if (!d.live) { Q.showToast('That interview has ended.'); showHome(); return; }
      const s = d.session;
      await startCall(s.slug, d.problem, s.model, { session: { id: s.id, startedAt: s.startedAt, durationMs: s.durationMs, model: s.model, voice: s.voice, pausedMs: d.livePausedMs }, serverNow: d.serverNow, turn: d.liveTurn, code: d.liveCode, paused: d.livePaused, browserOnly: !s.voice });
    } catch (e) { Q.showToast(e.message); }
  }

  // ---------- session: debrief + replay ----------
  let sess = null;   // the open session view (replay state)
  function disposeSession() { if (sess) { sess.dispose(); sess = null; } }

  async function showSession(id) {
    stopPolling();
    disposeSession();
    const root = $tab();
    root.innerHTML = '<p class="muted"><span class="activity"></span> Loading…</p>';
    let d;
    try { d = await Q.api(`api/interview/${encodeURIComponent(id)}`); } catch (e) { root.innerHTML = `<p class="muted">${esc(e.message)}</p><button class="btn" data-back>Back to interviews</button>`; root.querySelector('[data-back]').onclick = back; return; }
    if (Q.tab !== 'interview') return;
    renderSession(d);
    if (d.session.debrief && d.session.debrief.state === 'pending' || d.session.state === 'live') {
      pollTimer = setTimeout(() => { if (Q.tab === 'interview' && new URLSearchParams(location.search).get('session') === id && !room) showSession(id); }, 5000);
    }
  }
  function back() { setSessionParam(null); showHome(); }

  function renderSession(d) {
    const root = $tab();
    const s = d.session, db = s.debrief || {}, prob = d.problem || {};
    const dur = Math.max(1000, (s.endedAt || Date.now()) - s.startedAt - (s.pausedMs || 0));
    const ts = (t) => { const ms = typeof t === 'number' ? t : parseT(t); return ms === null ? esc(t || '') : `<button class="iv-ts" data-seek="${ms}">${mmss(ms)}</button>`; };
    const run = s.finalRun;
    const stars = (s.rating && s.rating.stars) || 0;
    root.innerHTML = `
      <div class="iv-top"><button class="btn btn-sm" data-a="back">${icon('chevron-left')} Interviews</button>
        <h2>${esc(s.title)}</h2>${diff(s.difficulty)}<span class="sp"></span>
        <span class="iv-sub">${fmtDate(s.startedAt)} · ${mmss(dur)} · ${MODEL_NAMES[s.model] || esc(s.model)} · ${s.hints.length} hint${s.hints.length === 1 ? '' : 's'}</span>
        <button class="btn btn-sm btn-plain" data-a="delete" title="Delete this interview">${icon('trash')}</button></div>
      ${s.state === 'live' ? `<div class="iv-card"><span class="activity"></span> This interview is still in progress. <button class="btn btn-primary btn-sm" data-a="rejoin">Rejoin</button></div>` : ''}
      <div class="iv-card">
        ${db.state === 'pending' ? `<p><span class="activity"></span> Writing your debrief… (about a minute)</p>`
        : db.state === 'failed' ? `<p>The debrief failed: ${esc(db.error || '')}</p><button class="btn btn-sm" data-a="redebrief">Try again</button>`
        : db.state === 'ready' ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:var(--sp3)">${overallBadge(db.overall)} ${verdictBadge(s.verdict)}</div>
          <p class="iv-sum">${esc(db.summary || '')}</p>
          <div class="iv-work"><div class="iv-h"><h3>Work on</h3></div><ol>${(db.workOn || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
      </div>
      ${db.state === 'ready' ? `
      <div class="iv-card"><div class="iv-h"><h3>Scores</h3><span class="iv-sub">4 strong · 3 solid · 2 weak · 1 lacking</span></div>
        <div class="iv-scores">${Object.entries(AREAS).map(([k, name]) => { const a = (db.scores || {})[k] || {}; return `<div class="iv-score">
          <h4>${name}<span class="n s${a.score || 0}">${a.score || '?'}<small>/4</small></span></h4><p>${esc(a.why || '')}</p>
          ${(a.evidence || []).map((e) => `<div class="iv-ev">${ts(e.t)}${esc(e.note)}</div>`).join('')}</div>`; }).join('')}</div></div>
      <div class="iv-card"><div class="iv-h"><h3>Key moments</h3></div>
        <ul class="iv-tl">${(db.timeline || []).slice().sort((a, b) => (parseT(a.t) ?? 0) - (parseT(b.t) ?? 0)).map((x) => `<li><span class="k ${esc(x.kind)}"></span><span>${ts(x.t)} ${esc(x.note)}</span></li>`).join('')}</ul></div>
      <div class="iv-card"><div class="iv-h"><h3>Code review</h3></div>
        ${db.codeReview ? `<p>${esc(db.codeReview.summary || '')}</p><p class="iv-sub">Yours: ${esc(db.codeReview.yours || '?')} · Best: ${esc(db.codeReview.best || '?')}</p>
        ${(db.codeReview.issues || []).length ? `<ul>${db.codeReview.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${db.codeReview.better ? `<p>${esc(db.codeReview.better)}</p>` : ''}` : ''}
        ${run ? `<div class="iv-h" style="margin-top:var(--sp3)"><h3>Hidden tests</h3><span class="iv-sub">your final code</span></div>
          <p>${run.compileError ? `Doesn't run: ${esc(run.compileError)}` : run.ok ? `All ${run.total} pass.` : run.tooSlow ? `Correct on the small inputs, but too slow on the large ones (${run.passed}/${run.total}).` : `${run.passed}/${run.total} pass.`}</p>
          ${(run.failing || []).slice(0, 3).map((f) => `<div class="iv-fail">input:    ${esc(f.args)}\nexpected: ${esc(f.expected)}\n${f.error ? `error:    ${esc(f.error)}${f.line ? ` (line ${f.line})` : ''}` : `got:      ${esc(f.got)}`}</div>`).join('')}` : ''}
        ${prob.reference ? `<details class="iv-ref"><summary>Reference solution (${esc((prob.complexity || {}).time || '')})</summary><pre><code>${esc(prob.reference)}</code></pre></details>` : ''}
        ${prob.url ? `<p class="iv-sub"><a href="${esc(prob.url)}" target="_blank" rel="noopener">Open on LeetCode ${icon('external')}</a></p>` : ''}
      </div>` : ''}
      <div class="iv-card"><div class="iv-h"><h3>Replay</h3><span class="iv-sub">${d.hasAudio ? 'your voice + the interviewer' : 'no mic recording'} · markers: hints, “done”, silences</span></div>
        <div class="iv-player"><button class="btn btn-sm" data-a="play">${icon('play')}</button><span class="tm">00:00 / ${mmss(dur)}</span>
          <div class="iv-scrub"><div class="tr"></div><div class="pg"></div></div>
          <div class="segmented" data-a="speed"><button data-v="1" aria-pressed="true">1×</button><button data-v="1.5">1.5×</button><button data-v="2">2×</button></div></div>
        <div class="iv-rp"><div class="iv-tr"></div><div><div class="iv-rcode"></div><div class="iv-rboard"><span>No board yet</span></div></div></div>
      </div>
      ${s.state === 'ended' ? `<div class="iv-card"><div class="iv-h"><h3>How was the interviewer?</h3><span class="iv-sub">${MODEL_NAMES[s.model] || ''}: helps compare interviewers</span></div>
        <div class="iv-stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" class="${n <= stars ? 'on' : ''}" aria-label="${n} stars">★</button>`).join('')}</div></div>` : ''}`;
    sess = replay(root, d, dur);
    root.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.seek) { sess.seek(Number(b.dataset.seek)); sess.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (!sess.playing) sess.play(); return; }
      if (b.dataset.star) {
        await Q.api(`api/interview/${s.id}/rate`, { stars: Number(b.dataset.star) }).catch((err) => Q.showToast(err.message));
        root.querySelectorAll('[data-star]').forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= Number(b.dataset.star)));
        return;
      }
      const a = b.dataset.a || (b.closest('[data-a]') && b.closest('[data-a]').dataset.a);
      if (a === 'back') back();
      else if (a === 'rejoin') rejoin(s.id);
      else if (a === 'redebrief') { await Q.api(`api/interview/${s.id}/redebrief`, {}); showSession(s.id); }
      else if (a === 'delete') {
        if (await confirmBox('Delete this interview?', 'Its recording and debrief are deleted. The note in your vault stays.', 'Delete', true)) {
          await Q.api(`api/interview/${s.id}/delete`, {}); homeData = null; back();
        }
      }
    };
  }

  // The replay: one clock (ms since the start) drives the transcript highlight, the code, the board,
  // his recorded voice (slaved to the clock) and the interviewer's sentences (local voice, cached).
  function replay(root, d, dur) {
    const s = d.session;
    const events = d.events || [];
    const spokeAt = new Map(events.filter((e) => e.type === 'spoke').map((e) => [`${e.turn}:${e.seq}`, e.t]));
    const items = [];
    for (const e of events) {
      if (e.type === 'said') items.push({ t: e.t, who: 'me', text: e.text });
      else if (e.type === 'say') items.push({ t: spokeAt.get(`${e.turn}:${e.seq}`) ?? e.t, who: 'ai', text: e.text });
      else if (e.type === 'hint') items.push({ t: e.t, who: 'ev', text: 'Pressed Hint' });
      else if (e.type === 'done') items.push({ t: e.t, who: 'ev', text: `Said done: ${e.ok ? 'all tests pass' : e.tooSlow ? 'too slow' : `${e.passed}/${e.total} tests pass`}` });
      else if (e.type === 'silence') items.push({ t: e.t, who: 'ev', text: `Quiet for ${Math.round(e.ms / 1000)} s` });
      else if (e.type === 'pause') items.push({ t: e.t, who: 'ev', text: 'Paused' });
    }
    items.sort((a, b) => a.t - b.t);
    const codes = [{ t: 0, code: (d.problem && d.problem.starter) || '' }, ...events.filter((e) => e.type === 'code').map((e) => ({ t: e.t, code: e.code }))];
    const boards = events.filter((e) => e.type === 'board' && e.file).map((e) => ({ t: e.t, file: e.file }));
    const marks = events.filter((e) => ['hint', 'done', 'silence'].includes(e.type));
    const $ = (q) => root.querySelector(q);
    const trEl = $('.iv-tr'), pg = $('.iv-scrub .pg'), scrub = $('.iv-scrub'), tm = $('.iv-player .tm'), playBtn = $('[data-a="play"]'), bdEl = $('.iv-rboard');
    trEl.innerHTML = items.map((x, i) => `<div class="${x.who}" data-i="${i}"><span class="iv-ts">${mmss(x.t)}</span> ${x.who === 'ev' ? esc(x.text) : `<b>${x.who === 'ai' ? 'Interviewer' : 'You'}</b>${esc(x.text)}`}</div>`).join('') || '<p class="iv-sub" style="padding:8px">Nothing was said.</p>';
    scrub.insertAdjacentHTML('beforeend', marks.map((m) => `<div class="mk ${m.type} ${m.type === 'done' ? (m.ok ? 'ok' : 'bad') : ''}" style="left:${(m.t / dur) * 100}%" title="${mmss(m.t)} ${m.type}"></div>`).join(''));
    const ed = Q.editor.mount($('.iv-rcode'), { doc: codes[0].code, readOnly: true });
    const audio = d.hasAudio ? new Audio(`api/interview/${s.id}/audio`) : null;
    const micStart = s.micStartT || 0;
    let T = 0, playing = false, last = 0, raf = 0, speed = 1, codeIdx = -1, boardIdx = -2, itemIdx = -1, nextAi = 0, aiAudio = null;
    const synth = window.speechSynthesis || null;
    const idxAt = (arr, t) => { let k = -1; for (let i = 0; i < arr.length; i++) if (arr[i].t <= t) k = i; else break; return k; };
    function paint() {
      pg.style.width = `${Math.min(100, (T / dur) * 100)}%`;
      tm.textContent = `${mmss(T)} / ${mmss(dur)}`;
      const ci = idxAt(codes, T);
      if (ci !== codeIdx) { codeIdx = ci; ed.set(codes[Math.max(0, ci)].code); }
      const bi = idxAt(boards, T);
      if (bi !== boardIdx) { boardIdx = bi; bdEl.innerHTML = bi >= 0 ? `<img alt="The board at ${mmss(boards[bi].t)}" src="api/interview/${s.id}/board/${boards[bi].file}">` : '<span>No board yet</span>'; }
      const ii = idxAt(items, T);
      if (ii !== itemIdx) {
        trEl.querySelectorAll('.cur').forEach((x) => x.classList.remove('cur'));
        itemIdx = ii;
        const cur = ii >= 0 && trEl.querySelector(`[data-i="${ii}"]`);
        if (cur) { cur.classList.add('cur'); if (playing) cur.scrollIntoView({ block: 'nearest' }); }
      }
    }
    function stopAi() { if (aiAudio) { aiAudio.pause(); aiAudio = null; } if (synth) synth.cancel(); }
    async function sayAi(text) {
      stopAi();
      try {
        const r = await Q.api('api/voice/tts', s.voice ? ttsBody(String(text).replace(/[[\]{}]/g, ' '), s.voice) : { text: String(text).replace(/[[\]{}]/g, ' '), purpose: 'live' });
        if (!playing) return;
        aiAudio = new Audio(r.url); aiAudio.playbackRate = speed; aiAudio.play().catch(() => {});
      } catch { if (synth && playing) { const u = new SpeechSynthesisUtterance(text); u.rate = speed; synth.speak(u); } }
    }
    function syncAudio(force) {
      if (!audio) return;
      const want = (T - micStart) / 1000;
      if (want < 0 || (audio.duration && want > audio.duration)) { audio.pause(); return; }
      if (force || Math.abs(audio.currentTime - want) > 0.35) { try { audio.currentTime = want; } catch {} }
      audio.playbackRate = speed;
      if (playing && audio.paused) audio.play().catch(() => {});
    }
    function frame(now) {
      if (!playing) return;
      T += (now - last) * speed; last = now;
      while (nextAi < items.length && items[nextAi].t <= T) { const it = items[nextAi++]; if (it.who === 'ai' && T - it.t < 1500) sayAi(it.text); }
      if (T >= dur) { T = dur; pause(); }
      paint();
      if (Math.round(now) % 1000 < 20) syncAudio(false);
      raf = requestAnimationFrame(frame);
    }
    function play() {
      if (T >= dur) seek(0);
      playing = true; last = performance.now();
      nextAi = items.findIndex((x) => x.t >= T); if (nextAi < 0) nextAi = items.length;
      playBtn.innerHTML = icon('pause');
      syncAudio(true);
      raf = requestAnimationFrame(frame);
    }
    function pause() { playing = false; cancelAnimationFrame(raf); playBtn.innerHTML = icon('play'); if (audio) audio.pause(); stopAi(); }
    function seek(t) {
      T = Math.max(0, Math.min(dur, t));
      stopAi();
      nextAi = items.findIndex((x) => x.t >= T); if (nextAi < 0) nextAi = items.length;
      syncAudio(true);
      paint();
    }
    playBtn.onclick = (e) => { e.stopPropagation(); playing ? pause() : play(); };
    const scrubTo = (e) => { const r = scrub.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur); };
    scrub.addEventListener('pointerdown', (e) => { scrubTo(e); const mv = (ev) => scrubTo(ev); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
    trEl.addEventListener('click', (e) => { const row = e.target.closest('[data-i]'); if (row) { seek(items[Number(row.dataset.i)].t); if (!playing) play(); } });
    $('[data-a="speed"]').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); speed = Number(b.dataset.v); b.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); if (audio) audio.playbackRate = speed; if (aiAudio) aiAudio.playbackRate = speed; });
    paint();
    return {
      el: root.querySelector('.iv-player'), seek, play, get playing() { return playing; },
      dispose() { pause(); ed.dispose(); if (audio) { audio.src = ''; } },
    };
  }

  if (Q.tab === 'interview') route();
})();
