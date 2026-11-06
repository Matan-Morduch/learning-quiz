// Excalidraw canvas: plays a board answer ({title, steps:[{say, draw:[ops]}]}, see ../board.js)
// on a live Excalidraw scene, step by step, and lets the learner draw on the same canvas.
//
//   const api = Quiz.canvas.mount(host, { board, theme: 'auto', font, onChange, learner })
//     (minRows: fit at least this many grid rows, e.g. for a live board that grows while it's drawn)
//     theme 'auto' follows the app (Quiz.prefs.isDark(), events quiz:theme / <html data-theme>), else the system.
//     font 'hand' (Excalifont, rough) | 'clean' (Nunito, straight lines); default the boards.font pref, applied live.
//   await api.ready; api.play(board); await api.goTo(k, { animate, pace }) (resolves when step k is drawn;
//     pace 'voice' (default) | 'fast' (~3× quicker animation) | 'instant' (no animation)); api.next(); api.prev()
//   api.learnerElements() → what the learner drew (pass back as `learner` to restore it in a new mount)
//   api.describe() → compact JSON of the scene for the teacher (who drew what, where, arrows)
//   await api.snapshotPng() → PNG Blob (for freehand drawings the JSON can't capture)
//   api.dispose()
//
// Excalidraw (+ React) is vendored as ES modules in ui/vendor/excalidraw/ (tools/build-excalidraw.sh)
// and loaded on first mount. Teacher elements carry customData {by:'teacher', id: <board id>};
// anything else on the canvas is the learner's. Teacher elements are re-laid out from the board
// on every step (the board is the source of truth); the learner's elements are never touched.
(function () {
  const Q = (window.Quiz = window.Quiz || {});
  const BASE = new URL('.', (document.currentScript && document.currentScript.src) || location.href);
  const VENDOR = new URL('vendor/excalidraw/', BASE).href;

  // ---------- loading ----------
  let libP = null;
  function load() {
    if (libP) return libP;
    window.EXCALIDRAW_ASSET_PATH = VENDOR;   // fonts/<Family>/… are served from here, never a CDN
    if (!document.querySelector('link[data-excalidraw]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = VENDOR + 'excalidraw.css'; l.dataset.excalidraw = '';
      document.head.appendChild(l);
    }
    libP = import(VENDOR + 'excalidraw.js');
    return libP;
  }

  // ---------- geometry (same grid as ui/board.js: 1 unit = 100 px) ----------
  const U = 100, COLS = 12;
  const S = { head: 0.56, row: 0.42, pad: 0.14, code: 0.36, text: 0.34 };
  const STAGGER = 380, FADE = 420, GROW = 520;

  // Light-mode colours (Excalidraw's own palette); Excalidraw's dark theme inverts the canvas,
  // so these turn into matching dark colours by themselves.
  const TONES = {
    gray: ['#495057', '#f8f9fa'], blue: ['#1971c2', '#e7f5ff'], green: ['#2f9e44', '#ebfbee'],
    orange: ['#e8590c', '#fff4e6'], red: ['#e03131', '#fff5f5'], purple: ['#6741d9', '#f3f0ff'], teal: ['#0c8599', '#e3fafc'],
  };
  const tone = (t) => TONES[t] || TONES.gray;
  const INK = '#1e1e1e', MUTED = '#868e96', CODE_BG = '#f1f3f5', HL = '#ffec99', HL_BAR = '#f08c00', FLASH = '#ffd43b', MARK = '#f08c00';

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r1 = (n) => Math.round(n * 10) / 10;
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 2147483647 || 1; };
  const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const reduced = () => { const m = document.documentElement.dataset.motion; return m === 'reduced' ? true : m === 'full' ? false : matchMedia('(prefers-reduced-motion: reduce)').matches; };
  const PREFS = () => window.QuizPrefs || (window.Quiz && window.Quiz.prefs) || null;
  const prefFont = () => { const p = PREFS(); return p && p.get('boards.font') === 'clean' ? 'clean' : 'hand'; };

  // The board after step k: elements, code highlights, and what step k itself did (from ui/board.js).
  function sceneAt(b, k) {
    const els = new Map(), lines = {};
    let now = { added: [], marks: new Set(), changed: new Set() };
    for (let i = 0; i <= k && i < b.steps.length; i++) {
      now = { added: [], marks: new Set(), changed: new Set() };
      for (const o of b.steps[i].draw) {
        if (o.op === 'set') {
          const e = els.get(o.id);
          if (!e) continue;
          if (e.op === 'table') { e.rows[o.row][o.col] = o.value; now.changed.add(`${o.id}:${o.row}:${o.col}`); }
          else { e.rows = e.rows || []; e.rows[o.row] = o.value; if (o.h) e.h = o.h; now.changed.add(`${o.id}:${o.row}`); }
        } else if (o.op === 'mark') {
          if (o.line) { lines[o.id] = o.line; now.changed.add(`${o.id}:L`); } else now.marks.add(o.id);
        } else if (o.op === 'remove') {
          els.delete(o.id);
          for (const [id, e] of els) if (e.op === 'arrow' && (e.from === o.id || e.to === o.id)) els.delete(id);
        } else {
          els.set(o.id, clone(o));
          now.added.push(o.id);
        }
      }
    }
    return { els, lines, ...now };
  }
  function boardHeight(b) {
    let h = 3;
    for (let k = 0; k < b.steps.length; k++) for (const e of sceneAt(b, k).els.values()) if (e.y !== undefined) h = Math.max(h, e.y + e.h);
    return h;
  }

  // Where a line from rect a's centre toward b's centre leaves a (plus a gap).
  function edge(a, b, gap) {
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy;
    const t = Math.min(dx ? (a.w / 2) / Math.abs(dx) : Infinity, dy ? (a.h / 2) / Math.abs(dy) : Infinity);
    const len = Math.hypot(dx, dy) || 1;
    return { x: cx + dx * t + (dx / len) * gap, y: cy + dy * t + (dy / len) * gap };
  }

  // ---------- board ops → Excalidraw element skeletons ----------
  // Every skeleton gets a stable id (so rough shapes keep their seed and the learner's arrows stay
  // bound across steps) and customData {by:'teacher', id, part}.
  // font 'clean': Nunito and straight lines (roughness 0) instead of the hand-drawn Excalifont.
  function skeletons(sc, F, prevLines, font) {
    const out = [];
    const clean = font === 'clean';
    const FACE = clean ? F.Nunito : F.Excalifont;
    const add = (opId, part, s) => { s.customData = { by: 'teacher', id: opId, part }; out.push(s); return s; };
    const base = { roughness: clean ? 0 : 1, strokeWidth: 2, fillStyle: 'solid', opacity: 100 };
    const ghost = { ...base, strokeColor: 'transparent', backgroundColor: 'transparent', strokeWidth: 1, roughness: 0 };
    const line = (opId, id, x1, y1, x2, y2, color, opacity = 100, width = 1) =>
      add(opId, 'rule', { type: 'line', id, x: x1, y: y1, points: [[0, 0], [x2 - x1, y2 - y1]], strokeColor: color, strokeWidth: width, roughness: 0, opacity });
    const label = (text, extra) => ({ text: String(text ?? ''), fontFamily: FACE, fontSize: 20, strokeColor: INK, ...extra });

    for (const e of sc.els.values()) {
      if (e.op === 'arrow') continue;
      const x = e.x * U, y = e.y * U, w = e.w * U, h = e.h * U;
      const [ink, paper] = tone(e.tone);
      const id = e.id;
      if (e.op === 'box') {
        const rows = e.rows || [];
        if (!rows.length) {
          add(id, 'shape', { type: 'rectangle', id, x, y, width: w, height: h, ...base, strokeColor: ink, backgroundColor: paper, roundness: { type: 3 },
            label: label(e.label, { fontSize: 22 }) });
        } else {
          add(id, 'shape', { type: 'rectangle', id, x, y, width: w, height: h, ...base, strokeColor: ink, backgroundColor: paper, roundness: { type: 3 } });
          const top = (e.label ? S.head : S.pad) * U;
          if (e.label) {
            add(id, 'head', { type: 'rectangle', id: `${id}~head`, x: x + 6, y: y + 4, width: w - 12, height: top - 6, ...ghost, label: label(e.label, { fontSize: 22, strokeColor: ink }) });
            line(id, `${id}~hr`, x + 10, y + top, x + w - 10, y + top, ink, 45);
          }
          rows.forEach((r, i) => {
            const ry = y + top + i * S.row * U;
            if (sc.changed.has(`${id}:${i}`)) add(id, 'flash', { type: 'rectangle', id: `${id}~flash${i}`, x: x + 6, y: ry + 3, width: w - 12, height: S.row * U - 6, ...ghost, backgroundColor: FLASH, roundness: { type: 3 } });
            if (i) line(id, `${id}~sep${i}`, x + 14, ry, x + w - 14, ry, MUTED, 35);
            add(id, 'row', { type: 'rectangle', id: `${id}~row${i}`, x: x + 8, y: ry + 1, width: w - 16, height: S.row * U - 2, ...ghost,
              label: label(r, { fontSize: 19, textAlign: 'left', verticalAlign: 'middle' }) });
          });
        }
      } else if (e.op === 'code') {
        add(id, 'shape', { type: 'rectangle', id, x, y, width: w, height: h, ...base, strokeColor: MUTED, strokeWidth: 1, backgroundColor: CODE_BG, roundness: { type: 3 } });
        const ln = sc.lines[id];
        if (ln) {
          const from = prevLines && prevLines[id] && prevLines[id] !== ln ? prevLines[id] : ln;
          const ly = (n) => y + S.pad * U + (n - 1) * S.code * U;
          add(id, 'hl', { type: 'rectangle', id: `${id}~hl`, x: x + 3, y: ly(ln), width: w - 6, height: S.code * U, ...ghost, backgroundColor: HL, _fromY: ly(from) });
          add(id, 'hl', { type: 'rectangle', id: `${id}~bar`, x: x + 3, y: ly(ln), width: 5, height: S.code * U, ...ghost, backgroundColor: HL_BAR, _fromY: ly(from) });
        }
        const fs = 18, lh = (S.code * U) / fs;
        const ty = y + S.pad * U;
        add(id, 'gutter', { type: 'text', id: `${id}~ln`, x: x + 14, y: ty, text: e.lines.map((_, i) => i + 1).join('\n'), fontFamily: F.Cascadia, fontSize: fs, lineHeight: lh, strokeColor: MUTED, opacity: 100 });
        add(id, 'text', { type: 'text', id: `${id}~src`, x: x + 46, y: ty, text: e.lines.join('\n'), fontFamily: F.Cascadia, fontSize: fs, lineHeight: lh, strokeColor: INK, opacity: 100 });
      } else if (e.op === 'table') {
        const ncol = e.rows[0].length, cw = w / ncol, rh = S.row * U;
        add(id, 'shape', { type: 'rectangle', id, x, y, width: w, height: h, ...base, strokeColor: TONES[e.tone] && e.tone !== 'gray' ? ink : MUTED, strokeWidth: 1.5, backgroundColor: e.tone && e.tone !== 'gray' ? paper : '#ffffff', roundness: { type: 3 } });
        let ry = y;
        if (e.cols) {
          line(id, `${id}~hr`, x, y + rh, x + w, y + rh, ink, 60, 1.5);
          e.cols.forEach((c, i) => add(id, 'head', { type: 'rectangle', id: `${id}~h${i}`, x: x + i * cw + 2, y: y + 1, width: cw - 4, height: rh - 2, ...ghost,
            label: label(c, { fontSize: 19, strokeColor: ink }) }));
          ry += rh;
        }
        for (let i = 1; i < ncol; i++) line(id, `${id}~vr${i}`, x + i * cw, y + 4, x + i * cw, y + h - 4, MUTED, 40);
        e.rows.forEach((r, ri) => {
          const yy = ry + ri * rh;
          if (ri) line(id, `${id}~sep${ri}`, x + 4, yy, x + w - 4, yy, MUTED, 35);
          r.forEach((c, ci) => {
            if (sc.changed.has(`${id}:${ri}:${ci}`)) add(id, 'flash', { type: 'rectangle', id: `${id}~f${ri}-${ci}`, x: x + ci * cw + 4, y: yy + 4, width: cw - 8, height: rh - 8, ...ghost, backgroundColor: FLASH, roundness: { type: 3 } });
            add(id, 'cell', { type: 'rectangle', id: `${id}~c${ri}-${ci}`, x: x + ci * cw + 2, y: yy + 1, width: cw - 4, height: rh - 2, ...ghost,
              label: label(c, { fontFamily: F.Cascadia, fontSize: 18 }) });
          });
        });
      } else if (e.op === 'text') {
        add(id, 'text', { type: 'text', id, x, y, text: wrap(e.text, w, clean), fontFamily: FACE, fontSize: 20, lineHeight: 1.35, strokeColor: '#343a40', opacity: 100 });
      }
      if (sc.marks.has(id)) add(id, 'mark', { type: 'rectangle', id: `${id}~mark`, x: x - 9, y: y - 9, width: w + 18, height: h + 18, ...base, roughness: clean ? 0 : 1.5, strokeColor: MARK, backgroundColor: 'transparent', strokeStyle: 'dashed', strokeWidth: 2, roundness: { type: 3 } });
    }
    // Arrows: drawn edge to edge, then bound (below) so they follow if anything is moved.
    for (const e of sc.els.values()) {
      if (e.op !== 'arrow') continue;
      const A = sc.els.get(e.from), B = sc.els.get(e.to);
      if (!A || !B) continue;
      const px = (r) => ({ x: r.x * U, y: r.y * U, w: r.w * U, h: r.h * U });
      const p1 = edge(px(A), px(B), 8), p2 = edge(px(B), px(A), 8);
      const color = e.tone && e.tone !== 'gray' ? tone(e.tone)[0] : '#495057';
      const s = add(e.id, 'arrow', { type: 'arrow', id: e.id, x: p1.x, y: p1.y, points: [[0, 0], [p2.x - p1.x, p2.y - p1.y]], ...base, strokeColor: color,
        strokeStyle: e.dashed ? 'dashed' : 'solid', endArrowhead: 'arrow', startArrowhead: null, roundness: { type: 2 }, _from: e.from, _to: e.to });
      if (e.label) s.label = { text: e.label, fontFamily: FACE, fontSize: 19, strokeColor: color };
    }
    return out;
  }

  // Wrap a note to its width (measured with the real font when the browser has it).
  let measureCtx = null;
  function wrap(text, w, clean) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = clean ? '20px Nunito, sans-serif' : '20px Excalifont, Xiaolai, sans-serif';
    const width = (s) => measureCtx.measureText(s).width;
    const out = [];
    for (const para of String(text).split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = cur ? `${cur} ${word}` : word;
        if (cur && width(t) > w - 8) { out.push(cur); cur = word; } else cur = t;
      }
      out.push(cur);
    }
    return out.join('\n');
  }

  // ---------- mount ----------
  function mount(host, opts = {}) {
    let lib = null, xapi = null, root = null, disposed = false;
    let board = null, step = -1, built = [], anim = null, raf = 0, theme = opts.theme || 'auto';
    let font = opts.font || prefFont();
    let userSig = '', changeTimer = 0, lastFit = null, animDone = null;
    const userIds = new Map();      // excalidraw id → u1, u2… (stable names for describe())
    let resolveReady;
    const ready = new Promise((r) => (resolveReady = r));

    host.classList.add('qcanvas');
    if (opts.lesson) host.classList.add('lesson');
    if (!document.getElementById('qcanvas-css')) {
      const st = document.createElement('style');
      st.id = 'qcanvas-css';
      // Excalidraw's "how to pan" hint sits over the top of the board; the board has its own controls.
      // In a lesson: no library, no main menu (save/open/export), no help, no welcome screen.
      // The drawing toolbar, zoom and undo/redo stay.
      st.textContent = '.qcanvas .HintViewer{display:none!important}.qcanvas{overflow:hidden}'
        + '.qcanvas.lesson .main-menu-trigger,.qcanvas.lesson .default-sidebar-trigger,.qcanvas.lesson .sidebar-trigger,'
        + '.qcanvas.lesson .help-icon,.qcanvas.lesson [class*="welcome-screen"]{display:none!important}'
        // Compact UI (narrow canvas): the bottom bar only holds undo/redo now, so keep it small, bottom left.
        + '.qcanvas.lesson .excalidraw--mobile .App-bottom-bar{right:auto!important;width:auto!important}'
        + '.qcanvas.lesson .excalidraw--mobile .App-bottom-bar .Island{width:auto!important}';
      document.head.appendChild(st);
    }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const mq = matchMedia('(prefers-color-scheme: dark)');
    const resolvedTheme = () => {
      if (theme === 'light' || theme === 'dark') return theme;
      const P = PREFS();
      if (P && P.isDark) return P.isDark() ? 'dark' : 'light';   // the app's theme setting, else the system
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'light' || attr === 'dark') return attr;
      return mq.matches ? 'dark' : 'light';
    };
    const isTeacher = (el) => el && el.customData && el.customData.by === 'teacher';

    function render() {
      if (!lib || disposed) return;
      const { React, Excalidraw } = lib;
      root.render(React.createElement(Excalidraw, {
        excalidrawAPI: (a) => { if (a && !xapi) { xapi = a; whenLoaded(); } },
        theme: resolvedTheme(),
        aiEnabled: false,
        handleKeyboardGlobally: false,
        initialData: { elements: [], appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: font === 'clean' ? 6 : 5, currentItemRoughness: font === 'clean' ? 0 : 1, currentItemStrokeColor: '#e03131' } },
        UIOptions: {
          canvasActions: { loadScene: false, export: false, saveToActiveFile: false, toggleTheme: false, changeViewBackgroundColor: false, clearCanvas: false, saveAsImage: true },
          tools: { image: false },
        },
        onChange: (elements) => onSceneChange(elements),
      }));
    }

    // Excalidraw applies initialData a moment after handing out its API (and would undo an early
    // zoom/scroll), so "ready" waits until it has finished loading.
    function whenLoaded() {
      if (disposed) return;
      if (xapi.getAppState().isLoading) return void requestAnimationFrame(whenLoaded);
      // What he drew on this board before it was re-mounted (the lesson stream re-renders).
      if (opts.learner && opts.learner.length) xapi.updateScene({ elements: opts.learner, captureUpdate: lib.CaptureUpdateAction.NEVER });
      requestAnimationFrame(() => requestAnimationFrame(() => resolveReady(api)));
    }

    const themeListener = () => render();
    mq.addEventListener('change', themeListener);
    window.addEventListener('quiz:theme', themeListener);
    // boards.font changed in Settings: redraw the current step in the new font (unless mount pinned a font).
    const prefsListener = (e) => {
      const ch = (e.detail && e.detail.changed) || [];
      if (opts.font || !ch.includes('boards.font') || prefFont() === font) return;
      font = prefFont();
      if (board && step >= 0) show(step, false);
    };
    window.addEventListener('quiz:prefs', prefsListener);
    const themeObserver = new MutationObserver(themeListener);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    load().then((l) => {
      if (disposed) return;
      lib = l;
      root = l.createRoot(host);
      render();
    }).catch((err) => { console.error('canvas: could not load Excalidraw', err); host.textContent = 'The canvas could not load.'; });

    // Re-measure text once the hand-drawn fonts arrive (first paint may have used fallback metrics).
    const fontsDone = () => { if (board && step >= 0 && !anim) show(step, false); };
    document.fonts && document.fonts.addEventListener('loadingdone', fontsDone);

    function onSceneChange(elements) {
      const users = elements.filter((e) => !isTeacher(e) && !e.isDeleted);
      const sig = users.map((e) => `${e.id}:${e.version}`).join('|');
      if (sig === userSig) return;
      userSig = sig;
      if (opts.onChange) { clearTimeout(changeTimer); changeTimer = setTimeout(() => !disposed && opts.onChange(api), 400); }
    }

    // ----- building a step -----
    function build(k, prevLines) {
      const sc = sceneAt(board, k);
      const sk = skeletons(sc, lib.FONT_FAMILY, prevLines, font);
      const meta = new Map(sk.map((s) => [s.id, { fromY: s._fromY, from: s._from, to: s._to }]));
      sk.forEach((s) => { delete s._fromY; delete s._from; delete s._to; });
      const els = lib.convertToExcalidrawElements(sk, { regenerateIds: false });
      const byId = new Map(els.map((e) => [e.id, e]));
      // Stable look: the same seed for an element every time it is rebuilt.
      for (const e of els) { e.seed = hash(e.id); if (e.containerId) e.customData = byId.get(e.containerId)?.customData; }
      // Bind teacher arrows to their boxes.
      for (const e of els) {
        const m = meta.get(e.id);
        if (!m || !m.from) continue;
        const a = byId.get(m.from), b = byId.get(m.to);
        e.startBinding = a ? { elementId: a.id, focus: 0, gap: 8 } : null;
        e.endBinding = b ? { elementId: b.id, focus: 0, gap: 8 } : null;
        for (const t of [a, b]) if (t) t.boundElements = [...(t.boundElements || []), { id: e.id, type: 'arrow' }];
      }
      // Keep the learner's arrows bound to teacher shapes they were attached to.
      if (xapi) {
        const cur = new Map(xapi.getSceneElements().map((e) => [e.id, e]));
        for (const e of els) {
          const old = cur.get(e.id);
          if (!old || !old.boundElements) continue;
          const keep = old.boundElements.filter((b) => { const u = cur.get(b.id); return u && !isTeacher(u); });
          if (keep.length) e.boundElements = [...(e.boundElements || []), ...keep];
        }
      }
      return { sc, els, meta };
    }

    // Merge teacher elements (bottom) with the learner's (top) and push them to Excalidraw.
    function push(teacherEls) {
      const users = xapi.getSceneElements().filter((e) => !isTeacher(e));
      xapi.updateScene({ elements: [...teacherEls, ...users], captureUpdate: lib.CaptureUpdateAction.NEVER });
    }

    // One frame of the step animation: new ops fade in (staggered), arrows grow from tail to head,
    // the code highlight slides to its new line, changed cells/rows flash in.
    function frame(now) {
      const t = now - anim.t0;
      const f = anim.f || 1;   // pace 'fast': everything ~3× quicker
      let busy = false;
      const out = anim.els.map((e) => {
        const cd = e.customData || {};
        const i = anim.order.indexOf(cd.id);
        let o = e;
        if (i >= 0) {
          const start = i * STAGGER * f;
          if (e.type === 'arrow' && !e.containerId) {
            const p = ease((t - start) / (GROW * f));
            if (p < 1) busy = true;
            const [dx, dy] = e.points[1];
            o = { ...e, points: [[0, 0], [dx * Math.max(p, 0.001), dy * Math.max(p, 0.001)]], width: Math.abs(dx * p), height: Math.abs(dy * p), opacity: t < start ? 0 : 100 };
          } else if (e.containerId && cd.part === 'arrow') {
            const p = ease((t - start - GROW * f) / (FADE * f));
            if (p < 1) busy = true;
            if (p <= 0) return null;   // not even its gap in the arrow until it starts to appear
            o = { ...e, opacity: Math.round(100 * p) };
          } else {
            const p = ease((t - start) / (FADE * f));
            if (p < 1) busy = true;
            o = { ...e, opacity: Math.round((e.opacity ?? 100) * p), y: e.y - 10 * (1 - p) };
          }
        }
        const m = anim.meta.get(e.id) || (e.containerId && anim.meta.get(e.containerId));
        if (cd.part === 'hl' && m && m.fromY !== undefined && m.fromY !== e.y) {
          const p = ease(t / (360 * f));
          if (p < 1) busy = true;
          o = { ...o, y: m.fromY + (e.y - m.fromY) * p };
        }
        if (cd.part === 'flash') {
          const p = ease(t / (300 * f));
          if (p < 1) busy = true;
          o = { ...o, opacity: Math.round(100 * p) };
        }
        if (o !== e) o.version = (e.version || 1) + 1 + Math.floor(t);
        return o;
      }).filter(Boolean);
      push(out);
      if (busy && !disposed) raf = requestAnimationFrame(frame);
      else { anim = null; push(built); settle(); }
    }
    // Resolve whoever waits for the current step's drawing (also when a newer step cuts it short).
    function settle() { const d = animDone; animDone = null; if (d) d(); }

    function show(k, animate, pc) {
      if (!xapi || !board) return Promise.resolve();
      cancelAnimationFrame(raf); anim = null; settle();
      const prev = step >= 0 && step < board.steps.length ? sceneAt(board, step).lines : null;
      // Animated: the step's new ops fade in; the code highlight slides only when moving one step on.
      // pace 'instant': the step (with its highlights and flashes) appears at once.
      const forward = animate && !reduced() && pc !== 'instant';
      const b = build(k, forward && k === step + 1 ? prev : null);
      built = b.els; step = k;
      if (forward) {
        anim = { t0: performance.now(), els: b.els, meta: b.meta, order: b.sc.added, f: pc === 'fast' ? 0.35 : 1 };
        const p = new Promise((r) => (animDone = r));
        raf = requestAnimationFrame(frame);
        return p;
      }
      push(built);
      return Promise.resolve();
    }

    // Fit the whole board (every step's extent) plus anything the learner drew.
    function fit() {
      if (!xapi || !board) return;
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      let x0 = 0, y0 = 0, x1 = COLS * U, y1 = Math.max(boardHeight(board), opts.minRows || 0) * U;   // minRows: a live board fits its room up front
      for (const e of xapi.getSceneElements()) if (!isTeacher(e)) { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.width); y1 = Math.max(y1, e.y + e.height); }
      const narrow = r.width < 600;
      const padX = narrow ? 12 : 48, padTop = narrow ? 72 : 84, padBottom = narrow ? 96 : 72;   // room for Excalidraw's toolbars
      const z = Math.max(0.1, Math.min(1.1, (r.width - padX * 2) / (x1 - x0), (r.height - padTop - padBottom) / (y1 - y0)));
      const scrollX = (r.width / z - (x1 - x0)) / 2 - x0;
      const scrollY = padTop / z - y0;
      lastFit = { z, scrollX, scrollY };
      xapi.updateScene({ appState: { zoom: { value: z }, scrollX, scrollY }, captureUpdate: lib.CaptureUpdateAction.NEVER });
    }
    const ro = new ResizeObserver(() => { if (!xapi) return; const s = xapi.getAppState(); if (!lastFit || (Math.abs(s.zoom.value - lastFit.z) < 1e-3 && Math.abs(s.scrollX - lastFit.scrollX) < 1)) fit(); });
    ro.observe(host);

    // ----- describe() for the teacher -----
    const grid = (n) => r1(n / U);
    function nameOf(id, cur) {
      const e = cur.get(id);
      if (!e) return null;
      if (isTeacher(e)) return e.customData.id;
      const top = e.containerId ? cur.get(e.containerId) || e : e;
      if (isTeacher(top)) return top.customData.id;
      if (!userIds.has(top.id)) userIds.set(top.id, `u${userIds.size + 1}`);
      return userIds.get(top.id);
    }
    function describe() {
      const all = xapi ? xapi.getSceneElements() : [];
      const cur = new Map(all.map((e) => [e.id, e]));
      const sc = board && step >= 0 ? sceneAt(board, step) : { els: new Map(), lines: {}, marks: new Set() };
      const bounds = (e) => { const [x0, y0, x1, y1] = lib.getCommonBounds([e]); return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }; };
      const box = (e) => { const b = bounds(e); return { x: grid(b.x), y: grid(b.y), w: grid(b.width), h: grid(b.height) }; };
      const teacher = [], arrows = [], user = [];
      for (const o of sc.els.values()) {
        if (o.op === 'arrow') { arrows.push({ by: 'teacher', id: o.id, from: o.from, to: o.to, ...(o.label ? { label: o.label } : {}), ...(o.dashed ? { dashed: true } : {}) }); continue; }
        const d = { id: o.id, kind: o.op };
        if (o.label) d.label = o.label;
        if (o.op === 'box' && o.rows) d.rows = o.rows;
        if (o.op === 'code') { d.lines = o.lines; if (sc.lines[o.id]) d.highlightedLine = sc.lines[o.id]; }
        if (o.op === 'table') { if (o.cols) d.cols = o.cols; d.rows = o.rows; }
        if (o.op === 'text') d.text = o.text;
        const live = cur.get(o.id);
        Object.assign(d, live ? box(live) : { x: o.x, y: o.y, w: o.w, h: r1(o.h) });
        if (live && (Math.abs(live.x / U - o.x) > 0.05 || Math.abs(live.y / U - o.y) > 0.05)) d.movedByLearner = true;
        if (o.tone && o.tone !== 'gray') d.tone = o.tone;
        if (sc.marks.has(o.id)) d.highlighted = true;
        teacher.push(d);
      }
      const near = (px, py, within = 0.6 * U, skip = null) => {
        let best = null, bd = within;
        for (const e of all) {
          if (e === skip || e.type === 'arrow' || e.type === 'line' || e.type === 'freedraw' || e.containerId || (isTeacher(e) && e.customData.part !== 'shape' && e.customData.part !== 'text')) continue;
          const dx = Math.max(e.x - px, 0, px - (e.x + e.width)), dy = Math.max(e.y - py, 0, py - (e.y + e.height));
          const d = Math.hypot(dx, dy);
          if (d < bd) { bd = d; best = e; }
        }
        return best ? nameOf(best.id, cur) : null;
      };
      const touches = (e0) => {
        const e = bounds(e0), hit = new Set();
        for (const t of all) {
          if (!isTeacher(t) || t.customData.part !== 'shape' && t.customData.part !== 'text') continue;
          if (e.x < t.x + t.width && t.x < e.x + e.width && e.y < t.y + t.height && t.y < e.y + e.height) hit.add(t.customData.id);
        }
        return [...hit];
      };
      let freehand = 0;
      for (const e of all) {
        if (isTeacher(e) || e.containerId) continue;
        const id = nameOf(e.id, cur);
        const bound = (e.boundElements || []).map((b) => cur.get(b.id)).find((t) => t && t.type === 'text');
        const text = e.type === 'text' ? e.text : bound ? bound.text : undefined;
        if (e.type === 'arrow' || e.type === 'line') {
          const pts = e.points;
          const [sx, sy] = [e.x + pts[0][0], e.y + pts[0][1]], [ex, ey] = [e.x + pts[pts.length - 1][0], e.y + pts[pts.length - 1][1]];
          const a = { by: 'learner', id, kind: e.type,
            from: (e.startBinding && nameOf(e.startBinding.elementId, cur)) || near(sx, sy) || { x: grid(sx), y: grid(sy) },
            to: (e.endBinding && nameOf(e.endBinding.elementId, cur)) || near(ex, ey) || { x: grid(ex), y: grid(ey) } };
          if (text) a.label = text;
          if (e.strokeStyle !== 'solid') a.dashed = true;
          (e.type === 'arrow' ? arrows : user).push(a);
          continue;
        }
        const d = { id, kind: e.type === 'freedraw' ? 'freehand' : e.type, ...box(e) };
        if (text) d.text = text;
        if (e.type === 'freedraw') freehand++;
        if (e.strokeColor && e.strokeColor !== '#1e1e1e') d.color = e.strokeColor;
        const over = touches(e);
        if (over.length) d.over = over;
        else { const b = bounds(e), n = near(b.x + b.width / 2, b.y + b.height / 2, 1.5 * U, e); if (n) d.near = n; }
        user.push(d);
      }
      return {
        title: board ? board.title : '',
        step: board ? { at: step + 1, of: board.steps.length, say: step >= 0 ? board.steps[step].say : '' } : null,
        grid: '12 units wide, y grows down (1 unit = 100 px)',
        teacher, arrows, learner: user,
        ...(freehand ? { note: `${freehand} freehand stroke(s): send snapshotPng() to see them` } : {}),
      };
    }

    async function snapshotPng({ maxSize = 1600 } = {}) {
      await ready;
      const els = xapi.getSceneElements();
      return lib.exportToBlob({
        elements: els, files: xapi.getFiles(), mimeType: 'image/png', exportPadding: 24, maxWidthOrHeight: maxSize,
        appState: { ...xapi.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: '#ffffff' },
      });
    }

    const api = {
      ready,
      get step() { return step; },
      get board() { return board; },
      async play(b, { at = 0, animate = true, pace } = {}) {
        await ready;
        board = b; step = -1;
        fit();
        if (at > 0) show(at - 1, false);
        await show(at, animate, pace);
        return api;
      },
      async goTo(k, { animate = true, pace } = {}) {
        await ready;
        if (!board) return;
        k = Math.max(0, Math.min(board.steps.length - 1, k));
        return show(k, animate, pace);
      },
      next() { return board && step < board.steps.length - 1 ? api.goTo(step + 1) : Promise.resolve(); },
      prev() { return board && step > 0 ? api.goTo(step - 1, { animate: false }) : Promise.resolve(); },
      get animating() { return !!anim; },
      fit,
      // Zoom around the middle of the view (Excalidraw's compact UI, under ~730 px wide, has no zoom buttons).
      zoomBy(f) {
        if (!xapi) return;
        const st = xapi.getAppState(), r = host.getBoundingClientRect();
        const z0 = st.zoom.value, z = Math.max(0.1, Math.min(4, z0 * f));
        const cx = r.width / 2, cy = r.height / 2;
        xapi.updateScene({ appState: { zoom: { value: z }, scrollX: cx / z - (cx / z0 - st.scrollX), scrollY: cy / z - (cy / z0 - st.scrollY) }, captureUpdate: lib.CaptureUpdateAction.NEVER });
      },
      get zoom() { return xapi ? xapi.getAppState().zoom.value : 1; },
      setTheme(t) { theme = t; render(); },
      setFont(f) { font = f === 'clean' ? 'clean' : 'hand'; if (board && step >= 0) show(step, false); },
      get font() { return font; },
      learnerElements() { return xapi ? xapi.getSceneElements().filter((e) => !isTeacher(e)) : []; },
      clearLearner() { if (xapi) xapi.updateScene({ elements: xapi.getSceneElements().filter(isTeacher), captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY }); },
      describe,
      snapshotPng,
      excalidraw: () => xapi,
      dispose() {
        disposed = true;
        cancelAnimationFrame(raf); clearTimeout(changeTimer); settle();
        ro.disconnect(); themeObserver.disconnect(); mq.removeEventListener('change', themeListener);
        window.removeEventListener('quiz:theme', themeListener); window.removeEventListener('quiz:prefs', prefsListener);
        document.fonts && document.fonts.removeEventListener('loadingdone', fontsDone);
        if (root) root.unmount();
        host.classList.remove('qcanvas', 'lesson');
      },
    };
    if (opts.board) api.play(opts.board);
    return api;
  }

  Q.canvas = { mount, load, sceneAt };
})();
