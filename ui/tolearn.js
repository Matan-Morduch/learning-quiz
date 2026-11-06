// 📚 To Learn tab: lists of things to learn (tolearn.js on the server).
// Paste a raw list → Claude organizes it into sections, merges duplicates and marks what your notes
// already cover. Each item has a Teach button that starts (or continues) a lesson on just that item.
(() => {
  if (!window.Quiz) return;
  const Q = window.Quiz;
  const { esc } = Q;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const S = { lists: null, subjects: [], available: true, compose: false, poll: null, menu: null };
  const CLOSED_KEY = 'tolearn.closed';
  const SHOW_KEY = 'tolearn.show';

  const css = document.createElement('style');
  css.textContent = `
  /* Apple grouped-list look, like Teach's "Recent lessons" and "Labs": a plain header per list (no card),
     each section a list-header over one .list of rows. Tokens and components come from ui/base.css. */
  .tl { display: flex; flex-direction: column; gap: 40px; }
  .tl > * { flex: none; }
  .tl-top { display: flex; justify-content: flex-end; margin-bottom: -24px; }
  .tl-top:empty { display: none; }

  /* compose: a card with the app's .field inputs */
  .tl-compose { background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .tl-compose > * { flex: none; }
  .tl-compose h3 { font: var(--headline); margin: 0 0 2px; }
  .tl-compose .field { font: var(--subhead); }
  .tl-compose textarea.field { min-height: 180px; }
  .tl-compose .tl-cbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  .tl-compose .tl-cbar .note { flex: 1 1 240px; font: var(--footnote); color: var(--label-2); }

  /* empty + status */
  .tl-empty { padding: 40px 24px 36px; text-align: center; background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1); }
  .tl-empty .ic-tile { width: 52px; height: 52px; margin: 0 auto 14px; border-radius: 14px; display: grid; place-items: center; background: var(--fill); color: var(--label-2); }
  .tl-empty .ic-tile svg { width: 28px; height: 28px; }
  .tl-empty h3 { font: var(--headline); margin: 0 0 4px; }
  .tl-empty p { font: var(--subhead); color: var(--label-2); margin: 0 auto 14px; max-width: 420px; }
  .tl-empty.loading { background: none; box-shadow: none; }
  .tl-state { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: var(--r-lg); background: var(--surface); box-shadow: var(--shadow-1);
    font: var(--subhead); color: var(--label-2); }
  .tl-state > svg { width: 20px; height: 20px; flex: none; color: var(--orange); }
  .tl-state.err { background: color-mix(in srgb, var(--red) 10%, var(--surface)); color: var(--label); }
  .tl-state.err > svg { color: var(--red); }
  .tl-state .grow { flex: 1; min-width: 0; }
  .tl-state.quiet { background: none; box-shadow: none; padding: 8px 16px; color: var(--label-3); }

  /* list header: title, end goal, progress */
  details.tl-list > summary { list-style: none; cursor: pointer; padding: 0 4px 0 16px; }
  details.tl-list > summary::-webkit-details-marker { display: none; }
  details.tl-list > summary:focus-visible { outline-offset: 4px; border-radius: var(--r); }
  .tl-titlebar { display: flex; align-items: center; gap: 8px; min-height: 32px; }
  .tl-titlebar h2 { flex: 1; min-width: 0; margin: 0; font: var(--title3); font-size: 20px; letter-spacing: -0.01em; color: var(--label); }
  .tl-list .chev { width: 13px; height: 13px; color: var(--label-3); flex: none; transition: transform var(--dur) var(--ease); }
  details.tl-list[open] .chev { transform: rotate(90deg); }
  .tl-list .acts { display: flex; gap: 2px; flex: none; align-items: center; }
  .tl-goal { margin: 4px 0 0; padding-left: 21px; max-width: 68ch; font: var(--subhead); color: var(--label-2); }
  .tl-prog { display: flex; align-items: center; gap: 12px; margin: 12px 0 0; padding-left: 21px; font: var(--footnote); color: var(--label-2); font-variant-numeric: tabular-nums; }
  .tl-prog .tl-bar { flex: 0 1 220px; height: 4px; border-radius: var(--r-pill); background: var(--fill); overflow: hidden; display: flex; }
  .tl-prog .tl-bar i { display: block; height: 100%; transition: width .4s var(--ease); }
  .tl-prog .tl-bar .d { background: var(--green); } .tl-prog .tl-bar .h { background: var(--blue); }
  .tl-prog b { font-weight: 600; color: var(--label); }
  .tl-body { margin-top: 18px; }

  /* filter: the app's segmented control */
  .tl-tools { display: flex; align-items: center; gap: 12px; margin: 0 0 22px; }
  .tl-tools .segmented button span { color: var(--label-3); margin-left: 4px; font-variant-numeric: tabular-nums; }

  /* sections: list-header + one grouped .list */
  .tl-sec { display: flex; align-items: baseline; gap: 8px; }
  .tl-sec .n { margin-left: auto; font-weight: 400; color: var(--label-3); font-variant-numeric: tabular-nums; }
  .tl-items { box-shadow: var(--shadow-1); margin-bottom: 26px; overflow: visible; }
  .tl-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 8px 12px 16px; position: relative; }
  .tl-item + .tl-item::before { content: ""; position: absolute; top: 0; left: 50px; right: 0; border-top: 1px solid var(--separator); }
  /* status: a Reminders-style circle */
  .tl-item .st { width: 22px; height: 22px; flex: none; margin-top: 0; padding: 0; border-radius: 50%; border: 1.5px solid var(--label-4); background: transparent;
    display: grid; place-items: center; color: #fff; cursor: pointer; transition: border-color var(--dur), background var(--dur); }
  .tl-item .st:hover { border-color: var(--label-3); background: transparent; }
  .tl-item .st svg { width: 13px; height: 13px; stroke-width: 2.6; }
  .tl-item.done .st { background: var(--green); border-color: var(--green); }
  .tl-item.have .st { background: var(--blue); border-color: var(--blue); }
  .tl-item.skip .st { border-style: dashed; color: var(--label-3); }
  .tl-item .txt { flex: 1; min-width: 0; }
  .tl-item .t { font: var(--body); line-height: 22px; color: var(--label); }
  .tl-item .t .num { font: var(--subhead); color: var(--label-3); font-variant-numeric: tabular-nums; margin-right: 6px; }
  .tl-item.done .t, .tl-item.have .t, .tl-item.skip .t { color: var(--label-2); }
  .tl-item.skip .t { text-decoration: line-through; text-decoration-color: var(--label-3); }
  .tl-item .d { font: var(--footnote); color: var(--label-2); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
  .tl-item .d.open { -webkit-line-clamp: unset; }
  /* meta line: a lesson badge (as in Recent lessons) and where your notes already cover it, as quiet text */
  .tl-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 6px; font: var(--footnote); color: var(--label-2); min-width: 0; }
  .tl-meta .badge { height: 18px; padding: 0 7px; font-size: 11.5px; }
  .tl-note { display: inline-flex; align-items: flex-start; gap: 5px; min-width: 0; }
  .tl-note svg { width: 13px; height: 13px; flex: none; margin-top: 2px; color: var(--c, var(--label-3)); }
  .tl-note.covered { --c: var(--blue); } .tl-note.partial { --c: var(--orange); }
  .tl-note .pct { color: var(--label-3); white-space: nowrap; }
  /* saved from a lesson (ui/teach.js "To Learn"): a link back to that lesson */
  .tl-origin { display: inline-flex; align-items: flex-start; gap: 5px; min-width: 0; padding: 0; border: 0; background: none; text-align: left;
    font: var(--footnote); color: var(--label-2); }
  button.tl-origin { cursor: pointer; }
  button.tl-origin:hover { color: var(--accent); }
  .tl-origin svg { width: 13px; height: 13px; flex: none; margin-top: 2px; color: var(--accent); }
  .tl-item.flash { animation: tl-flash 1.6s var(--ease); }
  @keyframes tl-flash { 0%, 40% { background: var(--accent-tint); } 100% { background: transparent; } }
  .tl-item .go { flex: none; display: flex; gap: 2px; align-items: center; margin-top: -3px; }
  .tl-item .go .btn svg { width: 15px; height: 15px; }
  .tl-item .go .btn-plain { padding: 0 8px; }
  .tl-more { width: 28px; height: 28px; }
  .tl-more svg { width: 17px; height: 17px; }
  .tl-item .tl-more { opacity: 0; transition: opacity var(--dur); }
  .tl-item:hover .tl-more, .tl-item .tl-more:focus-visible, .tl-item .tl-more[aria-expanded="true"] { opacity: 1; }
  @media (hover: none) { .tl-item .tl-more { opacity: 1; } }

  /* add row: the last row style of a grouped list */
  .tl-add { box-shadow: var(--shadow-1); }
  .tl-add label { display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 16px; min-height: 44px; cursor: text; }
  .tl-add .plus { width: 22px; height: 22px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--on-accent); }
  .tl-add .plus svg { width: 13px; height: 13px; stroke-width: 2.6; }
  .tl-add input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; padding: 6px 0; font: var(--body); color: var(--label); }
  .tl-add input::placeholder { color: var(--label-3); }
  .tl-add .btn { visibility: hidden; }
  .tl-add:focus-within .btn, .tl-add.typed .btn { visibility: visible; }

  /* popover menu: same look as the lesson menu in ui/teach.js (.tc-menu) */
  .tl-menu { position: fixed; min-width: 220px; padding: 6px; }
  .tl-mi { display: flex; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; height: 34px; padding: 0 10px; border: 0; border-radius: var(--r-xs);
    background: none; color: var(--label); font: 400 15px/1 var(--font); text-align: left; cursor: pointer; }
  .tl-mi svg { width: 17px; height: 17px; color: var(--label-2); }
  .tl-mi:hover, .tl-mi:focus-visible { background: var(--accent); color: var(--on-accent); outline: 0; }
  .tl-mi:hover svg, .tl-mi:focus-visible svg { color: var(--on-accent); }
  .tl-mi.danger, .tl-mi.danger svg { color: var(--red); }
  .tl-mi.danger:hover, .tl-mi.danger:focus-visible { background: var(--red); color: #fff; }
  .tl-mi.danger:hover svg, .tl-mi.danger:focus-visible svg { color: #fff; }
  .tl-menu-sep { height: 1px; background: var(--separator); margin: 5px 10px; }

  @media (max-width: 600px) {
    .tl { gap: 32px; }
    details.tl-list > summary { padding: 0 0 0 4px; }
    .tl-titlebar { align-items: flex-start; flex-wrap: wrap; }
    .tl-titlebar .chev { margin-top: 7px; }
    .tl-titlebar h2 { flex-basis: calc(100% - 21px); font-size: 19px; }
    .tl-list .acts { width: 100%; padding-left: 13px; margin-top: 4px; }
    .tl-prog { flex-wrap: wrap; gap: 8px; }
    .tl-prog .tl-bar { flex: 1 1 100%; }
    .tl-sec .n { padding-right: 0; }
    .tl-item { flex-wrap: wrap; padding-right: 12px; }
    .tl-item .txt { flex-basis: calc(100% - 34px); }
    .tl-item .go { width: 100%; padding-left: 28px; margin-top: 2px; }
    .tl-item .go .tl-more { margin-left: auto; }
  }
  `;
  document.head.appendChild(css);

  const box = () => Q.$('tab-tolearn');
  // Lists start open; only the ones you collapse are remembered.
  const closedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]')); } catch { return new Set(); } };
  function setOpen(id, on) {
    const s = closedSet();
    on ? s.delete(id) : s.add(id);
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify([...s])); } catch {}
  }
  const showOf = (id) => { try { return (JSON.parse(localStorage.getItem(SHOW_KEY) || '{}'))[id] || 'all'; } catch { return 'all'; } };
  function setShow(id, v) {
    try { const m = JSON.parse(localStorage.getItem(SHOW_KEY) || '{}'); m[id] = v; localStorage.setItem(SHOW_KEY, JSON.stringify(m)); } catch {}
  }

  async function load() {
    try {
      const d = await Q.api('api/tolearn');
      S.lists = d.lists; S.subjects = d.subjects; S.available = d.available;
    } catch (e) { S.lists = S.lists || []; Q.showToast(e.message); }
    render();
    schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(S.poll);
    if (S.lists && S.lists.some((l) => l.state === 'organizing') && Q.tab === 'tolearn') S.poll = setTimeout(load, 3000);
  }
  function replaceList(l) {
    const i = S.lists.findIndex((x) => x.id === l.id);
    if (i >= 0) S.lists[i] = l; else S.lists.unshift(l);
    render();
    schedulePoll();
  }
  async function call(path, body) {
    try { const l = await Q.api(path, body || {}); if (l && l.id) replaceList(l); return l; }
    catch (e) { Q.showToast(e.message); return null; }
  }

  // ---------- render ----------

  function render() {
    const el = box();
    if (!el) return;
    const keep = el.querySelector('.tl-compose');
    const draft = keep ? { title: keep.querySelector('input').value, text: keep.querySelector('textarea').value } : null;
    const lists = S.lists;
    const empty = lists && !lists.length && !S.compose;
    el.innerHTML = `<div class="tl">
      <div class="tl-top">${S.compose || empty || lists == null ? '' : `<button class="btn btn-tinted btn-pill" id="tlNew" type="button">${icon('plus')}New list</button>`}</div>
      ${S.compose ? composeHtml() : ''}
      ${!S.available ? `<div class="tl-state err">${icon('warning')}<div class="grow">The AI isn't available, so new lists can't be organized and lessons can't start.</div></div>` : ''}
      ${lists == null ? '<div class="tl-empty loading"><span class="activity"></span></div>'
        : empty ? `<div class="tl-empty"><div class="ic-tile">${icon('list')}</div><h3>No lists yet</h3>
            <p>Paste a list of things you want to learn, for example the answer an agent gave you to “what do I need to know to explain X?”.</p>
            <button class="btn btn-primary" id="tlNew" type="button">${icon('plus')}New list</button></div>`
        : lists.map(listHtml).join('')}
    </div>`;
    if (S.compose && draft) {
      const c = el.querySelector('.tl-compose');
      c.querySelector('input').value = draft.title; c.querySelector('textarea').value = draft.text;
    }
    wire(el);
    focusItem();
  }

  // Opened from a lesson's "Open" / "In To Learn": open that list, scroll to the item, flash it once.
  function focusItem() {
    const f = S.focus;
    const row = f && box().querySelector(`details.tl-list[data-list="${CSS.escape(f.listId)}"] .tl-item[data-item="${CSS.escape(f.itemId)}"]`);
    if (!row) return;
    S.focus = null;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('flash');
  }
  Q.toLearn = {
    show(listId, itemId) {
      setOpen(listId, true);
      if (showOf(listId) !== 'all') setShow(listId, 'all');
      S.focus = { listId, itemId };
      if (Q.tab === 'tolearn') load(); else Q.setTab('tolearn');   // the tab hook loads and renders
    },
  };

  function composeHtml() {
    return `<div class="tl-compose">
      <h3>New list</h3>
      <input class="field" id="tlTitle" type="text" placeholder="List name (optional, the AI names it otherwise)" maxlength="80">
      <textarea class="field" id="tlText" placeholder="Paste the list here: numbered items, sections, an agent's answer, anything. Duplicates are merged and items your notes already cover are marked."></textarea>
      <div class="tl-cbar">
        <span class="note">The AI splits it into lesson-sized items, keeps the order and checks your notes. Takes about a minute.</span>
        <button class="btn" id="tlCancel" type="button">Cancel</button>
        <button class="btn btn-primary" id="tlGo" type="button">${icon('sparkles')}Organize</button>
      </div>
    </div>`;
  }

  const nextItem = (l) => [...l.items].sort((a, b) => a.step - b.step).find((x) => x.status === 'todo');

  function listHtml(l) {
    const open = !closedSet().has(l.id) || l.state !== 'ready';
    const p = l.progress;
    const have = l.items.filter((x) => x.status === 'have').length;
    const done = l.items.filter((x) => x.status === 'done').length;
    const pct = (n) => (p.total ? (n / p.total) * 100 : 0);
    const nx = l.state === 'ready' && nextItem(l);
    return `<details class="tl-list" data-list="${esc(l.id)}" ${open ? 'open' : ''}>
      <summary>
        <div class="tl-titlebar">
          <span class="chev">${icon('chevron-right')}</span>
          <h2>${esc(l.title)}</h2>
          <div class="acts">
            ${nx ? `<button class="btn btn-tinted btn-sm" type="button" data-teach="${esc(nx.id)}" title="${esc(nx.title)}">${icon('teach')}${nx.lesson ? 'Continue' : 'Teach next'}</button>` : ''}
            <button class="icon-btn tl-more" type="button" data-list-menu aria-label="List options" aria-haspopup="menu">${icon('ellipsis')}</button>
          </div>
        </div>
        ${l.goal ? `<p class="tl-goal">${esc(l.goal)}</p>` : ''}
        ${l.state === 'ready' ? `<div class="tl-prog"><span class="tl-bar"><i class="d" style="width:${pct(done)}%"></i><i class="h" style="width:${pct(have)}%"></i></span>
          <span><b>${done}</b> learned · <b>${have}</b> already known · <b>${p.total - p.done}</b> to go</span></div>` : ''}
      </summary>
      <div class="tl-body">${bodyHtml(l)}</div>
    </details>`;
  }

  function bodyHtml(l) {
    if (l.state === 'organizing') return `<div class="tl-state"><span class="activity"></span><div class="grow">The AI is organizing this list and checking it against your notes…</div></div>`;
    if (l.state === 'error') return `<div class="tl-state err">${icon('warning')}<div class="grow">Couldn't organize this list: ${esc(l.error || 'unknown error')}</div><button class="btn btn-sm" type="button" data-retry>Try again</button></div>`;
    const show = showOf(l.id);
    const got = (x) => x.status === 'done' || x.status === 'have';
    const shown = l.items.filter((x) => show === 'all' || (show === 'todo' ? x.status === 'todo' : got(x)));
    const count = (f) => l.items.filter(f).length;
    let html = `<div class="tl-tools"><div class="segmented" role="group" aria-label="Show">
      ${[['all', 'All', l.items.length], ['todo', 'To learn', count((x) => x.status === 'todo')], ['got', 'Have', count(got)]]
        .map(([v, t, n]) => `<button type="button" data-show="${v}" aria-pressed="${show === v}">${t}<span>${n}</span></button>`).join('')}
    </div></div>`;
    let sec = null;
    let open = false;
    for (const it of shown) {
      if (it.section !== sec) {
        if (open) html += '</div>';
        sec = it.section;
        const all = l.items.filter((x) => x.section === sec);
        html += `<div class="list-header tl-sec"><span>${esc(sec)}</span><span class="n">${all.filter(got).length} of ${all.length}</span></div><div class="list tl-items">`;
        open = true;
      }
      html += itemHtml(it);
    }
    if (open) html += '</div>';
    if (!shown.length) html += `<div class="tl-state quiet">${show === 'todo' ? 'Nothing left to learn here.' : 'Nothing here yet.'}</div>`;
    html += `<div class="list tl-add"><label><span class="plus">${icon('plus')}</span><input type="text" placeholder="Add an item" maxlength="120" data-add aria-label="Add an item">
      <button class="btn btn-plain btn-sm" type="button" data-add-go>Add</button></label></div>`;
    return html;
  }

  const PHASE = { probe: 'Finding where you are', plan: 'Plan ready', teach: 'Teaching', done: 'Lesson done' };

  function itemHtml(it) {
    const meta = [];
    if (it.lesson) meta.push(`<span class="badge ${it.lesson.phase === 'done' ? 'green' : 'accent'}">${PHASE[it.lesson.phase] || it.lesson.phase}${it.lesson.busy ? '…' : ''}</span>`);
    if (it.have) {
      const m = it.have.mastery == null ? '' : ` <span class="pct">· ${it.have.mastery}% mastered</span>`;
      meta.push(`<span class="tl-note ${it.have.kind}" title="${esc(`${it.have.note}\n${it.have.why || ''}`)}">${icon('note')}<span>${it.have.kind === 'covered' ? 'In your notes' : 'Partly in'} “${esc(it.have.note.split(' - ')[0])}”${m}</span></span>`);
    }
    if (it.origin) {
      const o = it.origin;
      const tip = esc(o.quote ? `“${o.quote}”` : o.why || '');
      meta.push(o.lessonExists
        ? `<button type="button" class="tl-origin" data-origin="${esc(o.lessonId)}" title="${tip}">${icon('teach')}<span>From lesson: ${esc(o.lessonGoal)}</span></button>`
        : `<span class="tl-origin" title="${tip}">${icon('teach')}<span>From lesson: ${esc(o.lessonGoal)} (deleted)</span></span>`);
    }
    const mark = it.status === 'done' || it.status === 'have' ? icon('check') : it.status === 'skip' ? icon('minus') : '';
    const stTitle = { todo: 'Mark as learned', done: 'Learned (click to undo)', have: 'You already have this (click to undo)', skip: 'Skipped (click to undo)' }[it.status];
    let go = '';
    if (it.lesson && it.lesson.phase !== 'done') go = `<button class="btn btn-tinted btn-sm" type="button" data-open="${esc(it.lesson.id)}">${icon('play')}Continue</button>`;
    else if (it.status === 'todo') go = `<button class="btn btn-plain btn-sm" type="button" data-teach="${esc(it.id)}">${icon('teach')}Teach</button>`;
    else if (it.lesson) go = `<button class="btn btn-plain btn-sm" type="button" data-open="${esc(it.lesson.id)}">Lesson</button>`;
    return `<div class="tl-item ${it.status}" data-item="${esc(it.id)}">
      <button class="st" type="button" data-toggle title="${stTitle}" aria-label="${stTitle}">${mark}</button>
      <div class="txt">
        <div class="t"><span class="num">${it.step}</span>${esc(it.title)}</div>
        ${it.detail ? `<div class="d" data-more>${esc(it.detail)}</div>` : ''}
        ${meta.length ? `<div class="tl-meta">${meta.join('')}</div>` : ''}
      </div>
      <div class="go">${go}<button class="icon-btn tl-more" type="button" data-item-menu aria-label="Item options" aria-haspopup="menu">${icon('ellipsis')}</button></div>
    </div>`;
  }

  // ---------- actions ----------

  function wire(el) {
    const nb = el.querySelector('#tlNew');
    if (nb) nb.onclick = () => { S.compose = true; render(); el.querySelector('#tlText').focus(); };
    const c = el.querySelector('.tl-compose');
    if (c) {
      el.querySelector('#tlCancel').onclick = () => { S.compose = false; render(); };
      const go = async () => {
        const text = el.querySelector('#tlText').value.trim();
        if (!text) { el.querySelector('#tlText').focus(); return; }
        const b = el.querySelector('#tlGo'); b.disabled = true;
        const l = await call('api/tolearn/import', { text, title: el.querySelector('#tlTitle').value.trim() });
        if (l) { S.compose = false; setOpen(l.id, true); render(); } else b.disabled = false;
      };
      el.querySelector('#tlGo').onclick = go;
      el.querySelector('#tlText').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); go(); } });
    }
    for (const d of el.querySelectorAll('details.tl-list')) {
      const id = d.dataset.list;
      const l = S.lists.find((x) => x.id === id);
      d.addEventListener('toggle', () => setOpen(id, d.open));
      d.querySelector('summary').addEventListener('click', (e) => { if (e.target.closest('button')) e.preventDefault(); });
      d.querySelectorAll('[data-teach]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); teachItem(l, l.items.find((x) => x.id === b.dataset.teach)); }));
      d.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openLesson(b.dataset.open)));
      d.querySelectorAll('[data-origin]').forEach((b) => (b.onclick = () => openLesson(b.dataset.origin)));
      d.querySelector('[data-list-menu]').onclick = (e) => listMenu(e.currentTarget, l);
      const r = d.querySelector('[data-retry]');
      if (r) r.onclick = () => call(`api/tolearn/${id}/retry`);
      d.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => { setShow(id, b.dataset.show); render(); }));
      d.querySelectorAll('[data-more]').forEach((x) => (x.onclick = () => x.classList.toggle('open')));
      d.querySelectorAll('.tl-item').forEach((row) => {
        const it = l.items.find((x) => x.id === row.dataset.item);
        row.querySelector('[data-toggle]').onclick = () => setStatus(l, it, it.status === 'todo' ? 'done' : 'todo');
        row.querySelector('[data-item-menu]').onclick = (e) => itemMenu(e.currentTarget, l, it);
      });
      const add = d.querySelector('[data-add]');
      if (add) {
        const doAdd = () => { const t = add.value.trim(); if (t) call(`api/tolearn/${id}/add`, { title: t }); };
        d.querySelector('[data-add-go]').onclick = doAdd;
        add.addEventListener('input', () => add.closest('.tl-add').classList.toggle('typed', !!add.value.trim()));
        add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      }
    }
  }

  const setStatus = (l, it, status) => call(`api/tolearn/${l.id}/item/${it.id}`, { status });

  function teachItem(l, it) {
    if (!it) return;
    if (it.lesson && it.lesson.phase !== 'done') return openLesson(it.lesson.id);
    window.dispatchEvent(new CustomEvent('quiz:teach', { detail: {
      goal: it.title, subject: it.subject || null,
      noteTitle: it.have && it.have.isNote ? it.have.note : null,
      toLearn: { list: l.id, item: it.id },
    } }));
  }
  function openLesson(id) {
    if (!Q.teach) return;
    Q.setTab('teach');
    Q.teach.open(id);
  }

  // A popover menu next to the button that opened it (same look as the lesson menu in ui/teach.js).
  // A second click on the same button closes it.
  function menu(anchor, entries) {
    const again = S.menu && S.menu.anchor === anchor;
    closeMenu();
    if (again) return;
    const m = document.createElement('div');
    m.className = 'popover tl-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = entries.map((x, i) => (x === '-' ? '<div class="tl-menu-sep" role="separator"></div>'
      : `<button type="button" role="menuitem" data-i="${i}" class="tl-mi${x.danger ? ' danger' : ''}">${icon(x.icon)}<span>${esc(x.label)}</span></button>`)).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    m.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
    m.querySelectorAll('button').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeMenu(); entries[b.dataset.i].run(); }));
    anchor.setAttribute('aria-expanded', 'true');
    S.menu = { el: m, anchor };
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  function outside(e) { if (S.menu && !S.menu.el.contains(e.target) && !S.menu.anchor.contains(e.target)) closeMenu(); }
  function closeMenu() {
    if (S.menu) { S.menu.el.remove(); S.menu.anchor.setAttribute('aria-expanded', 'false'); }
    S.menu = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  // The app's text prompt (Quiz.promptText in index.html); falls back to the browser's if it's missing.
  const ask = (o) => (Q.promptText ? Q.promptText(o) : Promise.resolve(prompt(o.title, o.value || '')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.menu) closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);

  function itemMenu(anchor, l, it) {
    const e = [];
    if (it.status !== 'todo') e.push({ label: 'Back to “to learn”', icon: 'review', run: () => setStatus(l, it, 'todo') });
    if (it.status !== 'done') e.push({ label: 'Mark as learned', icon: 'check-circle', run: () => setStatus(l, it, 'done') });
    if (it.status !== 'have') e.push({ label: 'I already know this', icon: 'check', run: () => setStatus(l, it, 'have') });
    if (it.status !== 'skip') e.push({ label: 'Skip it', icon: 'minus-circle', run: () => setStatus(l, it, 'skip') });
    if (it.lesson && it.lesson.phase === 'done' && it.status === 'todo') e.push({ label: 'Open the lesson', icon: 'teach', run: () => openLesson(it.lesson.id) });
    if (it.lesson) e.push({ label: 'New lesson on this', icon: 'plus', run: () => teachItem(l, { ...it, lesson: null }) });
    e.push({ label: 'Rename', icon: 'pencil', run: async () => {
      const t = await ask({ title: 'Rename item', value: it.title, ok: 'Save', maxlength: 120 });
      if (t && t.trim() && t.trim() !== it.title) call(`api/tolearn/${l.id}/item/${it.id}`, { title: t.trim() });
    } });
    e.push('-', { label: 'Delete item', icon: 'trash', danger: true, run: () => call(`api/tolearn/${l.id}/item/${it.id}`, { delete: true }) });
    menu(anchor, e);
  }

  function listMenu(anchor, l) {
    menu(anchor, [
      { label: 'Rename list', icon: 'pencil', run: async () => {
        const t = await ask({ title: 'Rename list', value: l.title, ok: 'Save', maxlength: 80 });
        if (t && t.trim() && t.trim() !== l.title) call(`api/tolearn/${l.id}/update`, { title: t.trim() });
      } },
      { label: 'Edit end goal', icon: 'target', run: async () => {
        const t = await ask({ title: 'End goal', text: 'What should you be able to do or explain at the end of this list?', value: l.goal || '', ok: 'Save', multiline: true, allowEmpty: true });
        if (t !== null && t.trim() !== (l.goal || '')) call(`api/tolearn/${l.id}/update`, { goal: t.trim() });
      } },
      // A list saved from lessons has no pasted text to organize again.
      ...(l.kind === 'captures' ? [] : [{ label: 'Organize again', icon: 'refresh', run: async () => {
        if (await Q.confirm({ title: 'Organize this list again?', text: 'The AI rebuilds the items from the text you pasted. Your marks and lesson links on the current items are lost.', ok: 'Organize again', destructive: true })) call(`api/tolearn/${l.id}/retry`);
      } }]),
      '-',
      { label: 'Delete list', icon: 'trash', danger: true, run: async () => {
        if (!(await Q.confirm({ title: 'Delete this list?', text: `“${l.title}” and its items will be deleted. Lessons you started from it are kept.`, ok: 'Delete', destructive: true }))) return;
        try { await Q.api(`api/tolearn/${l.id}/delete`, {}); S.lists = S.lists.filter((x) => x.id !== l.id); render(); } catch (err) { Q.showToast(err.message); }
      } },
    ]);
  }

  Q.on('tab', (t) => { if (t === 'tolearn') load(); else { clearTimeout(S.poll); closeMenu(); } });
  if (Q.tab === 'tolearn') load();
})();
