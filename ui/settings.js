// Settings popup (gear in the sidebar header). Sections on the left: Look, Teacher, Voice, Boards, Mic, Quiz,
// Shortcuts, Data. Everything except the voice engine/key is a preference in prefs.js (Quiz.prefs, ui/prefs.js);
// each control saves at once and the app reacts live. Data uses data.js (backup, restore, audio cache) and
// the Teach lesson list/delete routes. The Voice section keeps the voice engine popup below:
//   - Voice engine: Local (free, Kokoro on this machine: local.where / local.label from the server) · ElevenLabs Flash · ElevenLabs v3. Local shows its
//     status (ready / starting / not installed + the install command) and its voices with previews made locally.
//   - API key: hidden, with a show/hide button; checked with ElevenLabs before it's saved.
//   - Usage: plan characters and this app's estimated spend, with the monthly cap.
//   - Voice: George (default), Pastor Paul, the current voice, and a search of the ElevenLabs voice library
//     with a preview for each; free plans can't use library voices through the API (the server says so).
// Server: voice.js (/api/voice/settings, /engine, /local-voice, /preview, /key, /key/reveal, /cap, /library, /config).
(() => {
  const Q = window.Quiz;
  const esc = Q.esc;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

  const css = `
  .set-panel { width: min(820px, 100%); height: min(720px, calc(100vh - 48px)); display: flex; flex-direction: column; text-align: left;
    background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
    border-radius: var(--r-xl); box-shadow: var(--shadow-3); animation: pop-in .2s var(--spring); overflow: hidden; }
  .set-head { display: flex; align-items: center; padding: 16px 12px 8px 22px; }
  .set-head h2 { flex: 1; margin: 0; font: var(--title3); }
  .set-main { flex: 1; min-height: 0; display: grid; grid-template-columns: 180px minmax(0, 1fr); }
  .set-nav { display: flex; flex-direction: column; gap: 1px; padding: 4px 8px 16px 12px; overflow: auto; }
  .set-nav button { display: flex; align-items: center; justify-content: flex-start; gap: 10px; height: 34px; padding: 0 10px; border: 0; border-radius: var(--r-sm);
    background: none; color: var(--label); font: 400 15px/20px var(--font); text-align: left; cursor: pointer; }
  .set-nav button:hover { background: var(--fill); }
  .set-nav button svg { width: 18px; height: 18px; color: var(--accent); flex: none; }
  .set-nav button[aria-current="page"] { background: var(--accent-tint); font-weight: 600; }
  .set-body { overflow: auto; padding: 0 18px 20px 6px; }
  .set-sec:first-child { margin-top: 4px; }
  .set-foot { margin: 6px 6px 0; }
  .set-reset { margin: 14px 0 0 2px; }
  .set-tog label { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
  .set-tog .set-hint { margin-top: 4px; }
  .set-switch { appearance: none; -webkit-appearance: none; flex: none; width: 42px; height: 26px; border-radius: 13px; margin: 0;
    background: var(--fill-hover); position: relative; cursor: pointer; transition: background var(--dur) var(--ease); }
  .set-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / .25); transition: transform var(--dur) var(--spring); }
  .set-switch:checked { background: var(--green); }
  .set-switch:checked::after { transform: translateX(16px); }
  .set-swatches { display: flex; flex-wrap: wrap; gap: 10px; }
  .set-swatches button { width: 26px; height: 26px; border-radius: 50%; border: 0; background: var(--sw); cursor: pointer; padding: 0;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / .1); }
  .set-swatches button[aria-checked="true"] { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--sw); }
  .set-range { display: flex; align-items: center; gap: 10px; font: var(--footnote); color: var(--label-2); }
  .set-range input { flex: 1; min-width: 0; }
  .set-kb { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font: var(--subhead); }
  .set-kb .set-hint { flex-basis: 100%; margin: 0; }
  .set-keycap { min-width: 44px; height: 28px; padding: 0 10px; border-radius: var(--r-xs); border: 1px solid var(--separator-strong);
    background: var(--surface-2); color: var(--label); font: 500 13px/26px var(--font); text-align: center; box-shadow: 0 1px 0 var(--separator-strong); }
  button.set-keycap { cursor: pointer; }
  button.set-keycap.wait { border-color: var(--accent); color: var(--accent); }
  .set-btns { display: flex; flex-wrap: wrap; gap: 8px; }
  .set-btns label.btn { cursor: pointer; }
  .set-lesson { display: flex; align-items: center; gap: 10px; }
  .set-lesson > span { flex: 1; }
  .set-lesson .nm { font: 500 15px/20px var(--font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .set-lesson .nt { font: var(--footnote); color: var(--label-2); }
  .set-lesson .icon-btn { color: var(--red); }
  .set-sec { margin-top: 14px; }
  .set-sec > h3 { margin: 0 0 6px 6px; font: 600 13px/18px var(--font); color: var(--label-2); }   /* sentence case, like .list-header */
  .set-card { background: var(--surface); border: 1px solid var(--separator); border-radius: var(--r-lg); box-shadow: var(--shadow-1); }
  .set-row { padding: 12px 14px; }
  .set-row + .set-row { border-top: 1px solid var(--separator); }
  .set-label { font: 600 15px/20px var(--font); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .set-label small { font: var(--footnote); color: var(--label-3); font-weight: 400; }
  .set-key { display: flex; gap: 6px; }
  .set-key .field { flex: 1; min-width: 0; font: 400 14px/20px var(--font-mono); padding: 7px 10px; }
  .set-key .icon-btn { flex: none; }
  .set-hint { margin: 8px 0 0; font: var(--footnote); color: var(--label-2); }
  .set-hint.err { color: var(--red); }
  .set-hint.ok { color: var(--green); }
  .set-hint a { color: var(--accent); }
  .set-meter { height: 6px; border-radius: 3px; background: var(--fill); overflow: hidden; margin-top: 8px; }
  .set-meter > span { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .set-cap { display: flex; align-items: center; gap: 8px; margin-top: 10px; font: var(--subhead); color: var(--label-2); }
  .set-cap .field { width: 84px; padding: 5px 8px; font: var(--subhead); }
  .set-voice { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; }
  .set-voice + .set-voice { border-top: 1px solid var(--separator); }
  .set-voice:hover { background: var(--fill); }
  .set-voice .radio { width: 20px; height: 20px; border-radius: 50%; border: 1.6px solid var(--separator-strong); display: grid; place-items: center; }
  .set-voice.on .radio { border-color: var(--accent); }
  .set-voice.on .radio::after { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .set-voice .nm { font: 500 15px/20px var(--font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .set-voice .nt { font: var(--footnote); color: var(--label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .set-voice .nt .paid { color: var(--orange); }
  .set-voice .acts { display: flex; align-items: center; gap: 4px; }
  .set-voice .err { grid-column: 2 / 4; font: var(--footnote); color: var(--red); }
  .set-play { width: 32px; height: 32px; border-radius: 50%; border: 0; background: var(--fill); color: var(--label); display: grid; place-items: center; cursor: pointer; }
  .set-play svg { width: 15px; height: 15px; }
  .set-play.playing { background: var(--accent); color: var(--on-accent); }
  .set-play:disabled { opacity: .4; cursor: default; }
  .set-search { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--separator); }
  .set-search svg { width: 17px; height: 17px; color: var(--label-3); flex: none; }
  .set-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: var(--body); color: var(--label); }
  .set-results:empty { display: none; }
  .set-results { border-top: 1px solid var(--separator); max-height: 340px; overflow: auto; }
  .set-more { display: block; width: 100%; padding: 10px; border: 0; border-top: 1px solid var(--separator); background: none; color: var(--accent); font: var(--subhead); cursor: pointer; }
  .set-empty { padding: 14px; font: var(--subhead); color: var(--label-2); }
  .set-seg { display: flex; width: 100%; }
  .set-seg button { flex: 1 1 0; min-width: 0; padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .set-state { display: flex; align-items: center; gap: 8px; font: var(--subhead); color: var(--label-2); }
  .set-state .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--label-3); flex: none; }
  .set-state .dot.ready { background: var(--green); }
  .set-state .dot.starting { background: var(--orange); animation: set-blink 1s infinite; }
  .set-state .dot.missing, .set-state .dot.error { background: var(--red); }
  @keyframes set-blink { 50% { opacity: .35; } }
  .set-cmd { display: block; margin-top: 8px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--fill); font: 400 13px/18px var(--font-mono); user-select: all; overflow-wrap: anywhere; }
  .set-seg button { font-size: 13px; }
  @media (max-width: 700px) {
    /* phone: a full-screen sheet that clears the notch and the home bar */
    .scrim:has(> .set-panel) { padding: 0; }
    .set-panel { width: 100%; height: 100vh; height: 100dvh; border-radius: 0; background: var(--window);
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .set-head { padding: 10px 8px 8px 16px; }
    .set-head .icon-btn { width: 44px; height: 44px; }
    .set-play { width: 40px; height: 40px; }
    .set-nav button { height: 36px; font-size: 15px; }
    .set-seg button { font-size: 14px; min-height: 36px; }
    .set-main { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .set-nav { flex-direction: row; overflow-x: auto; padding: 0 12px 8px; gap: 4px; scrollbar-width: none; }
    .set-nav button { flex: none; padding: 0 12px; height: 32px; border-radius: var(--r-pill); background: var(--fill); }
    .set-nav button svg { display: none; }
    .set-body { padding: 0 12px 16px; }
    .set-seg .lg { display: none; }
  }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const H = { 'Content-Type': 'application/json', 'x-quiz-settings': '1' };
  async function call(path, body) {
    const r = await fetch(path, body === undefined ? { headers: H } : { method: 'POST', headers: H, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { code: j && j.code });
    return j;
  }
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  // ---------- preview audio (one at a time) ----------
  let player = null, playingBtn = null;
  function stopPreview() {
    if (player) { player.pause(); player = null; }
    if (playingBtn) { playingBtn.classList.remove('playing'); playingBtn.innerHTML = icon('play'); playingBtn = null; }
  }
  function preview(btn, url) {
    if (playingBtn === btn) { stopPreview(); return; }
    stopPreview();
    if (!url) return;
    if (Q.board && Q.board.stopAll) Q.board.stopAll();
    player = new Audio(url);
    playingBtn = btn;
    btn.classList.add('playing'); btn.innerHTML = icon('stop');
    player.onended = player.onerror = () => { if (playingBtn === btn) stopPreview(); };
    player.play().catch(() => stopPreview());
  }

  // ---------- the popup: sections on the left, one pane on the right ----------
  const SECTIONS = [
    ['look', 'Look', 'sparkles'], ['ai', 'AI', 'chat'], ['teacher', 'Teacher', 'teach'], ['voice', 'Voice', 'speaker'], ['boards', 'Boards', 'board'],
    ['mic', 'Mic', 'mic'], ['quiz', 'Quiz', 'review'], ['keys', 'Shortcuts', 'list'], ['data', 'Data', 'folder'],
  ];
  let open = null;
  async function show(section) {
    if (open) { if (section) open.go(section); return; }
    let cur = section || (() => { try { return localStorage.getItem('settingsSection'); } catch { return null; } })() || 'look';
    if (!SECTIONS.some((s) => s[0] === cur)) cur = 'look';
    const wrap = el(`<div class="scrim"><div class="set-panel" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="set-head"><h2>Settings</h2><button class="icon-btn" type="button" data-a="close" aria-label="Close">${icon('close')}</button></div>
      <div class="set-main">
        <nav class="set-nav" aria-label="Settings sections">${SECTIONS.map(([k, n, ic]) => `<button type="button" data-sec="${k}">${icon(ic)}<span>${n}</span></button>`).join('')}</nav>
        <div class="set-body"></div>
      </div></div></div>`);
    const close = () => { stopPreview(); stopCapture(); wrap.remove(); window.removeEventListener('keydown', onKey, true); open = null; };
    const onKey = (e) => {
      // An alert opened from here (Quiz.confirm) sits on top and handles its own keys.
      const scrims = document.querySelectorAll('.scrim');
      if (scrims[scrims.length - 1] !== wrap || capturing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-a=close]').onclick = close;
    document.body.appendChild(wrap);
    const body = wrap.querySelector('.set-body');
    const go = async (k) => {
      stopPreview(); stopCapture();
      cur = k;
      try { localStorage.setItem('settingsSection', k); } catch {}
      wrap.querySelectorAll('[data-sec]').forEach((b) => b.setAttribute('aria-current', b.dataset.sec === k ? 'page' : 'false'));
      body.innerHTML = '<div style="padding:24px;color:var(--label-2)">Loading…</div>';
      body.scrollTop = 0;
      try { await PANES[k](body); } catch (e) { if (cur === k) body.innerHTML = `<p class="set-hint err">${esc(e.message)}</p>`; }
    };
    wrap.querySelectorAll('[data-sec]').forEach((b) => (b.onclick = () => go(b.dataset.sec)));
    open = { wrap, close, go };
    await (PR() && PR().ready);
    go(cur);
  }

  // ---------- preference controls ----------
  const PR = () => Q.prefs || window.QuizPrefs;
  const pget = (k) => PR().get(k);
  async function pset(k, v, row) {
    try { await PR().set({ [k]: v }); return true; }
    catch (e) { const h = row && row.querySelector('.set-hint'); if (h) { h.className = 'set-hint err'; h.textContent = e.message; } return false; }
  }
  // Segmented choice. opts: [[value, label, description?]]; the description of the chosen one shows below.
  function seg(key, label, opts, hint = '', onSet) {
    const val = pget(key);
    const desc = (v) => { const o = opts.find((x) => x[0] === v); return (o && o[2]) || hint; };
    const row = el(`<div class="set-row"><div class="set-label">${esc(label)}</div>
      <div class="segmented set-seg" role="group" aria-label="${esc(label)}">${opts.map(([v, l], i) => `<button type="button" data-i="${i}" aria-pressed="${v === val}">${esc(l)}</button>`).join('')}</div>
      <p class="set-hint">${esc(desc(val))}</p></div>`);
    row.querySelectorAll('[data-i]').forEach((b) => (b.onclick = async () => {
      const v = opts[Number(b.dataset.i)][0];
      if (!(await pset(key, v, row))) return;
      row.querySelectorAll('[data-i]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      const h = row.querySelector('.set-hint'); h.className = 'set-hint'; h.textContent = desc(v);
      if (onSet) onSet(v);
    }));
    if (!desc(val)) row.querySelector('.set-hint').remove();
    return row;
  }
  function toggle(key, label, hint = '') {
    const row = el(`<div class="set-row set-tog"><label><span class="set-label" style="margin:0">${esc(label)}</span>
      <input type="checkbox" class="set-switch" ${pget(key) ? 'checked' : ''}></label>${hint ? `<p class="set-hint">${esc(hint)}</p>` : ''}</div>`);
    const box = row.querySelector('input');
    box.onchange = async () => { if (!(await pset(key, box.checked, row))) box.checked = !box.checked; };
    return row;
  }
  function card(title, rows, foot = '') {
    const sec = el(`<section class="set-sec">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="set-card"></div>${foot ? `<p class="set-hint set-foot">${foot}</p>` : ''}</section>`);
    rows.filter(Boolean).forEach((r) => sec.querySelector('.set-card').appendChild(r));
    return sec;
  }
  const resetLink = (keys, again) => {
    const b = el('<button type="button" class="btn btn-plain btn-sm set-reset">Reset this section</button>');
    b.onclick = async () => { await PR().reset(keys); again(); };
    return b;
  };
  const keysOf = (prefix) => Object.keys(PR().defaults()).filter((k) => k.startsWith(prefix));

  // ---------- panes ----------
  const ACCENTS = ['blue', 'purple', 'pink', 'red', 'orange', 'green', 'teal', 'graphite'];
  const PANES = {
    look(body) {
      body.innerHTML = '';
      const sw = el(`<div class="set-row"><div class="set-label">Accent colour</div><div class="set-swatches" role="radiogroup" aria-label="Accent colour">
        ${ACCENTS.map((a) => `<button type="button" role="radio" aria-checked="${pget('look.accent') === a}" aria-label="${a}" title="${cap(a)}" data-acc="${a}" style="--sw:${a === 'graphite' ? '#8e8e93' : `var(--${a})`}"></button>`).join('')}</div></div>`);
      sw.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = async () => {
        if (await pset('look.accent', b.dataset.acc, sw)) sw.querySelectorAll('[data-acc]').forEach((x) => x.setAttribute('aria-checked', x === b));
      }));
      body.append(
        card('Appearance', [
          seg('look.theme', 'Theme', [['system', 'System', 'Follows your device’s light or dark mode.'], ['light', 'Light'], ['dark', 'Dark']]),
          sw,
          seg('look.textSize', 'Text size', [['small', 'Small'], ['default', 'Default'], ['large', 'Large'], ['xlarge', 'Larger']], 'Scales the whole window.'),
          seg('look.density', 'Density', [['comfortable', 'Comfortable'], ['compact', 'Compact', 'Tighter spacing: more fits on screen.']]),
        ]),
        card('Behaviour', [
          seg('look.motion', 'Animations', [['system', 'System', 'Follows “Reduce motion” in your system settings.'], ['full', 'Full'], ['reduced', 'Reduced', 'Almost no animation.']]),
          seg('look.sidebar', 'Sidebar when the app opens', [['remember', 'As I left it'], ['open', 'Open'], ['closed', 'Hidden']]),
        ]),
        resetLink(keysOf('look.'), () => PANES.look(body)));
    },

    async teacher(body) {
      let ai = null;
      try { ai = await call('api/llm'); } catch {}
      body.innerHTML = '';
      const gem = (area) => !!(ai && String(ai.areas[area].engine).startsWith('gemini'));
      const M = (who, area) => {
        const n = gem(area) ? ['Pro', 'Flash', 'Flash-Lite'] : ['Opus', 'Sonnet', 'Haiku'];
        return [['opus', n[0], `Best ${who}: deepest reasoning, slowest.`], ['sonnet', n[1], 'Fast and strong: a good balance.'], ['haiku', n[2], 'Fastest, lightest. Fine for simple topics.']];
      };
      const eng = (area) => (gem(area) ? 'Gemini' : 'Claude');
      body.append(
        card('Models', [
          seg('teacher.model', `Teacher (${eng('teach')})`, M('teacher', 'teach')),
          seg('teacher.graderModel', `Grader: Review, Test, Practice (${eng('grader')})`, M('grader', 'grader')),
        ], 'The engine is chosen in Settings → AI; on Gemini the same choice means Pro, Flash or Flash-Lite. A lesson switches models at its next reply.'),
        card('How it teaches', [
          seg('teacher.mode', 'Approach', [['fast', 'Fast (AI era)', 'Understand the subject, know what to ask an AI, read and judge its output. Short lessons, syntax only to recognise.'], ['classic', 'Classic', 'The original teacher: thorough and hands-on, every step practised and checked.']]),
          seg('teacher.style', 'Style', [['mixed', 'Mixed', 'Explains or asks, whichever fits the moment.'], ['socratic', 'Socratic', 'Asks you guiding questions and lets you try first.'], ['direct', 'Direct', 'Explains clearly first, then checks you understood.']]),
          seg('teacher.length', 'Reply length', [['short', 'Short', 'A few sentences per reply.'], ['normal', 'Normal'], ['deep', 'Deep', 'Longer replies with more detail and examples.']]),
          seg('teacher.cards', 'Quiz cards in lessons', [['few', 'Few', 'Fewer checks: more flow.'], ['normal', 'Normal'], ['many', 'Many', 'Checks you often.']]),
          seg('teacher.boards', 'Whiteboard answers', [['off', 'When I ask', 'Only with the board button or “Explain on the board”.'], ['auto', 'Teacher decides', 'The teacher draws when a picture clearly helps.'], ['always', 'Always', 'Every question is answered on the board (turn it off per message).']]),
        ]),
        resetLink(['teacher.model', 'teacher.graderModel', 'teacher.mode', 'teacher.style', 'teacher.length', 'teacher.cards', 'teacher.boards'], () => PANES.teacher(body)));
    },

    async ai(body) {
      const st = await call('api/llm');
      if (!open || !body.isConnected) return;
      body.innerHTML = '';
      const E = st.engines;
      const again = () => PANES.ai(body);
      const NAMES = { claude: 'Claude', 'gemini-cli': 'Gemini', 'gemini-api': 'Gemini API' };
      const notReady = (e) => (E[e].ok ? '' : ` Not ready yet: ${E[e].why}.`);
      const engOpts = [
        ['claude', 'Claude', `Claude Code on your Claude subscription.${notReady('claude')}`],
        ['gemini-cli', 'Gemini', `Gemini CLI, signed in with your Google account (Google AI Pro / Ultra, or the free tier).${notReady('gemini-cli')}`],
        ['gemini-api', 'Gemini API', `Gemini with an AI Studio key: pay per use, with a monthly cap.${notReady('gemini-api')}`],
      ];
      const areaOpts = (area) => [['default', 'Same', `Uses the app’s engine (${NAMES[st.engine]}).`], ...engOpts.map(([v, l, d]) => [v, l === 'Gemini API' ? 'API' : l, d])];
      const state = (ok, text) => `<div class="set-state"><span class="dot ${ok ? 'ready' : 'missing'}"></span><span>${esc(text)}</span></div>`;
      const testBtn = (engine) => {
        const row = el(`<div class="set-btns" style="margin-top:10px"><button type="button" class="btn btn-sm">Test</button></div>`);
        const b = row.querySelector('button');
        b.onclick = async () => {
          const h = b.closest('.set-row').querySelector('[data-k=test]');
          b.disabled = true; h.hidden = false; h.className = 'set-hint'; h.textContent = 'Asking… (a fresh Gemini CLI takes a few seconds to start)';
          try {
            const r = await call('api/llm/test', { engine });
            h.className = `set-hint ${r.ok ? 'ok' : 'err'}`;
            h.textContent = r.ok ? `Works: ${r.model} answered in ${(r.ms / 1000).toFixed(1)} s.` : `Didn’t work: ${r.error || `unexpected reply “${r.reply}”`}`;
          } catch (e) { h.className = 'set-hint err'; h.textContent = e.message; }
          b.disabled = false;
        };
        return row;
      };
      // Claude
      const claude = el(`<div class="set-row"><div class="set-label">Claude</div>${state(E.claude.ok, E.claude.ok ? 'Claude Code CLI found' : E.claude.why)}<p class="set-hint" data-k="test" hidden></p></div>`);
      if (E.claude.ok) claude.append(testBtn('claude'));
      // Gemini CLI
      const g = E['gemini-cli'];
      const gtxt = !g.installed ? 'Not installed on the server' : !g.signedIn ? `Installed${g.version ? ` (v${g.version})` : ''}, not signed in` : `Signed in${g.version ? ` · v${g.version}` : ''}`;
      const cli = el(`<div class="set-row"><div class="set-label">Gemini CLI <small>Google account</small></div>${state(g.ok, gtxt)}
        ${!g.installed ? `<p class="set-hint">Install it once, in a terminal on the server (no sudo, ≈ 100 MB):</p><code class="set-cmd">~/learning-quiz/tools/gemini/install.sh</code>` : ''}
        ${g.installed && !g.signedIn ? `<p class="set-hint">Sign in once, in a terminal on the server. Choose <b>Sign in with Google</b>, open the link it prints, paste the code back, then type <b>/quit</b>. Use the Google account that has your Gemini plan.</p><code class="set-cmd">~/learning-quiz/tools/gemini/install.sh --login</code>` : ''}
        <p class="set-hint" data-k="test" hidden></p></div>`);
      if (g.ok) cli.append(testBtn('gemini-cli'));
      if (!g.ok) { const r = el('<div class="set-btns" style="margin-top:10px"><button type="button" class="btn btn-sm">Check again</button></div>'); r.querySelector('button').onclick = again; cli.append(r); }
      // Gemini API
      const a = E['gemini-api'];
      const pct = a.capUsd > 0 ? Math.min(100, Math.round((a.usage.usd / a.capUsd) * 100)) : 100;
      const api = el(`<div class="set-row"><div class="set-label">Gemini API <small>${a.hasKey ? esc(a.keyHint) : 'AI Studio key'}</small></div>
        ${a.hasKey ? state(a.ok, a.ok ? 'Key saved' : a.why) : ''}
        ${a.fromEnv ? '<p class="set-hint">The key comes from QUIZ_GEMINI_API_KEY on the server.</p>' : `<form class="set-key" autocomplete="off" style="margin-top:8px">
          <input class="field" type="password" name="key" placeholder="${a.hasKey ? 'Paste a new key to replace it' : 'AIza…  (aistudio.google.com → Get API key)'}" aria-label="Gemini API key" spellcheck="false" autocomplete="off">
          <button class="btn btn-primary" type="submit" disabled>Save</button>
          ${a.hasKey ? '<button class="btn" type="button" data-a="rm">Remove</button>' : ''}
        </form>`}
        <p class="set-hint" data-k="keymsg">${a.hasKey ? `Checked with Google and saved on the server only (data/ai.json, not in git). Models: Pro = ${esc(a.models.pro)}, Flash = ${esc(a.models.flash)}.` : 'Only needed for the Gemini API engine. The free tier works, but Google may use free-tier prompts to improve its models.'}</p>
        ${a.hasKey ? `<div class="set-label" style="margin:12px 0 0">This month <small>${money(a.usage.usd)} of ${money(a.capUsd)} · ${num(a.usage.calls)} calls · estimate</small></div>
          <div class="set-meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <label class="set-cap">Monthly cap $<input class="field" type="number" min="0" max="1000" step="1" value="${a.capUsd}" aria-label="Monthly cap in dollars"> <span>Gemini API calls stop at the cap.</span></label>` : ''}
        <p class="set-hint" data-k="test" hidden></p></div>`);
      const form = api.querySelector('form');
      if (form) {
        const input = form.querySelector('input'), save = form.querySelector('[type=submit]'), msg = api.querySelector('[data-k=keymsg]');
        input.oninput = () => (save.disabled = !input.value.trim());
        form.onsubmit = async (e) => {
          e.preventDefault();
          save.disabled = true; msg.className = 'set-hint'; msg.textContent = 'Checking the key with Google…';
          try { await call('api/llm/key', { apiKey: input.value.trim() }); again(); }
          catch (err) { msg.className = 'set-hint err'; msg.textContent = err.message; save.disabled = false; }
        };
        const rm = form.querySelector('[data-a=rm]');
        if (rm) rm.onclick = async () => {
          if (!(await Q.confirm({ title: 'Remove the Gemini API key?', text: 'Areas set to Gemini API stop working until you add a key again.', ok: 'Remove', destructive: true }))) return;
          try { await call('api/llm/key', { apiKey: '' }); again(); } catch (err) { Q.showToast(err.message); }
        };
      }
      const capIn = api.querySelector('.set-cap input');
      if (capIn) capIn.onchange = async () => { try { await call('api/llm/cap', { usd: Number(capIn.value) }); again(); } catch (err) { Q.showToast(err.message); } };
      if (a.ok) api.append(testBtn('gemini-api'));
      body.append(
        card('Engine', [seg('ai.engine', 'Whole app', engOpts, '', again)],
          'Lessons and interviews switch at their next reply (the lesson so far carries over). A quiz run keeps its engine until it ends.'),
        card('Per area', [
          seg('ai.teach', 'Teach', areaOpts('teach'), '', again),
          seg('ai.interview', 'Interview', areaOpts('interview'), '', again),
          seg('ai.grader', 'Grading and background jobs', areaOpts('grader'), '', again),
        ], 'Grading covers Review, Test and Practice, hints, multiple choice, gaps, To Learn lists and the topic map. Models (Opus / Sonnet / Haiku, on Gemini Pro / Flash / Flash-Lite) are in Settings → Teacher.'),
        card('Engines', [claude, cli, api]),
        resetLink(['ai.engine', 'ai.teach', 'ai.interview', 'ai.grader'], again));
    },

    async voice(body) {
      body.innerHTML = '';
      const speed = el(`<div class="set-row"><div class="set-label">Speed <small data-k="sp"></small></div>
        <div class="set-range"><span>Slower</span><input type="range" min="0.7" max="1.6" step="0.05" aria-label="Speech speed"><span>Faster</span>
        <button type="button" class="set-play" title="Try this speed" aria-label="Try this speed">${icon('play')}</button></div>
        <p class="set-hint">Changes playback speed, so saved audio is reused (no extra cost).</p></div>`);
      const r = speed.querySelector('input');
      const show = () => (speed.querySelector('[data-k=sp]').textContent = `${Number(r.value).toFixed(2).replace(/0$/, '')}×`);
      r.value = String(pget('voice.speed')); show();
      r.oninput = () => { show(); if (player) player.playbackRate = Number(r.value); };
      r.onchange = () => pset('voice.speed', Number(r.value), speed);
      const tryBtn = speed.querySelector('.set-play');
      tryBtn.onclick = async () => {
        if (playingBtn === tryBtn) return stopPreview();
        try {
          const st = await call('api/voice/settings');
          const d = await call('api/voice/preview', { voice: (st.local && st.local.voice) || 'bm_george' });
          preview(tryBtn, d.url);
          if (player) { player.preservesPitch = true; player.playbackRate = Number(r.value); }
        } catch (e) { const h = speed.querySelector('.set-hint'); h.className = 'set-hint err'; h.textContent = e.message; }
      };
      const autoRead = toggle('voice.autoRead', 'Read teacher replies aloud', 'Each new reply in a lesson is spoken with the free local voice.');
      body.append(card('Playback', [
        speed,
        autoRead,
        toggle('voice.captions', 'Captions on boards'),
        seg('voice.capAlertPct', 'Warn me about ElevenLabs spend', [[0, 'Never'], [50, 'At 50%'], [80, 'At 80%'], [90, 'At 90%']], 'Of your monthly cap, below.'),
      ]));
      const vbox = document.createElement('div');
      body.appendChild(vbox);
      const vs = await call('api/voice/settings');
      // Where the free voice runs ('on this Mac' / 'on this server'), from the server.
      if (vs && vs.local && vs.local.where) autoRead.querySelector('.set-hint').textContent = `Each new reply in a lesson is spoken with the free voice ${vs.local.where}.`;
      render(vbox, vs);
    },

    boards(body) {
      body.innerHTML = '';
      body.append(
        card('Whiteboard', [
          seg('boards.renderer', 'Drawing', [['auto', 'Auto', 'Hand-drawn canvas on wide windows, simple drawing on phones.'], ['canvas', 'Canvas', 'Excalidraw: you can draw on it too.'], ['svg', 'Simple', 'Light and fast; view only.']]),
          seg('boards.font', 'Canvas look', [['hand', 'Hand-drawn'], ['clean', 'Clean', 'Straight lines and a plain font.']]),
          toggle('boards.autoplay', 'Start talking and drawing at once', 'Off: the board waits for you to press Play.'),
          seg('boards.pace', 'Drawing pace', [['voice', 'With the voice', 'Each shape appears as it’s mentioned.'], ['fast', 'Fast', 'Shapes appear as soon as they’re ready.'], ['instant', 'Instant', 'Each step’s drawing appears at once, no animation.']]),
        ]),
        resetLink(keysOf('boards.'), () => PANES.boards(body)));
    },

    async mic(body) {
      body.innerHTML = '';
      let st = null;
      try { st = await (await fetch('api/dictate/status')).json(); } catch {}
      const models = (st && st.models) || (st && st.model ? [st.model] : []);
      const using = st && (st.using || st.model);
      // The file the chosen model + language would need, when it isn't installed yet.
      const size = pget('mic.model'), lang = pget('mic.language');
      const want = size === 'auto' ? (lang === 'en' ? null : 'ggml-large-v3-turbo.bin') : size === 'large' ? 'ggml-large-v3-turbo.bin' : `ggml-${size}${lang === 'en' ? '.en' : ''}.bin`;
      const need = st && want && !models.includes(want) && !(size === 'large' && models.some((m) => /^ggml-large/.test(m))) ? want : null;
      // Which machine runs Whisper ('this Mac' / 'the server', from the server), plus its hints for a missing binary.
      const inst = (st && st.install) || {};
      const machine = inst.machine || 'this computer';
      const binHints = [inst.whisper, inst.ffmpeg].filter(Boolean).map((h) => `<p class="set-hint">${esc(h)}</p>`).join('');
      const status = el(`<div class="set-row"><div class="set-state"><span class="dot ${st && st.available ? 'ready' : 'missing'}"></span>
        <span>${st && st.available ? `Whisper on ${esc(machine)} · using ${esc(using || '?')}` : `Dictation isn’t set up on ${esc(machine)}.`}</span></div>
        ${binHints}
        ${models.length ? `<p class="set-hint">Installed models: ${models.map(esc).join(', ')}.${st.fallback ? ` <b>${esc(st.fallback)}</b>` : ''}</p>` : ''}
        ${need ? `<p class="set-hint">To add ${esc(need)} (${esc((st.install && st.install.sizes) || '')}), run in Terminal:</p><code class="set-cmd">${esc(`curl -L --create-dirs -o ${(st.install && st.install.dir) || '~/.cache/quiz-whisper'}/${need} ${((st.install && st.install.url) || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>').replace('<file>', need)}`)}</code>` : ''}</div>`);
      body.append(
        card('Dictation', [
          status,
          seg('mic.model', 'Model', [['auto', 'Auto', 'The best installed model.'], ['base', 'Base', 'Fastest, least accurate.'], ['small', 'Small', 'Good balance.'], ['medium', 'Medium', 'More accurate, slower.'], ['large', 'Large', 'Most accurate, slowest (~3 GB).']], '', () => PANES.mic(body)),
          seg('mic.language', 'Language you speak', [['en', 'English'], ['he', 'Hebrew', 'Needs a multilingual model (no “.en” in the name).'], ['auto', 'Detect', 'Needs a multilingual model; a little slower.']], '', () => PANES.mic(body)),
        ]),
        card('Hands-free', [
          seg('mic.pushToTalk', 'Push to talk', [['none', 'Off', '⌥M still turns the mic on and off.'], ['alt', 'Hold ⌥', 'Hold Option to talk, let go to stop.'], ['backquote', 'Hold `', 'Hold the ` key (left of 1) to talk, when you’re not typing.']]),
          seg('mic.autoSendSec', 'Stop after silence', [[0, 'Off', 'The mic records until you stop it.'], [2, '2 s'], [3, '3 s'], [5, '5 s']], 'In lessons, the message is sent when you stop talking.'),
        ]),
        resetLink(keysOf('mic.'), () => PANES.mic(body)));
    },

    quiz(body) {
      body.innerHTML = '';
      body.append(
        card('Review', [
          seg('quiz.reviewSize', 'Questions per session', [[0, 'No limit'], [10, '10'], [20, '20'], [30, '30'], [50, '50']], 'Review stops after this many; you can keep going.'),
          seg('quiz.maxNew', 'New questions per session', [[-1, 'No limit'], [0, 'None'], [3, '3'], [5, '5'], [10, '10']], 'Questions you’ve never seen, mixed in with reviews.'),
        ]),
        card('Grading and help', [
          seg('quiz.strictness', 'Claude’s grading', [['lenient', 'Lenient', 'The idea counts, even if details are missing.'], ['normal', 'Normal'], ['strict', 'Strict', 'Expects precise, complete answers.']]),
          toggle('quiz.hints', 'Hints in Practice'),
          toggle('quiz.timer', 'Show the timer in Tests', 'The time is still recorded.'),
        ]),
        card('Goal', [
          seg('quiz.dailyGoal', 'Daily goal', [[0, 'Off'], [10, '10'], [20, '20'], [30, '30'], [50, '50']], 'Questions a day. Shown with your streak in the sidebar.'),
        ]),
        resetLink(keysOf('quiz.'), () => PANES.quiz(body)));
    },

    keys(body) {
      body.innerHTML = '';
      const names = { again: 'Again (didn’t know)', hard: 'Hard (partly)', good: 'Good (got it)', easy: 'Easy (instantly)' };
      const rows = Object.entries(names).map(([k, label]) => {
        const row = el(`<div class="set-row set-kb"><span>${esc(label)}</span><button type="button" class="set-keycap" title="Click, then press a key">${esc(keyName(pget(`keys.${k}`)))}</button><p class="set-hint" hidden></p></div>`);
        const b = row.querySelector('button');
        b.onclick = () => captureKey(b, async (key) => {
          const h = row.querySelector('.set-hint');
          const clash = Object.keys(names).find((o) => o !== k && pget(`keys.${o}`).toLowerCase() === key.toLowerCase());
          if (clash) { h.hidden = false; h.className = 'set-hint err'; h.textContent = `${keyName(key)} is already “${names[clash].split(' (')[0]}”.`; b.textContent = keyName(pget(`keys.${k}`)); return; }
          if (key === '`' && pget('mic.pushToTalk') === 'backquote') { h.hidden = false; h.className = 'set-hint err'; h.textContent = '` is your push-to-talk key (Settings → Mic).'; b.textContent = keyName(pget(`keys.${k}`)); return; }
          h.hidden = true;
          if (await pset(`keys.${k}`, key, row)) b.textContent = keyName(key);
        });
        return row;
      });
      const fixed = [
        ['⌘ ↩', 'Show the answer · send in a lesson'], ['↩', 'Next question with the suggested rating'], ['A–D', 'Pick a multiple-choice option'],
        ['1–5', 'Pick a choice in a lesson card'], ['⌥ M', 'Mic on / off'], ['Space', 'Play / pause a board'], ['← →', 'Board: previous / next step'],
        ['⌃ ⌘ S', 'Show / hide the sidebar'], ['Esc', 'Close a menu or popup'],
      ];
      body.append(
        card('Rating keys', rows, 'After the answer is shown. Click a key, then press the new one (Esc cancels).'),
        card('Other shortcuts', fixed.map(([k, d]) => el(`<div class="set-row set-kb"><span>${esc(d)}</span><kbd class="set-keycap">${esc(k)}</kbd></div>`))),
        resetLink(keysOf('keys.'), () => PANES.keys(body)));
    },

    async data(body) {
      body.innerHTML = '';
      const [sum, lessons] = await Promise.all([call('api/data/summary'), fetch('api/teach/sessions').then((r) => r.json()).catch(() => ({ sessions: [] }))]);
      const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
      const backup = el(`<div class="set-row"><div class="set-label">Backup</div>
        <div class="set-btns"><button type="button" class="btn" data-a="export">${icon('download')}Download backup</button>
        <label class="btn">Restore from file…<input type="file" accept="application/json,.json" hidden></label></div>
        <p class="set-hint">Progress, history, gaps, lessons, lists and settings in one file (${mb(sum.total - sum.tts.bytes)}). Your ElevenLabs key is never included.</p></div>`);
      backup.querySelector('[data-a=export]').onclick = async () => {
        const h = backup.querySelector('.set-hint');
        try {
          const r = await fetch('api/data/export', { headers: H });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const url = URL.createObjectURL(await r.blob());
          const a = Object.assign(document.createElement('a'), { href: url, download: `learning-quiz-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) { h.className = 'set-hint err'; h.textContent = e.message; }
      };
      backup.querySelector('input[type=file]').onchange = async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        const h = backup.querySelector('.set-hint');
        try {
          const b = JSON.parse(await f.text());
          const n = b && b.files ? Object.keys(b.files).length : 0;
          const when = b && b.exportedAt ? new Date(b.exportedAt).toLocaleString() : 'an unknown date';
          if (!(await Q.confirm({ title: 'Restore this backup?', text: `${n} files from ${when} replace what’s here now. The current files are kept in data/backups first. The app restarts after.`, ok: 'Restore', destructive: true }))) return;
          const r = await call('api/data/import', { backup: b });
          h.className = 'set-hint ok'; h.textContent = `Restored ${r.restored} files. Reloading…`;
          setTimeout(() => location.reload(), 2500);
        } catch (err) { h.className = 'set-hint err'; h.textContent = err.message; }
      };

      const cache = el(`<div class="set-row"><div class="set-label">Voice audio cache <small>${sum.tts.files} clips · ${mb(sum.tts.bytes)}</small></div>
        <div class="set-btns"><button type="button" class="btn" data-a="clear"${sum.tts.files ? '' : ' disabled'}>Clear cache</button></div>
        <p class="set-hint">Saved narration, so replays are instant and free. Cleared clips are made again when played; ElevenLabs clips would cost again.</p></div>`);
      cache.querySelector('[data-a=clear]').onclick = async () => {
        if (!(await Q.confirm({ title: 'Clear the voice cache?', text: `${sum.tts.files} audio clips (${mb(sum.tts.bytes)}). Boards make them again when played.`, ok: 'Clear', destructive: true }))) return;
        try { await call('api/data/tts-clear', {}); PANES.data(body); } catch (e) { const h = cache.querySelector('.set-hint'); h.className = 'set-hint err'; h.textContent = e.message; }
      };

      const ls = (lessons.sessions || []);
      const lessonRows = ls.length ? ls.map((s) => {
        const row = el(`<div class="set-row set-lesson"><span style="min-width:0"><div class="nm">${esc(s.goal || 'Lesson')}</div>
          <div class="nt">${esc(s.subject || '')}${s.subject ? ' · ' : ''}${s.steps} replies · ${esc(new Date(s.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}${s.status === 'closed' ? ' · ended' : ''}</div></span>
          <button type="button" class="icon-btn" title="Delete lesson" aria-label="Delete lesson">${icon('trash')}</button></div>`);
        row.querySelector('button').onclick = async () => {
          if (!(await Q.confirm({ title: 'Delete this lesson?', text: `“${s.goal || 'Lesson'}” and its drawings are deleted for good. Notes you saved to the vault stay.`, ok: 'Delete', destructive: true }))) return;
          try {
            const r = await fetch(`api/teach/${encodeURIComponent(s.id)}/delete`, { method: 'POST', headers: H, body: '{}' });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
            row.remove();
            window.dispatchEvent(new CustomEvent('quiz:lessons-changed'));
          } catch (e) { row.appendChild(el(`<p class="set-hint err">${esc(e.message)}</p>`)); }
        };
        return row;
      }) : [el('<div class="set-row set-hint" style="margin:0">No lessons yet.</div>')];

      const reset = el(`<div class="set-row"><div class="set-btns"><button type="button" class="btn btn-destructive" data-a="reset">Reset all settings</button></div>
        <p class="set-hint">Every setting in this window back to its default. Voice engine, voice and key stay.</p></div>`);
      reset.querySelector('[data-a=reset]').onclick = async () => {
        if (!(await Q.confirm({ title: 'Reset all settings?', text: 'Look, teacher, boards, mic, quiz and shortcuts go back to their defaults.', ok: 'Reset', destructive: true }))) return;
        await PR().reset();
        const h = reset.querySelector('.set-hint'); h.className = 'set-hint ok'; h.textContent = 'Settings reset.';
      };

      body.append(card('Your data', [backup, cache]), card(`Lessons (${ls.length})`, lessonRows), card('Settings', [reset]));
    },
  };

  // ---------- key capture (Shortcuts) ----------
  let capturing = null;
  const keyName = (k) => ({ ' ': 'Space', Space: 'Space', Enter: '↩', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', '`': '`' }[k] || String(k).toUpperCase());
  function stopCapture() { if (capturing) { window.removeEventListener('keydown', capturing.fn, true); capturing.btn.classList.remove('wait'); capturing.btn.textContent = capturing.was; capturing = null; } }
  function captureKey(btn, done) {
    stopCapture();
    const was = btn.textContent;
    btn.classList.add('wait'); btn.textContent = 'Press a key…';
    const fn = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(e.key)) return;
      window.removeEventListener('keydown', fn, true);
      capturing = null;
      btn.classList.remove('wait');
      if (e.key === 'Escape') { btn.textContent = was; return; }
      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!/^(?:[a-z0-9`\-=[\];',./]|Space|Enter|Arrow(?:Up|Down|Left|Right))$/i.test(key)) { btn.textContent = was; return; }
      btn.textContent = keyName(key);
      done(key);
    };
    capturing = { fn, btn, was };
    window.addEventListener('keydown', fn, true);
  }

  function render(body, s) {
    const plan = s.plan;
    const pct = plan && plan.limit ? Math.min(100, Math.round((plan.used / plan.limit) * 100)) : 0;
    const eng = s.engine === 'elevenlabs' ? s.elevenModel === 'eleven_v3' ? 'v3' : 'flash' : 'local';
    const L = s.local || {};
    const where = L.where || 'on this computer';   // 'on this Mac' / 'on this server'
    const per1k = (m) => (s.prices && s.prices[m] ? `$${s.prices[m].toFixed(2)} per 1K characters` : '');
    const engHint = eng === 'local'
      ? `${L.label || `Kokoro, ${where}`}: free and private. Board narration is made right after the teacher draws, so Play starts at once.`
      : `ElevenLabs ${eng === 'v3' ? 'v3: the most expressive, understands tags like [thoughtful]' : 'Flash v2.5: natural and fast, half the price of v3'} · ${per1k(eng === 'v3' ? 'eleven_v3' : 'eleven_flash_v2_5')}. Audio is made only when you press Play (the step playing and the next), never ahead.`;
    const STATE = {
      ready: 'Running', starting: 'Starting…', stopped: 'Installed · starts on first use (a few seconds), stops after 20 idle minutes',
      error: `Couldn’t start${L.error ? `: ${L.error}` : ''}`, missing: 'Not installed. Boards use the browser voice until it is. In Terminal, in the quiz app folder (~/learning-quiz on homebox):',
    };
    body.innerHTML = `
      <section class="set-sec"><h3>Voice engine</h3><div class="set-card">
        <div class="set-row">
          <div class="segmented set-seg" role="group" aria-label="Voice engine">
            <button type="button" data-eng="local" aria-pressed="${eng === 'local'}" title="${esc(L.label || `Kokoro ${where}`)}">Local (free)</button>
            <button type="button" data-eng="flash" aria-pressed="${eng === 'flash'}" title="ElevenLabs Flash v2.5"><span class="lg">ElevenLabs </span>Flash</button>
            <button type="button" data-eng="v3" aria-pressed="${eng === 'v3'}" title="ElevenLabs v3, best quality"><span class="lg">ElevenLabs </span>v3</button>
          </div>
          <p class="set-hint" data-k="engmsg">${esc(engHint)}${eng !== 'local' && !s.hasKey ? ' <b>Add a key below</b>; until then the free voice speaks.' : ''}</p>
        </div>
        ${eng === 'local' ? `<div class="set-row">
          <div class="set-state"><span class="dot ${esc(L.state || 'missing')}"></span><span>${esc(STATE[L.state] || L.state || '')}</span></div>
          ${L.state === 'missing' ? `<code class="set-cmd">${esc(L.installCmd || 'tools/tts-server/install.sh')}</code><p class="set-hint">About 1 GB in ${esc(L.home || '~/.local/share/quiz-tts')}, once. Reopen Settings after.</p>` : ''}
        </div>` : ''}
      </div></section>
      ${eng === 'local' ? `<section class="set-sec"><h3>Voice</h3><div class="set-card"><div class="set-local"></div></div></section>` : ''}
      <section class="set-sec"><h3>ElevenLabs</h3><div class="set-card">
        <div class="set-row">
          <div class="set-label">API key ${s.hasKey ? `<small>${esc(s.keyHint)}</small>` : ''}</div>
          <form class="set-key" autocomplete="off">
            <input class="field" type="password" name="key" placeholder="${s.hasKey ? '' : 'sk_…  (elevenlabs.io → Profile → API keys)'}" aria-label="ElevenLabs API key" spellcheck="false" autocomplete="off">
            <button class="icon-btn" type="button" data-a="eye" aria-label="Show key" title="Show key">${icon('eye')}</button>
            <button class="btn btn-primary" type="submit" data-a="savekey" disabled>Save</button>
          </form>
          <p class="set-hint" data-k="keymsg">${s.hasKey ? `Saved ${esc(where)} only (data/voice.json, not in git).` : 'Only needed for the ElevenLabs engines.'}</p>
        </div>
        ${s.hasKey ? `<div class="set-row">
          <div class="set-label">Usage</div>
          ${plan ? `<div class="set-hint" style="margin:0">${esc(cap(plan.tier || 'ElevenLabs'))} plan · ${num(plan.used)} of ${num(plan.limit)} characters${plan.resetsAt ? ` · resets ${new Date(plan.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</div>
            <div class="set-meter" aria-hidden="true"><span style="width:${pct}%"></span></div>` : `<p class="set-hint">${esc(s.planError || 'Plan details unavailable (the key needs "User: read" permission).')}</p>`}
          <div class="set-cap">This app this month: ${num(s.month.chars)} chars · ~${money(s.month.estUsd)} · cap $<input class="field" type="number" min="0" max="1000" step="1" value="${esc(String(s.cap))}" aria-label="Monthly cap in dollars"></div>
          <p class="set-hint" data-k="capmsg">At the cap, new narration uses the free voice; saved narration still plays.</p>
        </div>` : ''}
      </div></section>
      ${eng !== 'local' ? `<section class="set-sec"><h3>ElevenLabs voice</h3><div class="set-card">
        <div class="set-list"></div>
        <label class="set-search">${icon('search')}<input type="search" placeholder="${s.hasKey ? 'Search voices (e.g. calm teacher, british, narrator)' : 'Add a key to search voices'}" aria-label="Search voices"${s.hasKey ? '' : ' disabled'}></label>
        <div class="set-results"></div>
      </div>
      ${plan && plan.tier === 'free' ? '<p class="set-hint" style="margin:8px 6px 0">On the free plan the app can use the default voices (like George). Voice-library voices, like Pastor Paul, need a paid plan or $5 of credits. Previews work on any plan.</p>' : ''}
      </section>` : ''}`;

    // engine: local / ElevenLabs Flash / ElevenLabs v3
    body.querySelectorAll('[data-eng]').forEach((b) => (b.onclick = async () => {
      const v = b.dataset.eng;
      if (v === eng) return;
      stopPreview();
      try {
        const next = await call('api/voice/engine', v === 'local' ? { engine: 'local' } : { engine: 'elevenlabs', elevenModel: v === 'v3' ? 'eleven_v3' : 'eleven_flash_v2_5' });
        render(body, next);
        window.dispatchEvent(new CustomEvent('quiz:voice-changed'));
        if (Q.board && Q.board.status) Q.board.status();
      } catch (err) { const m = body.querySelector('[data-k=engmsg]'); m.className = 'set-hint err'; m.textContent = err.message; }
    }));
    // local voices, previews made by the local engine (cached after the first)
    const loc = body.querySelector('.set-local');
    if (loc) (L.voices || []).forEach((v) => loc.appendChild(localRow(v, s, body)));
    // While it starts, check back so the dot turns green.
    if (eng === 'local' && L.state === 'starting') setTimeout(async () => { if (open && body.isConnected) { try { render(body, await call('api/voice/settings')); } catch {} } }, 2500);

    // key: hidden, show on demand (fetched from the server only when asked)
    const form = body.querySelector('.set-key');
    const input = form.querySelector('input');
    const eye = form.querySelector('[data-a=eye]');
    const save = form.querySelector('[data-a=savekey]');
    const keyMsg = body.querySelector('[data-k=keymsg]');
    let saved = '';
    let loaded = false;
    if (s.hasKey) input.value = '••••••••••••••••••••••••••••••••••';
    input.addEventListener('focus', async () => { if (s.hasKey && !loaded) await loadKey(); });
    async function loadKey() {
      try { saved = (await call('api/voice/key/reveal', {})).apiKey || ''; loaded = true; input.value = saved; } catch (e) { keyMsg.className = 'set-hint err'; keyMsg.textContent = e.message; }
    }
    eye.onclick = async () => {
      if (s.hasKey && !loaded) await loadKey();
      const showIt = input.type === 'password';
      input.type = showIt ? 'text' : 'password';
      eye.innerHTML = icon(showIt ? 'eye-off' : 'eye');
      eye.setAttribute('aria-label', showIt ? 'Hide key' : 'Show key');
      eye.title = showIt ? 'Hide key' : 'Show key';
    };
    input.addEventListener('input', () => { save.disabled = input.value.trim() === saved.trim() || (!loaded && s.hasKey && /^•+$/.test(input.value)); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true; save.textContent = 'Checking…';
      keyMsg.className = 'set-hint'; keyMsg.textContent = 'Checking the key with ElevenLabs…';
      try {
        const next = await call('api/voice/key', { apiKey: input.value.trim() });
        render(body, next);
        const m = body.querySelector('[data-k=keymsg]');
        m.className = 'set-hint ok'; m.textContent = next.hasKey ? 'Key saved and working.' : 'Key removed. Boards use the free voice.';
        window.dispatchEvent(new CustomEvent('quiz:voice-changed'));
      } catch (err) {
        keyMsg.className = 'set-hint err'; keyMsg.textContent = err.message;
        save.textContent = 'Save'; save.disabled = false;
      }
    };

    // monthly cap
    const capIn = body.querySelector('.set-cap input');
    if (capIn) capIn.addEventListener('change', async () => {
      const m = body.querySelector('[data-k=capmsg]');
      try { await call('api/voice/cap', { monthlyCapUsd: Number(capIn.value) }); m.className = 'set-hint ok'; m.textContent = `Cap set to $${Number(capIn.value)} a month.`; }
      catch (err) { m.className = 'set-hint err'; m.textContent = err.message; }
    });

    // voices: presets (+ the current one when it's something else), then search results
    const list = body.querySelector('.set-list');
    if (!list) return;
    const voices = [...s.presets];
    if (s.voice && s.voice.id && !voices.some((v) => v.id === s.voice.id)) voices.push({ id: s.voice.id, name: (s.voice.name || 'Current voice').replace(/\s+-\s+.*$/, ''), note: 'Current voice', library: false });
    voices.forEach((v) => list.appendChild(voiceRow(v, s, body)));

    const q = body.querySelector('.set-search input');
    const results = body.querySelector('.set-results');
    let timer = null, page = 0, lastQ = '';
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(true), 350); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); search(true); } });
    async function search(fresh) {
      const term = q.value.trim();
      if (fresh) { page = 0; lastQ = term; results.innerHTML = term ? '<div class="set-empty">Searching…</div>' : ''; if (!term) return; }
      try {
        const j = await call(`api/voice/library?q=${encodeURIComponent(lastQ)}&page=${page}`);
        if (fresh) results.innerHTML = '';
        const more = results.querySelector('.set-more');
        if (more) more.remove();
        if (!j.voices.length && fresh) { results.innerHTML = '<div class="set-empty">No voices found.</div>'; return; }
        j.voices.forEach((v) => results.appendChild(voiceRow(v, s, body)));
        if (j.hasMore) {
          const b = el('<button type="button" class="set-more">More voices</button>');
          b.onclick = () => { page++; b.textContent = 'Loading…'; search(false); };
          results.appendChild(b);
        }
      } catch (err) { results.innerHTML = `<div class="set-empty">${esc(err.message)}</div>`; }
    }
  }
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

  function localRow(v, s, body) {
    const on = s.local && s.local.voice === v.id;
    const ok = s.local && s.local.installed;
    const row = el(`<div class="set-voice${on ? ' on' : ''}" role="radio" aria-checked="${on}" tabindex="0">
      <span class="radio" aria-hidden="true"></span>
      <span style="min-width:0"><div class="nm">${esc(v.name)}</div><div class="nt">${esc(v.note || '')}</div></span>
      <span class="acts"><button type="button" class="set-play" aria-label="Preview ${esc(v.name)}" title="Preview"${ok ? '' : ' disabled'}>${icon('play')}</button></span>
    </div>`);
    const btn = row.querySelector('.set-play');
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (playingBtn === btn) { stopPreview(); return; }
      stopPreview();
      btn.classList.add('playing'); btn.innerHTML = '<span class="activity" style="width:14px;height:14px"></span>';
      try { const d = await call('api/voice/preview', { voice: v.id }); btn.classList.remove('playing'); btn.innerHTML = icon('play'); preview(btn, d.url); }
      catch (err) { btn.classList.remove('playing'); btn.innerHTML = icon('play'); row.querySelector('.err')?.remove(); row.appendChild(el(`<div class="err">${esc(err.message)}</div>`)); }
    };
    const choose = async () => {
      if (on) return;
      try {
        await call('api/voice/local-voice', { voice: v.id });
        render(body, await call('api/voice/settings'));
        window.dispatchEvent(new CustomEvent('quiz:voice-changed'));
        if (Q.board && Q.board.status) Q.board.status();
        if (Q.showToast) Q.showToast(`Voice: ${v.name}. New narration uses it.`);
      } catch (err) { row.appendChild(el(`<div class="err">${esc(err.message)}</div>`)); }
    };
    row.onclick = choose;
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } };
    return row;
  }

  function voiceRow(v, s, body) {
    const on = s.voice && s.voice.id === v.id;
    const paid = v.library && s.plan && s.plan.tier === 'free';
    const row = el(`<div class="set-voice${on ? ' on' : ''}" role="radio" aria-checked="${on}" tabindex="0">
      <span class="radio" aria-hidden="true"></span>
      <span style="min-width:0"><div class="nm">${esc(v.name.replace(/\s+-\s+/, ' — '))}</div><div class="nt">${esc(v.note || '')}${paid ? ' · <span class="paid">paid plan</span>' : ''}</div></span>
      <span class="acts"><button type="button" class="set-play" aria-label="Preview ${esc(v.name)}" title="Preview"${v.preview_url ? '' : ' disabled'}>${icon('play')}</button></span>
    </div>`);
    if (v.description) row.title = v.description;
    const btn = row.querySelector('.set-play');
    btn.onclick = (e) => { e.stopPropagation(); preview(btn, v.preview_url); };
    const choose = async () => {
      if (!s.hasKey || (s.voice && s.voice.id === v.id)) return;
      row.querySelector('.err')?.remove();
      try {
        await call('api/voice/config', { voiceId: v.id, ownerId: v.ownerId || undefined, name: v.name.replace(/\s+-\s+.*$/, '') });
        const fresh = await call('api/voice/settings');
        const term = body.querySelector('.set-search input').value;
        render(body, fresh);
        if (term) { const q = body.querySelector('.set-search input'); q.value = term; q.dispatchEvent(new Event('input')); }
        window.dispatchEvent(new CustomEvent('quiz:voice-changed'));
        if (Q.showToast) Q.showToast(`Voice: ${v.name.replace(/\s+-\s+.*$/, '')}. New narration uses it.`);
      } catch (err) {
        row.appendChild(el(`<div class="err">${esc(err.message)}</div>`));
      }
    };
    row.onclick = choose;
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } };
    return row;
  }

  // Quiz.settings.open('voice') opens a section directly.
  Q.settings = { open: show };
  // The gear in the sidebar header (index.html).
  const gear = document.getElementById('settingsBtn');
  if (gear) gear.onclick = show;
})();
