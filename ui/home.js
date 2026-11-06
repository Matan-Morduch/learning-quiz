// Home tab: where the app opens. A one-screen dashboard: a greeting and stat tiles, lessons to
// continue, a box to start a new lesson, a quick review of what's due, the next To Learn items and
// open gaps. On a desktop window it fills the content area exactly (no page scroll); panels with long
// content scroll inside themselves. Narrow windows stack the panels and the page scrolls.
// Renders into #tab-home on the 'tab' hook.
(() => {
  if (!window.Quiz) return;
  const Q = window.Quiz;
  const { esc } = Q;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const CMD_ENTER = isMac ? '⌘↩' : 'Ctrl ↩';
  const SEC_PER_Q = 30;   // rough time per review question
  const PHASE = { probe: ['Getting started', ''], plan: ['Plan ready', 'orange'], teach: ['In progress', 'accent'] };
  const MAX_CONTINUE = 12, MAX_NEXT = 12, MAX_GAPS = 20;

  // Fit mode (body.hd-fit, set by fit() below): the stage is wide and tall enough for the whole
  // dashboard on one screen. Measured in CSS px, so the Text size pref (zoom on :root) counts.
  const FIT_W = 560, FIT_H = 560;
  const H = 'body[data-tab="home"]:not(.setup-off)';
  const F = `body.hd-fit${H.slice(4)}`;

  const css = document.createElement('style');
  css.textContent = `
  /* page chrome: the greeting lives in the dashboard, so no page head; a wider stage */
  body[data-tab="home"] .page-head { display: none; }
  ${H} .wrap { max-width: 1400px; }

  .hd { container-type: inline-size; display: flex; flex-direction: column; gap: 16px; }
  .hd-loading { padding: 40px 0; text-align: center; }

  /* top strip: greeting + stat tiles */
  .hd-top { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; }
  .hd-hello { flex: 0 1 auto; min-width: 0; margin-right: auto; }
  .hd-hello h1 { font: var(--title1); letter-spacing: -.02em; margin: 0; color: var(--label); }
  .hd-hello p { font: var(--subhead); color: var(--label-2); margin: 2px 0 0; }
  .hd-stats { flex: 1 1 480px; max-width: 840px; display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 12px; }
  .hd-stat { all: unset; box-sizing: border-box; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 4px 8px; min-width: 0; padding: 10px 12px 9px;
    background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1), 0 0 0 .5px var(--separator);
    cursor: pointer; transition: background var(--dur), transform .12s var(--ease); }
  .hd-stat:hover { background: color-mix(in srgb, var(--surface) 94%, var(--label)); }
  .hd-stat:active { transform: scale(.98); }
  .hd-stat:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 2px; }
  .hd-stat-ic { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--c, var(--accent)); color: #fff; }
  .hd-stat-ic svg { width: 16px; height: 16px; stroke-width: 2.1; }
  .hd-ring { flex: none; width: 28px; height: 28px; transform: rotate(-90deg); }
  .hd-ring circle { fill: none; stroke-width: 4; }
  .hd-ring .bg { stroke: var(--fill-hover); }
  .hd-ring .fg { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset .5s var(--ease); }
  .hd-stat.met .hd-ring .fg { stroke: var(--green); }
  .hd-stat .v { justify-self: end; font: 700 22px/26px var(--font-rounded); letter-spacing: -.01em; color: var(--label); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .hd-stat .v small { font: 600 13px/1 var(--font); color: var(--label-2); margin-left: 2px; }
  .hd-stat .l { grid-column: 1 / -1; font: 600 12px/16px var(--font); color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* grid of panels */
  .hd-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(min(300px, 45cqi), 1fr); gap: 16px; align-items: start; }
  .hd-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; min-height: 0; }
  .hd-panel { display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-radius: var(--r-lg);
    box-shadow: var(--shadow-1), 0 0 0 .5px var(--separator); overflow: hidden; transition: box-shadow var(--dur); }
  .hd-ph { flex: none; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 8px 4px 16px; border-bottom: 1px solid transparent; transition: border-color var(--dur); }
  .hd-panel.scrolled .hd-ph { border-bottom-color: var(--separator); }
  .hd-ph > svg { width: 16px; height: 16px; color: var(--accent); flex: none; }
  .hd-ph h2 { font: 600 15px/20px var(--font); margin: 0; color: var(--label); white-space: nowrap; }
  .hd-n { font: 600 12px/18px var(--font); color: var(--label-2); background: var(--fill); padding: 0 7px; border-radius: var(--r-pill); font-variant-numeric: tabular-nums; }
  .hd-ph .spacer { flex: 1; }
  .hd-ph .btn-plain { height: 26px; font-size: 13px; padding: 0 8px; }
  .hd-pb { flex: 1 1 auto; min-height: 0; max-height: 340px; overflow-y: auto; overscroll-behavior: contain; padding-bottom: 4px;
    scrollbar-width: thin; scrollbar-color: var(--separator-strong) transparent; }
  .hd-pb::-webkit-scrollbar { width: 8px; }
  .hd-pb::-webkit-scrollbar-thumb { background: var(--separator-strong); border-radius: 8px; border: 2px solid var(--surface); }
  .hd-pb::-webkit-scrollbar-track { background: transparent; }

  /* rows */
  .hm-row { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 12px 8px 16px; position: relative; }
  .hm-row + .hm-row::before { content: ""; position: absolute; top: 0; left: 16px; right: 0; border-top: 1px solid var(--separator); }
  .hm-row .grow { flex: 1; min-width: 0; }
  .hm-row .t { font: var(--subhead); font-weight: 500; color: var(--label); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .hm-row .m { display: flex; align-items: center; gap: 6px; margin-top: 3px; font: var(--footnote); color: var(--label-2); min-width: 0; }
  .hm-row .m span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hm-row .m .tag { flex: none; font-size: 12px; }
  .hm-row .btn { flex: none; }
  .hm-row button.grow { all: unset; display: block; flex: 1; min-width: 0; cursor: pointer; border-radius: var(--r-xs); }
  .hm-row button.grow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .hm-row button.grow:hover .t { color: var(--accent); }
  .hm-tile { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; flex: none; background: var(--accent-tint); color: var(--accent); }
  .hm-tile svg { width: 18px; height: 18px; }
  .hm-quiet { padding: 4px 16px 14px; font: var(--subhead); color: var(--label-2); }
  .hm-quiet .btn-plain { height: auto; padding: 0; font: inherit; vertical-align: baseline; }

  /* quick review: the count leads */
  .hd-review { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; padding: 2px 16px 14px; }
  .hd-review .big { font: 700 34px/38px var(--font-rounded); letter-spacing: -.02em; color: var(--label); font-variant-numeric: tabular-nums; }
  .hd-review .grow { flex: 1 1 140px; min-width: 0; }
  .hd-review .t { font: var(--subhead); font-weight: 600; color: var(--label); }
  .hd-review .m { font: var(--footnote); color: var(--label-2); margin-top: 1px; }
  .hd-review .m .warn { color: color-mix(in srgb, var(--orange) 85%, var(--label)); }
  .hd-review .btn-primary { flex: none; }
  .hd-review.ok .hm-tile { background: color-mix(in srgb, var(--green) 16%, transparent); color: var(--green); width: 38px; height: 38px; border-radius: 10px; }

  /* start a lesson: the panel is the compose box */
  .hd-compose:focus-within { box-shadow: var(--shadow-1), 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent), 0 0 0 4px var(--accent-tint); }
  .hd-compose .tc-compose, .hd-compose .tc-compose:focus-within { background: none; border: 0; box-shadow: none; border-radius: 0; padding: 0 12px 10px 16px; }
  .hd-compose .tc-compose textarea { font: 400 19px/1.35 var(--font); letter-spacing: -.012em; min-height: 30px !important; max-height: 132px; }
  .hd-compose .tc-compose-bar { margin-top: 8px; }
  .hd-compose .hm-mic { margin-left: auto; }
  .hd-compose { container: hdcompose / inline-size; }
  @container hdcompose (max-width: 500px) { .hd-compose .hm-hint { display: none; } }
  .hd-compose .hm-hint { font: var(--footnote); color: var(--label-2); flex: 1 1 180px; min-width: 0; }

  /* one screen: the content area is exactly the window, minus the status bar */
  /* 100dvh is in zoomed px under the Text size pref, so divide by the zoom (base.css) */
  :root[data-text="small"] { --hd-zoom: .9; }
  :root[data-text="large"] { --hd-zoom: 1.1; }
  :root[data-text="xlarge"] { --hd-zoom: 1.22; }
  ${F} .app { min-height: 0; }
  ${F} .side { height: calc(100vh / var(--hd-zoom, 1)); height: calc(100dvh / var(--hd-zoom, 1)); }
  ${F} .main { height: calc(100vh / var(--hd-zoom, 1)); height: calc(100dvh / var(--hd-zoom, 1)); min-height: 0; }
  ${F} .wrap { display: flex; flex-direction: column; min-height: 0; padding: 24px 32px 20px; }
  ${F} #setup { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  ${F} #tab-home { flex: 1; min-height: 0; }
  ${F} .hd { height: 100%; }
  ${F} .hd-grid { flex: 1; min-height: 0; align-items: stretch; }
  ${F} .hd-pb { max-height: none; }
  ${F} .hd-continue { flex: 1 1 auto; min-height: 140px; }
  ${F} .hd-side .hd-list { flex: 1 1 0; min-height: 112px; max-height: max-content; }
  ${F} :is(.hd-compose, .hd-quick) { flex: none; }
  /* compact density: tighter dashboard */
  :root[data-density="compact"] .hd, :root[data-density="compact"] .hd-col, :root[data-density="compact"] .hd-grid { gap: 12px; }
  :root[data-density="compact"] .hm-row { min-height: 44px; padding-top: 6px; padding-bottom: 6px; }
  :root[data-density="compact"] .hd-ph { min-height: 38px; }
  :root[data-density="compact"] .hd-stat { padding: 8px 10px; }

  /* narrow stage: one column, panels in reading order */
  @container (max-width: 559px) {
    .hd-grid { grid-template-columns: minmax(0, 1fr); }
    .hd-stats { flex-basis: 100%; max-width: none; }
  }
  @container (max-width: 560px) {
    .hd-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .hd-compose .hm-hint { display: none; }
    .hd-review .btn-primary { width: 100%; }
  }
  @media (max-width: 600px) {
    .hd-hello h1 { font: var(--title2); }
    .hd-pb { max-height: 300px; }
    .hm-row { padding-left: 14px; }
  }`;
  document.head.appendChild(css);

  const box = () => Q.$('tab-home');
  const S = { draft: '', scroll: {}, focus: false };

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }
  function ago(t) {
    const s = (Date.now() - new Date(t)) / 1000;
    return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago`
      : s < 172800 ? 'yesterday' : `${Math.round(s / 86400)} days ago`;
  }
  const pref = (k, d) => { try { const v = Q.prefs && Q.prefs.get(k); return v === undefined || v === null ? d : v; } catch { return d; } };
  const get = (p) => Q.api(p).catch(() => null);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  async function render() {
    const el = box();
    if (!el) return;
    if (!el.firstChild) el.innerHTML = '<div class="hd-loading"><span class="activity"></span></div>';
    const [sessions, topics, tolearn, gaps, streak] = await Promise.all(
      ['api/teach/sessions', 'api/topics', 'api/tolearn', 'api/gaps', 'api/streak?tz=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || '')].map(get));
    if (Q.tab !== 'home') return;
    // Keep what the user had going across re-renders: the draft, its focus, where each panel was scrolled.
    const goalField = el.querySelector('#hmGoal');
    if (goalField) { S.draft = goalField.value; S.focus = document.activeElement === goalField; }
    el.querySelectorAll('[data-hd]').forEach((p) => { const b = p.querySelector('.hd-pb'); if (b) S.scroll[p.dataset.hd] = b.scrollTop; });

    const d = { sessions, topics, tolearn, gaps, streak };
    d.going = ((sessions && sessions.sessions) || []).filter((s) => s.phase !== 'done' && s.status !== 'closed')
      .sort((a, b) => new Date(b.updated) - new Date(a.updated));
    d.due = topics && topics.topics ? topics.topics.reduce((a, t) => a + (t.review || 0), 0) : null;
    d.weak = topics && topics.topics ? topics.topics.reduce((a, t) => a + (t.reviewWeak || 0), 0) : 0;
    d.left = tolearn ? ((tolearn.lists || []).reduce((a, l) => a + (l.items || []).filter((it) => it.status === 'todo').length, 0)) : null;

    el.innerHTML = `<div class="hd">
      ${topHtml(d)}
      <div class="hd-grid">
        <div class="hd-col hd-main">
          ${composeHtml()}
          ${continueHtml(d)}
        </div>
        <div class="hd-col hd-side">
          ${reviewHtml(topics, d)}
          ${toLearnHtml(tolearn, d)}
          ${gapsHtml(gaps)}
        </div>
      </div>
    </div>`;
    wire(el, d);
    fit();
  }

  // ---------- top strip ----------
  function stat({ go, ic, c, v, small = '', l, title, extra = '' }) {
    return `<button class="hd-stat${extra}" type="button" data-hm-go="${go}" title="${esc(title)}">
      ${ic}<span class="v">${v}${small ? `<small>${small}</small>` : ''}</span><span class="l">${l}</span></button>`;
  }
  const circle = (name, c) => `<span class="hd-stat-ic" style="--c:${c}">${icon(name)}</span>`;
  function ring(pct) {
    const r = 13, len = 2 * Math.PI * r;
    return `<svg class="hd-ring" viewBox="0 0 32 32" aria-hidden="true"><circle class="bg" cx="16" cy="16" r="${r}"/>
      <circle class="fg" cx="16" cy="16" r="${r}" stroke-dasharray="${len.toFixed(2)}" stroke-dashoffset="${(len * (1 - pct / 100)).toFixed(2)}"/></svg>`;
  }
  function topHtml(d) {
    const st = d.streak;
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const tiles = [];
    if (st && st.goal) {
      const pct = Math.min(100, Math.round((st.today / st.goal) * 100));
      tiles.push(stat({ go: 'review', ic: ring(Math.max(pct, st.today ? 4 : 0)), v: st.today, small: `/ ${st.goal}`, extra: st.met ? ' met' : '',
        l: st.streak ? `${st.met ? 'Done' : 'Goal'} · ${st.streak}-day streak` : (st.met ? 'Daily goal done' : 'Daily goal'),
        title: st.met ? 'Today’s goal is done' : `${st.goal - st.today} to go today` }));
    } else if (st) {
      tiles.push(stat({ go: 'settings', ic: circle('check-circle', 'var(--green)'), v: st.today,
        l: st.streak ? `Today · ${st.streak}-day streak` : 'Answered today', title: 'Answered today. Set a daily goal in Settings' }));
    }
    if (d.due !== null) {
      tiles.push(stat({ go: 'review', ic: circle('review', d.due ? 'var(--orange)' : 'var(--green)'), v: d.due,
        l: 'Reviews due', title: d.weak ? `${d.weak} of them weak. Open Review setup` : 'Open Review setup' }));
    }
    tiles.push(stat({ go: 'teach', ic: circle('teach', 'var(--accent)'), v: d.going.length, l: 'Active lessons', title: 'Lessons in progress' }));
    if (d.left !== null) tiles.push(stat({ go: 'tolearn', ic: circle('list', 'var(--indigo)'), v: d.left, l: 'Left to learn', title: 'Your To Learn lists' }));
    return `<header class="hd-top">
      <div class="hd-hello"><h1>${greeting()}</h1><p>${esc(date)}</p></div>
      <div class="hd-stats" style="--n:${tiles.length}">${tiles.join('')}</div>
    </header>`;
  }

  // ---------- panels ----------
  const panel = (key, cls, ic, title, n, link, body) => `<section class="hd-panel ${cls}" data-hd="${key}">
    <div class="hd-ph">${icon(ic)}<h2>${title}</h2>${n ? `<span class="hd-n">${n}</span>` : ''}<span class="spacer"></span>${link}</div>
    ${body}</section>`;
  const scroller = (inner) => `<div class="hd-pb">${inner}</div>`;

  function continueHtml(d) {
    const all = '<button class="btn btn-plain" type="button" data-hm-go="teach">All lessons</button>';
    const list = d.going.slice(0, MAX_CONTINUE);
    if (!list.length) {
      return panel('continue', 'hd-continue', 'teach', 'Continue', 0, all,
        scroller('<div class="hm-quiet">No lessons in progress. Start one above, or pick something from your To Learn lists.</div>'));
    }
    return panel('continue', 'hd-continue', 'teach', 'Continue', d.going.length, all, scroller(list.map((s) => {
      const [label, color] = PHASE[s.phase] || [s.phase || '', ''];
      return `<div class="hm-row">
        <span class="hm-tile">${icon(s.lab && (s.lab.file || s.lab.task) ? 'terminal' : 'teach')}</span>
        <button class="grow" type="button" data-hm-resume="${esc(s.id)}"><div class="t">${esc(s.goal)}</div>
          <div class="m">${s.busy ? '<span class="activity" title="The teacher is working"></span>' : ''}<span class="badge ${color}">${esc(label)}</span><span>${esc(ago(s.updated))}</span></div></button>
        <button class="btn btn-tinted btn-sm" type="button" data-hm-resume="${esc(s.id)}">Resume</button>
      </div>`;
    }).join('')));
  }

  function reviewSize() { return Number(pref('quiz.reviewSize', 0)) || 10; }
  function reviewHtml(t, d) {
    const customize = '<button class="btn btn-plain" type="button" data-hm-go="review">Customize</button>';
    const p = (body) => panel('review', 'hd-quick', 'review', 'Quick review', 0, customize, body);
    if (d.due === null) return p(`<div class="hm-quiet">Couldn't load your questions.</div>`);
    if (!d.due) {
      const fresh = !t.totalAnswers;
      return p(`<div class="hd-review ok"><span class="hm-tile">${icon(fresh ? 'review' : 'check-circle')}</span>
        <div class="grow"><div class="t">${fresh ? 'Nothing to review yet' : 'Nothing due'}</div>
        <div class="m">${fresh ? 'Questions you answer come back here when it’s time to see them again.' : 'You’re up to date. Answered questions come back when they’re due.'}</div></div></div>`);
    }
    const n = Math.min(d.due, reviewSize());
    const min = Math.max(1, Math.round((n * SEC_PER_Q) / 60));
    const run = d.due > n ? `${n} now, about ${min} min` : `About ${min} min`;
    return p(`<div class="hd-review"><span class="big">${d.due}</span>
      <div class="grow"><div class="t">${d.due === 1 ? 'question' : 'questions'} due${d.weak ? `, <span class="warn">${d.weak} weak</span>` : ''}</div>
        <div class="m" title="Only questions you’ve seen, from every topic">${run}</div></div>
      <button class="btn btn-primary" type="button" id="hmReview" data-n="${n}">${icon('play')}Start review</button></div>`);
  }

  // The next items still to learn, in list order (lists still being organized are skipped).
  function nextItems(d, max) {
    const out = [];
    for (const l of (d && d.lists) || []) {
      if (l.state && l.state !== 'ready') continue;
      const items = (l.items || []).filter((it) => it.status === 'todo').sort((a, b) => (a.step || 0) - (b.step || 0));
      for (const it of items) { out.push({ l, it }); if (out.length >= max) return out; }
    }
    return out;
  }
  function toLearnHtml(t, d) {
    const all = '<button class="btn btn-plain" type="button" data-hm-go="tolearn">All lists</button>';
    if (!t) return '';
    const p = (n, body) => panel('tolearn', 'hd-list', 'list', 'Up next to learn', n, all, scroller(body));
    if (!(t.lists || []).length) {
      return p(0, `<div class="hm-quiet">Keep a list of things you want to learn, and the next ones show up here, one click from a lesson.
        <button class="btn btn-plain" type="button" data-hm-go="tolearn">Make a list</button></div>`);
    }
    const next = nextItems(t, MAX_NEXT);
    if (!next.length) return p(0, '<div class="hm-quiet">Everything on your lists is learned or skipped. Nice.</div>');
    return p(d.left, next.map(({ l, it }) => {
      const going = it.lesson && it.lesson.phase !== 'done';
      return `<div class="hm-row">
        <button class="grow" type="button" data-hm-show="${esc(l.id)}|${esc(it.id)}" title="Show it in its list"><div class="t">${esc(it.title)}</div>
          <div class="m"><span>${esc([l.title, it.section && it.section !== l.title ? it.section : ''].filter(Boolean).join(' · '))}</span></div></button>
        <button class="btn btn-tinted btn-sm" type="button" data-hm-item="${esc(l.id)}|${esc(it.id)}">${icon('teach')}${going ? 'Continue' : 'Teach'}</button>
      </div>`;
    }).join(''));
  }

  function gapsHtml(d) {
    if (!d) return '';
    const all = d.open || [];
    const open = all.slice().sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0)).slice(0, MAX_GAPS);
    const more = all.length ? `<button class="btn btn-plain" type="button" data-hm-go="gaps">${all.length > open.length ? `All ${all.length}` : 'Review setup'}</button>` : '';
    const p = (body) => panel('gaps', 'hd-list', 'target', 'Study next', all.length, more, scroller(body));
    if (!open.length) return p('<div class="hm-quiet">Nothing to study yet. When an answer shows a gap in what you know, the idea to learn shows up here.</div>');
    return p(open.map((g) => {
      const concept = (g.analysis && g.analysis.concept) || g.texts[g.texts.length - 1].text;
      return `<div class="hm-row">
        <div class="grow"><div class="t">${esc(concept)}</div>
          <div class="m"><span class="tag" style="--tag:${Q.subjectTint ? Q.subjectTint(g.subject) : 'var(--label-3)'}">${esc(g.subject || '')}</span>${g.topic ? `<span>· ${esc(g.topic)}</span>` : ''}</div></div>
        <button class="btn btn-tinted btn-sm" type="button" data-hm-gap="${esc(g.id)}">${icon('teach')}Teach</button>
      </div>`;
    }).join(''));
  }

  function composeHtml() {
    return panel('compose', 'hd-compose', 'sparkles', 'Start a lesson', 0, '', `<div class="tc-compose">
      <textarea id="hmGoal" rows="1" placeholder="What do you want to understand?" aria-label="What do you want to understand?"></textarea>
      <div class="tc-compose-bar">
        <span class="hm-hint">The teacher asks a few questions first, then plans the steps.</span>
        <span class="hm-mic"></span>
        <button class="btn btn-primary tc-start" id="hmStart" type="button" title="Start lesson (${CMD_ENTER})">Start lesson <span class="tc-kbd">${CMD_ENTER}</span></button>
      </div></div>`);
  }

  // ---------- actions ----------
  function teach(detail) { window.dispatchEvent(new CustomEvent('quiz:teach', { detail })); }
  function openLesson(id) {
    if (!Q.teach) return;
    Q.setTab('teach');
    Q.teach.open(id);
  }

  function wire(el, d) {
    el.querySelectorAll('[data-hm-resume]').forEach((b) => (b.onclick = () => openLesson(b.dataset.hmResume)));
    el.querySelectorAll('[data-hm-go]').forEach((b) => (b.onclick = () => {
      const go = b.dataset.hmGo;
      if (go === 'settings') { if (Q.settings) Q.settings.open('quiz'); return; }
      if (go === 'review') Q.setTab('smart');
      else if (go === 'gaps') { Q.setTab('smart'); const s = Q.$('studyNext'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else Q.setTab(go);
      if (go !== 'gaps') window.scrollTo(0, 0);
    }));
    const rv = el.querySelector('#hmReview');
    if (rv) rv.onclick = () => { if (Q.startQuickReview) Q.startQuickReview(Number(rv.dataset.n) || reviewSize()); };

    const find = (key) => {
      const [lid, iid] = key.split('|');
      const l = ((d.tolearn && d.tolearn.lists) || []).find((x) => x.id === lid);
      return { l, it: l && l.items.find((x) => x.id === iid) };
    };
    el.querySelectorAll('[data-hm-show]').forEach((b) => (b.onclick = () => {
      const { l, it } = find(b.dataset.hmShow);
      if (l && it && Q.toLearn) Q.toLearn.show(l.id, it.id); else Q.setTab('tolearn');
    }));
    // Same as To Learn's Teach button: continue its lesson, or start one linked to the item.
    el.querySelectorAll('[data-hm-item]').forEach((b) => (b.onclick = () => {
      const { l, it } = find(b.dataset.hmItem);
      if (!l || !it) return;
      if (it.lesson && it.lesson.phase !== 'done') return openLesson(it.lesson.id);
      teach({ goal: it.title, subject: it.subject || null, noteTitle: it.have && it.have.isNote ? it.have.note : null, toLearn: { list: l.id, item: it.id } });
    }));
    // Same event as the gap cards on the Review setup page.
    el.querySelectorAll('[data-hm-gap]').forEach((b) => (b.onclick = () => {
      const g = ((d.gaps && d.gaps.open) || []).find((x) => x.id === b.dataset.hmGap);
      if (!g) return;
      teach({ gapId: g.id, subject: g.subject, goal: (g.analysis && g.analysis.concept) || g.texts[g.texts.length - 1].text,
        noteTitle: (g.analysis && g.analysis.note && g.analysis.note.title) || null });
    }));

    // Panels: put each list back where it was, and show a hairline under the header once it scrolls.
    el.querySelectorAll('[data-hd]').forEach((p) => {
      const b = p.querySelector('.hd-pb');
      if (!b) return;
      b.scrollTop = S.scroll[p.dataset.hd] || 0;
      const sync = () => p.classList.toggle('scrolled', b.scrollTop > 0);
      b.addEventListener('scroll', sync, { passive: true });
      sync();
    });

    const ta = el.querySelector('#hmGoal');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`; };
    ta.value = S.draft || '';
    if (ta.value) grow();
    if (S.focus) ta.focus();
    const start = () => {
      const goal = ta.value.trim();
      if (!goal) { ta.focus(); Q.showToast('Write what you want to understand first'); return; }
      S.draft = '';
      ta.value = '';
      teach({ goal });
    };
    el.querySelector('#hmStart').onclick = start;
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); start(); } });
    ta.addEventListener('input', () => { S.draft = ta.value; grow(); });
    // Dictation (ui/think.js), moved into the bar like Teach's goal field.
    try {
      if (Q.think && Q.think.mic) {
        Q.think.mic(ta, { hint: 'Teach me' });
        const wrap = ta._thinkMic && ta._thinkMic.btn && ta._thinkMic.btn.parentElement;
        if (wrap) { wrap.classList.add('tc-micwrap'); el.querySelector('.hm-mic').appendChild(wrap); }
      }
    } catch {}
  }

  // One screen when the stage is wide and tall enough (in CSS px); otherwise the panels stack and the page scrolls.
  function fit() {
    const el = box();
    if (!el || Q.tab !== 'home' || el.classList.contains('hidden')) return;
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    document.body.classList.toggle('hd-fit', el.clientWidth >= FIT_W && window.innerHeight / z >= FIT_H);
  }
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);

  Q.on('tab', (t) => { if (t === 'home') render(); });
  window.addEventListener('quiz:lessons-changed', () => { if (Q.tab === 'home') render(); });
  window.addEventListener('quiz:prefs', (e) => {
    const changed = (e.detail && e.detail.changed) || [];
    requestAnimationFrame(fit);   // Text size changes the stage in CSS px
    if (Q.tab === 'home' && changed.some((k) => k === 'quiz.dailyGoal' || k === 'quiz.reviewSize')) render();
  });
  if (Q.tab === 'home') render();
})();
