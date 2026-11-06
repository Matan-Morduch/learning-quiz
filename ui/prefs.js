// App preferences in the browser: Quiz.prefs (also window.QuizPrefs, since index.html rebuilds window.Quiz).
// Loaded in <head> right after icons.js, so the look (theme, accent, text size, density, motion) is applied
// before the first paint from the last copy in localStorage; the server copy (GET api/prefs) then refreshes it.
//
//   Quiz.prefs.get('voice.speed')          current value (after the first load every key is present)
//   Quiz.prefs.ready                       resolves once the server copy arrived
//   await Quiz.prefs.set({ 'look.theme': 'dark' })
//   Quiz.prefs.on((prefs, changedKeys) => …)  also fired as window event 'quiz:prefs' {detail: {prefs, changed}}
//   Quiz.prefs.isDark()                    the effective theme (setting, else the system)
//   window event 'quiz:theme' {detail: {dark}} when the effective theme flips
// Server: prefs.js (schema and defaults live there).
(() => {
  const LS = 'quizPrefs';
  const root = document.documentElement;
  let prefs = {};
  let defaults = {};
  try { const c = JSON.parse(localStorage.getItem(LS) || 'null'); if (c && c.prefs) { prefs = c.prefs; defaults = c.defaults || {}; } } catch {}
  const subs = [];
  const sysDark = matchMedia('(prefers-color-scheme: dark)');
  let wasDark = null;

  const isDark = () => {
    const t = prefs['look.theme'];
    return t === 'dark' ? true : t === 'light' ? false : sysDark.matches;
  };

  function apply() {
    const t = prefs['look.theme'];
    if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
    const a = prefs['look.accent'];
    if (a && a !== 'blue') root.dataset.accent = a; else delete root.dataset.accent;
    const ts = prefs['look.textSize'];
    if (ts && ts !== 'default') root.dataset.text = ts; else delete root.dataset.text;
    if (prefs['look.density'] === 'compact') root.dataset.density = 'compact'; else delete root.dataset.density;
    const m = prefs['look.motion'];
    if (m === 'full' || m === 'reduced') root.dataset.motion = m; else delete root.dataset.motion;
    // Sidebar on load: index.html reads localStorage.sideCollapsed after this runs.
    const sb = prefs['look.sidebar'];
    try { if (sb === 'open') localStorage.setItem('sideCollapsed', '0'); else if (sb === 'closed') localStorage.setItem('sideCollapsed', '1'); } catch {}
    const d = isDark();
    // Home-screen app status bar / browser chrome: the window colour of the effective theme (index.html has the metas).
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = d ? '#000000' : '#f5f5f7';
    if (wasDark !== null && d !== wasDark) window.dispatchEvent(new CustomEvent('quiz:theme', { detail: { dark: d } }));
    wasDark = d;
  }

  function update(next, defs) {
    const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(prefs[k]));
    prefs = { ...next };
    if (defs) defaults = defs;
    try { localStorage.setItem(LS, JSON.stringify({ prefs, defaults })); } catch {}
    apply();
    if (!changed.length) return;
    for (const fn of subs) { try { fn({ ...prefs }, changed); } catch (e) { console.error('[prefs]', e); } }
    window.dispatchEvent(new CustomEvent('quiz:prefs', { detail: { prefs: { ...prefs }, changed } }));
  }

  const H = { 'Content-Type': 'application/json', 'x-quiz-settings': '1' };
  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  const P = {
    get: (k, fallback) => (k in prefs ? prefs[k] : k in defaults ? defaults[k] : fallback),
    all: () => ({ ...prefs }),
    defaults: () => ({ ...defaults }),
    schema: null,
    isDark,
    on(fn) { subs.push(fn); },
    async set(patch) { const j = await post('api/prefs', { patch }); update(j.prefs); return j.prefs; },
    async reset(keys) { const j = await post('api/prefs/reset', { keys }); update(j.prefs); return j.prefs; },
    async reload() {
      const j = await (await fetch('api/prefs')).json();
      P.schema = j.schema;
      update(j.prefs, j.defaults);
      return j.prefs;
    },
  };
  apply();
  P.ready = P.reload().catch((e) => { console.warn('[prefs] load failed', e); return prefs; });
  sysDark.addEventListener('change', apply);

  window.QuizPrefs = P;
  window.Quiz = window.Quiz || {};
  window.Quiz.prefs = P;
})();
