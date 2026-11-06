// 📴 Offline practice: multiple choice with saved explanations. No AI, and it works with no connection.
// Server: offline.js. The app itself is kept on the device by the service worker (ui/sw.js).
//
// On this device (IndexedDB "quiz-offline", or memory if that's unavailable):
//   pack      the questions with options, misconceptions, explanations and reference answers
//   progress  Leitner boxes { id: { box, lastSeen } }, updated by every answer here, so due/weak
//             questions come first even offline
//   outbox    answers not yet sent to the server [{ uid, id, result: correct|wrong|idk, choiceText, at }]
// The outbox is sent whenever the server answers (on load, after each answer, when the phone comes
// back online, every minute while something waits). The server never counts one answer twice.
(() => {
  if (!window.Quiz) return;
  const Q = window.Quiz;
  const { esc } = Q;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const md = (s) => (Q.md ? Q.md(s || '') : esc(s || ''));

  const DAY = 864e5;
  const INTERVALS = [0, 10 * 60e3, DAY, 3 * DAY, 7 * DAY, 21 * DAY];   // as in server.js (the pack sends them too)
  const MAX_BOX = 5;
  const PACK_STALE_MS = 6 * 3600e3;   // refresh the pack in the background when it's older than this
  const S = { pack: null, progress: {}, outbox: [], online: null, run: null, prep: null, syncing: false, loading: true };

  // ---------- storage ----------

  const mem = {};
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((ok, fail) => {
      if (!window.indexedDB) return fail(new Error('no IndexedDB'));
      const r = indexedDB.open('quiz-offline', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    }).catch((e) => { console.warn('offline storage:', e.message); return null; });
    return dbp;
  }
  async function get(key) {
    const d = await db();
    if (!d) return mem[key];
    return new Promise((ok) => {
      try { const r = d.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => ok(r.result); r.onerror = () => ok(mem[key]); }
      catch { ok(mem[key]); }
    });
  }
  async function set(key, value) {
    mem[key] = value;
    const d = await db();
    if (!d) return;
    await new Promise((ok) => {
      try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = ok; t.onerror = ok; t.onabort = ok; }
      catch { ok(); }
    });
  }

  // ---------- network (always with a timeout: bad signal must not hang the page) ----------

  async function call(path, body, ms = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(path, { cache: 'no-store', signal: ctl.signal,
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `server said ${r.status}`);
      S.online = true;
      return data;
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) { S.online = false; throw new Error('no connection to the quiz server'); }
      throw e;
    } finally { clearTimeout(t); }
  }

  async function ping() {
    if (navigator.onLine === false) { S.online = false; return false; }
    try { await call('api/health', undefined, 4000); return true; } catch { return false; }
  }

  // ---------- sync and download ----------

  async function sync() {
    if (S.syncing || !S.outbox.length) return;
    S.syncing = true;
    try {
      const batch = S.outbox.slice(0, 200);
      const r = await call('api/offline/sync', { answers: batch }, 15000);
      const done = new Set(r.synced || []);
      S.outbox = S.outbox.filter((a) => !done.has(a.uid));
      await set('outbox', S.outbox);
      mergeProgress(r.progress || {});
      await set('progress', S.progress);
      if (S.outbox.length) setTimeout(sync, 500);
      else if (done.size && Q.loadTopics) Q.loadTopics();   // the sidebar's mastery counts moved
    } catch {} finally { S.syncing = false; paintStatus(); }
  }

  // The newer of the two wins (an answer made here and not synced yet is newer than the server's copy).
  function mergeProgress(server) {
    for (const [id, st] of Object.entries(server)) {
      const mine = S.progress[id];
      if (!mine || (st.lastSeen || 0) >= (mine.lastSeen || 0)) S.progress[id] = { box: st.box, lastSeen: st.lastSeen };
    }
  }

  async function download({ quiet = false } = {}) {
    try {
      await sync();
      const pack = await call('api/offline/pack', undefined, 30000);
      S.pack = { ...pack, downloadedAt: Date.now() };
      mergeProgress(pack.progress || {});
      await set('pack', S.pack);
      await set('progress', S.progress);
      if (!quiet) Q.showToast(`Saved ${pack.questions.length} questions on this device.`);
    } catch (e) {
      if (!quiet) Q.showToast(`Couldn't download the questions: ${e.message}`);
    }
    if (Q.tab === 'offline' && !S.run) render();
  }

  // ---------- preparing the rest (Claude on the server) ----------

  async function loadPrep() {
    try { S.prep = await call('api/offline/prepare', undefined, 8000); } catch { S.prep = null; }
    clearTimeout(S.prepTimer);
    if (S.prep && S.prep.running && Q.tab === 'offline') S.prepTimer = setTimeout(async () => {
      await loadPrep();
      // New questions are ready: refresh the pack every 20 written while it runs, and once at the end.
      const ready = S.prep ? S.prep.ready : 0;
      if (S.prep && S.pack && (ready - S.pack.questions.length >= 20 || (!S.prep.running && ready > S.pack.questions.length))) download({ quiet: true });
      else if (!S.run) render();
    }, 8000);
  }

  // ---------- picking ----------

  const isDue = (st, now) => !st || st.lastSeen + INTERVALS[Math.min(st.box, MAX_BOX)] <= now;

  // Seen-and-due first, then weak, then new, then the rest; a little shuffle inside each group.
  function pickQueue(subjects, count) {
    const now = Date.now();
    const pool = S.pack.questions.filter((q) => !subjects.length || subjects.includes(q.subject));
    const rank = (q) => {
      const st = S.progress[q.id];
      if (st && isDue(st, now)) return st.box;          // 0–5: due, weakest first
      if (!st) return 6;                                // new
      return 7 + st.box;                                // not due yet
    };
    const scored = pool.map((q) => ({ q, r: rank(q) + Math.random() * 0.9 }));
    scored.sort((a, b) => a.r - b.r);
    return scored.slice(0, count || scored.length).map((x) => x.q);
  }

  function counts(subjects) {
    const now = Date.now();
    const pool = (S.pack ? S.pack.questions : []).filter((q) => !subjects.length || subjects.includes(q.subject));
    let due = 0, weak = 0, fresh = 0;
    for (const q of pool) {
      const st = S.progress[q.id];
      if (!st) fresh++;
      else { if (isDue(st, now)) due++; if (st.box <= 1) weak++; }
    }
    return { total: pool.length, due, weak, fresh };
  }

  // ---------- styles ----------

  const css = document.createElement('style');
  css.textContent = `
  .off { display: flex; flex-direction: column; gap: 24px; max-width: var(--read-w); }
  .off-card { background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .off-card h3 { font: var(--headline); margin: 0; }
  .off-card p { font: var(--subhead); color: var(--label-2); margin: 0; }
  .off-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .off-row .grow { flex: 1 1 200px; min-width: 0; }
  .off-ic { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--fill); color: var(--label-2); flex: none; }
  .off-ic svg { width: 20px; height: 20px; }
  .off-ic.on { background: color-mix(in srgb, var(--green) 16%, transparent); color: var(--green); }
  .off-ic.off { background: color-mix(in srgb, var(--orange) 16%, transparent); color: var(--orange); }
  .off-line { font: var(--subhead); color: var(--label); }
  .off-sub { font: var(--footnote); color: var(--label-2); }
  .off-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .off-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: var(--r-pill); border: 0; cursor: pointer;
    background: var(--fill); color: var(--label); font: var(--subhead); }
  .off-chip[aria-pressed="true"] { background: var(--accent-tint); color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .off-chip small { color: var(--label-2); font: var(--footnote); }
  .off-chip[aria-pressed="true"] small { color: inherit; }
  .off-progress { height: 4px; border-radius: var(--r-pill); background: var(--fill); overflow: hidden; }
  .off-progress i { display: block; height: 100%; background: var(--accent); transition: width .4s var(--ease); }
  @media (pointer: coarse) { .off-chip { min-height: 44px; } }

  .offr { max-width: var(--read-w); margin: 0 auto; display: flex; flex-direction: column; gap: 16px; padding-bottom: 32px; }
  .offr-top { display: flex; align-items: center; gap: 10px; font: var(--footnote); color: var(--label-2); }
  .offr-top .grow { flex: 1; }
  .offr-top .off-progress { flex: 0 1 160px; }
  .offr-tag { font: var(--footnote); color: var(--label-2); }
  .offr-stem { font: var(--title3); margin: 0; }
  .offr-detail { font: var(--subhead); }
  .offr-opts { display: flex; flex-direction: column; gap: 8px; }
  .offr-opt { display: flex; gap: 12px; align-items: flex-start; width: 100%; min-height: 52px; padding: 14px 16px; border: 0; border-radius: var(--r-lg);
    background: var(--surface); box-shadow: var(--shadow-1); color: var(--label); font: var(--body); text-align: left; cursor: pointer; }
  .offr-opt:hover:not(:disabled) { background: var(--surface-3); }
  .offr-opt:disabled { cursor: default; color: var(--label); opacity: 1; }
  .offr-opt.idk:disabled { color: var(--label-2); }
  .offr-opt .k { flex: none; font: 500 12px/1 var(--font); color: var(--label-3); padding: 4px 6px; border-radius: 5px; background: var(--fill); margin-top: 3px; }
  .offr-opt .txt { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .offr-opt .why { display: block; margin-top: 6px; font: var(--footnote); color: var(--label-2); }
  .offr-opt.idk { background: transparent; box-shadow: inset 0 0 0 1px var(--separator); color: var(--label-2); }
  .offr-opt.right { background: color-mix(in srgb, var(--green) 13%, var(--surface)); box-shadow: inset 0 0 0 1.5px var(--green); }
  .offr-opt.wrong { background: color-mix(in srgb, var(--red) 10%, var(--surface)); box-shadow: inset 0 0 0 1.5px var(--red); }
  .offr-opt.dim { opacity: .75; }
  .offr-verdict { display: flex; align-items: center; gap: 8px; font: var(--title3); margin: 0; }
  .offr-verdict svg { width: 24px; height: 24px; }
  .offr-verdict.ok svg { color: var(--green); } .offr-verdict.no svg { color: var(--red); } .offr-verdict.idk svg { color: var(--label-3); }
  .offr-box { background: var(--surface-2); border-radius: var(--r); padding: 12px 14px; font: var(--subhead); }
  .offr-box b.lbl { display: block; font: var(--footnote); font-weight: 600; color: var(--label-2); margin-bottom: 4px; }
  .offr-box.bad { background: color-mix(in srgb, var(--red) 8%, var(--surface-2)); }
  .offr-box.good { background: color-mix(in srgb, var(--green) 9%, var(--surface-2)); }
  .offr details summary { cursor: pointer; font: var(--subhead); color: var(--accent); padding: 4px 0; }
  .offr-next { display: flex; justify-content: flex-end; gap: 8px; position: sticky; bottom: 12px; }
  #offAfter { scroll-margin-bottom: 90px; }
  .offr-more { display: flex; flex-direction: column; gap: 10px; }
  .offr-more > summary { list-style: none; }
  .offr-more > summary::-webkit-details-marker { display: none; }
  .offr-more[open] { display: flex; }
  .offr-more > :not(summary) { margin: 0; }
  @media (max-width: 700px) {
    .offr { gap: 12px; padding-bottom: 0; }
    .offr-stem { font-size: 20px; line-height: 26px; }
    .offr-opts { gap: 6px; }
    .offr-opt { min-height: 48px; padding: 12px 14px; }
    /* Next pinned at the bottom edge, full width, like an app's primary action */
    .offr-next { bottom: 0; margin: 0 -16px; padding: 10px 16px max(12px, env(safe-area-inset-bottom));
      background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); box-shadow: 0 -1px 0 var(--separator); }
    .offr-next .btn { flex: 1; }
  }
  @media (hover: none) and (pointer: coarse) { .offr-opt .k { display: none; } }
  .offr-sum { font: var(--large-title); margin: 0; }
  body.offline-run .tabbar { display: none; }
  body.offline-run .main { padding-bottom: 0 !important; }
  `;
  document.head.appendChild(css);

  // ---------- the tab ----------

  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60e3);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  };

  const chosen = () => { try { return JSON.parse(localStorage.getItem('offline.subjects') || '[]'); } catch { return []; } };
  const setChosen = (a) => { try { localStorage.setItem('offline.subjects', JSON.stringify(a)); } catch {} };
  const chosenCount = () => { try { return localStorage.getItem('offline.count') || '10'; } catch { return '10'; } };

  function statusHtml() {
    const on = S.online;
    const waiting = S.outbox.length;
    const p = S.pack;
    return `<div class="off-card" id="offStatus">
      <div class="off-row">
        <span class="off-ic ${on ? 'on' : on === false ? 'off' : ''}">${icon(on === false ? 'offline' : 'check-circle')}</span>
        <div class="grow">
          <div class="off-line">${p ? `${p.questions.length} questions on this device` : 'Nothing on this device yet'}${p ? ` <span class="off-sub">· updated ${ago(p.downloadedAt)}</span>` : ''}</div>
          <div class="off-sub">${on === false ? 'Offline: practice works, answers wait here and sync when you’re back.' : on ? 'Connected to the quiz server.' : 'Checking the connection…'}
            ${waiting ? ` <b>${waiting} answer${waiting === 1 ? '' : 's'} waiting to sync.</b>` : p ? ' All answers synced.' : ''}</div>
        </div>
        ${on ? `<button class="btn btn-sm" data-a="download" type="button">${icon(p ? 'refresh' : 'download')}${p ? 'Update' : 'Download'}</button>` : ''}
        ${on && waiting ? `<button class="btn btn-sm btn-tinted" data-a="sync" type="button">Sync now</button>` : ''}
      </div>
    </div>`;
  }

  function prepHtml() {
    const pr = S.prep;
    if (!S.online || !pr || (!pr.missing && !pr.running)) return '';
    if (pr.running) {
      const pct = pr.todo ? Math.round((pr.done / pr.todo) * 100) : 0;
      return `<div class="off-card">
        <div class="off-row"><span class="off-ic">${icon('sparkles')}</span>
          <div class="grow"><div class="off-line">The AI is writing multiple choice: ${pr.done} of ${pr.todo}</div>
          <div class="off-sub">${pr.ready} of ${pr.total} questions ready. It keeps going if you close the app${pr.failed.length ? ` · ${pr.failed.length} failed (they're tried again next time)` : ''}.</div></div>
          <button class="btn btn-sm" data-a="prep-stop" type="button">Stop</button></div>
        <div class="off-progress"><i style="width:${pct}%"></i></div>
      </div>`;
    }
    return `<div class="off-card">
      <div class="off-row"><span class="off-ic">${icon('sparkles')}</span>
        <div class="grow"><div class="off-line">${pr.ready} of ${pr.total} questions have multiple choice</div>
        <div class="off-sub">The AI can write the other ${pr.missing} on the server, in the background: options built from common mistakes, plus why each one is wrong. About a minute each, two at a time, on your AI plan. A quiz you're taking always goes first.</div></div>
        <button class="btn btn-sm btn-tinted" data-a="prep" type="button" ${pr.claude ? '' : 'disabled title="claude CLI not found on the server"'}>Prepare the rest</button></div>
    </div>`;
  }

  function startHtml() {
    const p = S.pack;
    if (!p || !p.questions.length) {
      return `<div class="off-card"><h3>${p ? 'No questions with multiple choice yet' : 'Save questions on this device'}</h3>
        <p>${p ? 'Prepare them above, then update.' : S.online === false ? 'Connect once to download them. After that, practice works with no connection.' : 'Download the questions that have multiple choice. After that, practice works with no connection.'}</p></div>`;
    }
    const subjects = [...new Set(p.questions.map((q) => q.subject))].sort();
    const picked = chosen().filter((s) => subjects.includes(s));
    const c = counts(picked);
    const n = chosenCount();
    return `<div class="off-card">
      <h3>Practice</h3>
      <div class="off-chips" id="offSubjects">
        <button type="button" class="off-chip" data-s="" aria-pressed="${!picked.length}">All subjects</button>
        ${subjects.map((s) => `<button type="button" class="off-chip" data-s="${esc(s)}" aria-pressed="${picked.includes(s)}">${esc(s)} <small>${p.questions.filter((q) => q.subject === s).length}</small></button>`).join('')}
      </div>
      <div class="off-row">
        <div class="segmented" id="offCount">${['10', '20', 'all'].map((v) => `<button type="button" data-v="${v}" aria-pressed="${n === v}">${v === 'all' ? 'All' : v}</button>`).join('')}</div>
        <span class="grow off-sub">${c.total} questions · ${c.due} due · ${c.weak} weak · ${c.fresh} new</span>
        <button class="btn btn-primary" data-a="start" type="button" ${c.total ? '' : 'disabled'}>${icon('play')}Start</button>
      </div>
      <p class="off-sub">Pick an answer and see at once why it's right or wrong. Right = Good, wrong or “I don't know” = Again, same as the quiz.</p>
    </div>`;
  }

  function render() {
    const box = Q.$('tab-offline');
    if (!box || S.run) return;
    if (S.loading) { box.innerHTML = '<div class="off"><div class="off-card"><p>Loading…</p></div></div>'; return; }
    box.innerHTML = `<div class="off">${statusHtml()}${prepHtml()}${startHtml()}</div>`;
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((b) => (b.onclick = fn));
    on('[data-a=download]', async (e) => { e.currentTarget.disabled = true; await download(); });
    on('[data-a=sync]', async (e) => { e.currentTarget.disabled = true; await sync(); render(); });
    on('[data-a=prep]', async (e) => {
      e.currentTarget.disabled = true;
      try { S.prep = await call('api/offline/prepare', { action: 'start' }); } catch (err) { Q.showToast(err.message); }
      await loadPrep(); render();
    });
    on('[data-a=prep-stop]', async (e) => {
      e.currentTarget.disabled = true;
      try { S.prep = await call('api/offline/prepare', { action: 'stop' }); } catch (err) { Q.showToast(err.message); }
      render();
    });
    on('#offSubjects .off-chip', (e) => {
      const s = e.currentTarget.dataset.s;
      let cur = chosen();
      cur = !s ? [] : cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
      setChosen(cur); render();
    });
    on('#offCount button', (e) => { try { localStorage.setItem('offline.count', e.currentTarget.dataset.v); } catch {} render(); });
    on('[data-a=start]', () => startRun());
  }

  function paintStatus() {
    if (Q.tab === 'offline' && !S.run) render();
  }

  // ---------- a run ----------

  function startRun() {
    const subjects = chosen();
    const n = chosenCount();
    const queue = pickQueue(subjects, n === 'all' ? 0 : Number(n));
    if (!queue.length) return;
    S.run = { queue, i: 0, results: [], requeued: new Set(), picked: null };
    document.body.classList.add('offline-run');
    S.screen = Q.enterScreen();
    showQuestion();
  }

  function endRun() {
    S.run = null;
    document.body.classList.remove('offline-run');
    document.removeEventListener('keydown', onKey);
    if (!Q.$('moduleScreen').classList.contains('hidden')) Q.exitScreen();
    render();
  }

  function shuffled(a) {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  function topBar() {
    const r = S.run;
    const pct = Math.round((r.i / r.queue.length) * 100);
    return `<div class="offr-top"><span>${icon('offline')}</span><span>${Math.min(r.i + 1, r.queue.length)} of ${r.queue.length}</span>
      <span class="grow"></span><div class="off-progress"><i style="width:${pct}%"></i></div>
      <button class="btn btn-sm btn-plain" data-a="end" type="button">End</button></div>`;
  }

  function showQuestion() {
    const r = S.run;
    if (r.i >= r.queue.length) return showSummary();
    const q = r.queue[r.i];
    r.options = shuffled(q.options);
    r.picked = null;
    const keys = 'ABCDEF';
    S.screen.innerHTML = `<div class="offr">
      ${topBar()}
      <div class="offr-tag">${esc(q.subject)} · ${esc(q.topic)}</div>
      <h2 class="offr-stem">${esc(q.question)}</h2>
      ${q.detail ? `<div class="offr-detail prose">${md(q.detail)}</div>` : ''}
      <div class="offr-opts">
        ${r.options.map((o, i) => `<button class="offr-opt" type="button" data-i="${i}"><span class="k">${keys[i]}</span><span class="txt">${Q.inline ? Q.inline(o.text) : esc(o.text)}</span></button>`).join('')}
        <button class="offr-opt idk" type="button" data-i="idk"><span class="k">?</span><span class="txt">I don't know</span></button>
      </div>
      <div id="offAfter"></div>
    </div>`;
    S.screen.querySelector('[data-a=end]').onclick = () => (r.results.length ? showSummary() : endRun());
    S.screen.querySelectorAll('.offr-opt').forEach((b) => (b.onclick = () => pick(b.dataset.i)));
    document.removeEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    window.scrollTo(0, 0);
  }

  function onKey(e) {
    if (!S.run || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const r = S.run;
    if (r.picked === null) {
      const k = e.key.toUpperCase();
      const i = 'ABCDEF'.indexOf(k) >= 0 ? 'ABCDEF'.indexOf(k) : /^[1-6]$/.test(k) ? Number(k) - 1 : -1;
      if (i >= 0 && i < r.options.length) { e.preventDefault(); pick(String(i)); }
      else if (k === '?' || k === '0') { e.preventDefault(); pick('idk'); }
    } else if (e.key === 'Enter') { e.preventDefault(); next(); }
  }

  async function pick(i) {
    const r = S.run;
    if (!r || r.picked !== null) return;
    r.picked = i;
    const q = r.queue[r.i];
    const chosenOpt = i === 'idk' ? null : r.options[Number(i)];
    const result = !chosenOpt ? 'idk' : chosenOpt.correct ? 'correct' : 'wrong';
    const right = r.options.find((o) => o.correct);

    // Mark the options: the right one green, a wrong pick red, each wrong option with the idea behind it.
    S.screen.querySelectorAll('.offr-opt').forEach((b) => {
      b.disabled = true;
      if (b.dataset.i === 'idk') { if (result !== 'idk') b.classList.add('dim'); return; }
      const o = r.options[Number(b.dataset.i)];
      if (o.correct) b.classList.add('right');
      else if (b.dataset.i === i) b.classList.add('wrong');
      else b.classList.add('dim');
      // A wrong pick shows the mix-up behind it right where you tapped; the other traps wait under "More".
      if (!o.correct && o.misconception && b.dataset.i === i) {
        b.querySelector('.txt').insertAdjacentHTML('beforeend', `<span class="why">Trap: ${esc(o.misconception)}</span>`);
      }
    });

    const verdict = result === 'correct' ? ['ok', 'check-circle', 'Right']
      : result === 'wrong' ? ['no', 'x-circle', 'Not quite'] : ['idk', 'question', 'Here’s the answer'];
    const others = r.options.filter((o) => !o.correct && o !== chosenOpt && o.misconception);
    const why = q.explanation ? `<div class="offr-box good"><b class="lbl">Why</b>${esc(q.explanation)}</div>` : '';
    // Right: only the verdict, the rest on request. Wrong or "I don't know": why, up front. Short either way.
    Q.$('offAfter').innerHTML = `
      <p class="offr-verdict ${verdict[0]}">${icon(verdict[1])}${verdict[2]}</p>
      ${result === 'correct' ? '' : why}
      <details class="offr-more"><summary>${result === 'correct' ? 'Why it’s right' : 'More'}</summary>
        ${result === 'correct' ? why : ''}
        ${others.length ? `<div class="offr-box">${others.map((o) => `<p style="margin:0 0 8px"><b>${Q.inline ? Q.inline(o.text) : esc(o.text)}</b><br><span class="off-sub">Trap: ${esc(o.misconception)}</span></p>`).join('')}</div>` : ''}
        <div class="offr-box prose"><b class="lbl">Reference answer</b>${md(q.answer)}</div>
      </details>
      <div class="offr-next"><button class="btn btn-primary btn-lg" type="button" id="offNext">${r.i + 1 >= r.queue.length ? 'See results' : 'Next'} <kbd>↩</kbd></button></div>`;
    Q.$('offNext').onclick = next;
    // A miss: bring the "why" into view above the Next bar.
    if (result !== 'correct') requestAnimationFrame(() => Q.$('offAfter').scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

    // Spaced repetition here at once (so picking adapts offline), and queued for the server.
    const st = S.progress[q.id] || { box: 0, lastSeen: 0 };
    st.box = result === 'correct' ? Math.min(MAX_BOX, st.box + 1) : 0;
    st.lastSeen = Date.now();
    S.progress[q.id] = st;
    const uid = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^\w-]/g, '');
    S.outbox.push({ uid, id: q.id, result, choiceText: chosenOpt ? chosenOpt.text : '', at: Date.now() });
    r.results.push({ q, result });
    // A miss comes back once at the end of this run.
    if (result !== 'correct' && !r.requeued.has(q.id) && r.queue.length - r.i > 2) { r.requeued.add(q.id); r.queue.push(q); }
    await set('progress', S.progress);
    await set('outbox', S.outbox);
    sync();
  }

  function next() {
    if (!S.run || S.run.picked === null) return;
    S.run.i++;
    showQuestion();
  }

  function showSummary() {
    const r = S.run;
    const firstTry = new Map();
    for (const x of r.results) if (!firstTry.has(x.q.id)) firstTry.set(x.q.id, x);
    const list = [...firstTry.values()];
    const right = list.filter((x) => x.result === 'correct').length;
    const missed = list.filter((x) => x.result !== 'correct');
    document.removeEventListener('keydown', onKey);
    S.screen.innerHTML = `<div class="offr">
      <div class="offr-top"><span>${icon('offline')}</span><span>Offline practice</span></div>
      <p class="offr-sum">${right} of ${list.length} right</p>
      <p class="off-sub">${S.outbox.length ? `${S.outbox.length} answer${S.outbox.length === 1 ? '' : 's'} will sync when the server is reachable.` : 'All answers are saved on the server.'}</p>
      ${missed.length ? `<div class="list">${missed.map((x) => `<div class="list-row"><span class="grow">${esc(x.q.question)}<div class="off-sub">${esc(x.q.topic)}</div></span></div>`).join('')}</div>` : ''}
      <div class="offr-next"><button class="btn btn-lg" type="button" data-a="again">Practice again</button><button class="btn btn-primary btn-lg" type="button" data-a="done">Done</button></div>
    </div>`;
    S.screen.querySelector('[data-a=done]').onclick = endRun;
    S.screen.querySelector('[data-a=again]').onclick = () => { endRun(); startRun(); };
  }

  // ---------- wiring ----------

  Q.on('tab', (t) => {
    if (t === 'offline') { if (!S.run) { render(); refresh(); } }
    else if (S.run) { S.run = null; document.body.classList.remove('offline-run'); document.removeEventListener('keydown', onKey); }
    if (t !== 'offline') clearTimeout(S.prepTimer);
  });

  // Online again (or the tab opened): sync what waits, check preparing, refresh an old pack.
  async function refresh() {
    const ok = await ping();
    if (ok) {
      await sync();
      await loadPrep();
      if (!S.pack || Date.now() - (S.pack.downloadedAt || 0) > PACK_STALE_MS) await download({ quiet: !!S.pack });
    }
    if (Q.tab === 'offline' && !S.run) render();
  }

  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => { S.online = false; paintStatus(); });
  setInterval(() => { if (S.outbox.length) sync(); }, 60e3);
  window.Quiz.offline = { download, sync, get state() { return S; } };

  (async () => {
    S.pack = (await get('pack')) || null;
    S.progress = (await get('progress')) || {};
    S.outbox = (await get('outbox')) || [];
    S.loading = false;
    if (Q.tab === 'offline') render();
    const ok = await ping();
    // Opened with no connection (the app came from the device's copy): go straight to offline practice.
    if (!ok && Q.tab === 'home') {
      Q.setTab('offline');
      Q.showToast('No connection to the quiz server. Offline practice works without one.');
    }
    if (ok) {
      await sync();
      // Keep a pack on the device once it has been downloaded; refresh it when it's old.
      if (S.pack && Date.now() - (S.pack.downloadedAt || 0) > PACK_STALE_MS) download({ quiet: true });
    }
    if (Q.tab === 'offline') { render(); if (ok) loadPrep().then(() => Q.tab === 'offline' && !S.run && render()); }
  })();
})();
