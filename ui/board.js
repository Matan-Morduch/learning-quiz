// Board answers: a whiteboard explanation, drawn step by step while a voice narrates it
// (MP3s from voice.js: the free local Kokoro voice by default, ElevenLabs when chosen; else the browser's speechSynthesis).
// The server (board.js) checks the board and works out each element's height; this file only draws.
// Two renderers (pref boards.renderer, also set from the ••• menu): the hand-drawn Excalidraw canvas
// (ui/canvas.js, loaded on first use; he can draw on it) or the simple SVG drawing (default on phones).
// Prefs (Quiz.prefs, ui/prefs.js) obeyed here and applied live: voice.speed (default speed; the player's
// own speed button overrides it for that board), voice.captions, voice.capAlertPct (the server's capAlert
// → one toast per month and threshold), boards.renderer, boards.pace (voice | fast | instant), boards.font
// and the theme (in ui/canvas.js). boards.autoplay is for live answers (ui/live.js): players never auto-start.
//   Quiz.board.mount(host, board, { menu })  → a player in `host`
//   Quiz.board.drawing                       → his drawing on a board, to send with his next message
//   Quiz.board.readAloud(text, button, opts) → speak a teacher reply (toggle); opts.free: only the free
//                                              local voice (else the browser voice), never ElevenLabs
//   Quiz.board.noteCapAlert(response)        → toast a server capAlert once (ui/live.js uses it too)
//   Quiz.board.stopAll() / stopDetached()    → silence (leaving a lesson, re-rendered stream)
(() => {
  const Q = window.Quiz;
  const esc = Q.esc;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const U = 100;            // px of the viewBox per grid unit
  const COLS = 12, PAD = 24;
  const S = { head: 0.56, row: 0.42, pad: 0.14, code: 0.36, text: 0.34 };
  const motionAttr = () => document.documentElement.dataset.motion;
  const reduced = () => (motionAttr() === 'reduced' ? true : motionAttr() === 'full' ? false : matchMedia('(prefers-reduced-motion: reduce)').matches);
  // App preferences (ui/prefs.js; index.html may rebuild window.Quiz, so window.QuizPrefs first).
  const P = () => window.QuizPrefs || (window.Quiz && window.Quiz.prefs) || null;
  const pget = (k, d) => { const p = P(); const v = p ? p.get(k) : undefined; return v === undefined || v === null ? d : v; };
  const speed = () => { const v = Number(pget('voice.speed', 1)); return v >= 0.5 && v <= 2 ? v : 1; };
  const pace = () => { const v = pget('boards.pace', 'voice'); return v === 'fast' || v === 'instant' ? v : 'voice'; };
  const fmtRate = (r) => `${Number(r.toFixed(2))}×`;
  // Captions off (voice.captions): spoken text is hidden in every player and live board; notes that aren't
  // captions (cost hints, errors) carry .keep and stay.
  function syncCaptions() { document.documentElement.toggleAttribute('data-bd-nocap', pget('voice.captions', true) === false); }
  syncCaptions();

  const css = `
  .bd { margin: 2px 0 18px; border: 1px solid var(--separator); border-radius: var(--r-xl); background: var(--surface); box-shadow: var(--shadow-1); overflow: hidden; outline: none; }
  .bd:focus-visible { box-shadow: 0 0 0 3px var(--accent-tint), var(--shadow-1); }
  .bd-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px 0; }
  .bd-head .icon { width: 17px; height: 17px; color: var(--accent); flex: none; }
  .bd-title { font: var(--headline); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bd-stage { position: relative; padding: 6px 10px 0; }
  .bd-stage svg { display: block; width: 100%; height: auto; }
  .bd-cover { position: absolute; inset: 0; display: grid; place-items: center; border: 0; padding: 0; cursor: pointer; color: var(--label);
    background: color-mix(in srgb, var(--surface) 62%, transparent); transition: opacity var(--dur); }
  .bd-cover span { display: grid; justify-items: center; gap: 10px; font: 600 15px/20px var(--font); }
  .bd-cover i { width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-2); transition: transform .12s; }
  .bd-cover i svg { width: 24px; height: 24px; margin-left: 3px; fill: currentColor; }
  .bd-cover[hidden] { display: none; }
  .bd-cover small { font: var(--footnote); color: var(--label-2); }
  .bd-cover:hover i { transform: scale(1.05); }
  .bd-cover.busy i { animation: bd-pulse 1s var(--ease) infinite; }
  .bd-cover b { font: inherit; }
  .tc-tool.busy svg { animation: bd-pulse 1s var(--ease) infinite; }
  .bd-cover:active i { transform: scale(.96); }
  .bd-cap { min-height: 46px; padding: 6px 18px 10px; font: var(--callout); color: var(--label); }
  .bd-cap.idle { color: var(--label-2); }
  :root[data-bd-nocap] .bd-cap:not(.keep) { display: none; }
  .bd-ctrl { display: flex; align-items: center; gap: 2px; padding: 4px 8px 8px; }
  .bd-b { width: 34px; height: 34px; flex: none; border: 0; border-radius: 50%; background: none; color: var(--label); display: grid; place-items: center; cursor: pointer; font: 600 13px/1 var(--font); }
  .bd-b:hover { background: var(--fill); }
  .bd-b:disabled { color: var(--label-4); background: none; cursor: default; }
  .bd-b svg { width: 18px; height: 18px; }
  .bd-b.play svg { fill: currentColor; }
  .bd-b.speed { width: auto; min-width: 38px; padding: 0 8px; border-radius: 17px; font-variant-numeric: tabular-nums; }
  .bd-prog { flex: 1; min-width: 0; display: flex; gap: 3px; padding: 0 8px; }
  .bd-prog button { flex: 1; min-width: 0; height: 22px; border: 0; padding: 0; background: none; cursor: pointer; display: flex; align-items: center; }
  .bd-prog button::before { content: ''; flex: 1; height: 4px; border-radius: 2px; background: var(--separator-strong); transition: background var(--dur); }
  .bd-prog button.on::before { background: var(--accent); }
  .bd-prog button.cur::before { background: var(--accent); box-shadow: 0 0 0 2px var(--accent-tint); }
  .bd-tr { border-top: 1px solid var(--separator); }
  .bd-tr summary { list-style: none; cursor: pointer; padding: 10px 18px; font: var(--footnote); color: var(--label-2); display: flex; align-items: center; gap: 6px; }
  .bd-tr summary::-webkit-details-marker { display: none; }
  .bd-tr summary .icon { width: 14px; height: 14px; transition: transform var(--dur); }
  .bd-tr[open] summary .icon { transform: rotate(90deg); }
  .bd-tr ol { margin: 0; padding: 0 18px 12px 40px; display: grid; gap: 6px; font: var(--subhead); color: var(--label-2); }
  .bd-tr li { cursor: pointer; }
  .bd-tr li:hover, .bd-tr li.cur { color: var(--label); }

  /* the drawing */
  .bd svg text { font-family: var(--font); fill: var(--label); }
  .bd svg .mono { font-family: var(--font-mono); }
  .bd svg .lbl { font-weight: 600; font-size: 20px; }
  .bd svg .row { font-size: 17px; }
  .bd svg .note { font-size: 17px; fill: var(--label-2); }
  .bd svg .hd { font-weight: 600; font-size: 14px; fill: var(--label-2); }
  .bd svg .ln { font-size: 13px; fill: var(--label-3); }
  .bd svg .alb { font-size: 15px; fill: var(--label-2); }
  .bd svg .sep { stroke: var(--separator); stroke-width: 1.2; }
  .bd svg .hl { fill: var(--accent-tint); }
  .bd svg .hlbar { fill: var(--accent); }
  .bd svg .mark { fill: none; stroke: var(--accent); stroke-width: 3; animation: bd-pulse 1.4s var(--ease) infinite; }
  .bd svg .flash { fill: color-mix(in srgb, var(--accent) 8%, transparent); animation: bd-flash 1.8s var(--ease) forwards; }
  .bd svg .new .ink { stroke-dasharray: 1; stroke-dashoffset: 1; animation: bd-draw calc(.7s * var(--k, 1)) var(--ease) forwards; animation-delay: var(--d, 0s); }
  .bd svg .new .fade { opacity: 0; animation: bd-fade calc(.35s * var(--k, 1)) var(--ease) forwards; animation-delay: calc(var(--d, 0s) + var(--e, .45s) * var(--k, 1)); }
  .bd.fast { --k: .35; }   /* boards.pace 'fast': the same drawing, about 3× quicker */
  .bd svg .new.arrow .fade { --e: .55s; }
  @keyframes bd-draw { to { stroke-dashoffset: 0; } }
  @keyframes bd-fade { to { opacity: 1; } }
  @keyframes bd-pulse { 50% { opacity: .35; } }
  @keyframes bd-flash { from { fill: color-mix(in srgb, var(--accent) 38%, transparent); } to { fill: color-mix(in srgb, var(--accent) 8%, transparent); } }
  @media (prefers-reduced-motion: reduce) {
    .bd svg .new .ink, .bd svg .new .fade, .bd svg .mark, .bd svg .flash { animation: none; opacity: 1; stroke-dashoffset: 0; }
  }
  @media (max-width: 600px) { .bd-cap { font: var(--subhead); } .bd-prog { padding: 0 4px; } }

  /* the Excalidraw canvas as the stage: a fixed height from the board's shape, full screen on demand */
  .bd-hb { margin-left: auto; width: 30px; height: 30px; flex: none; border: 0; border-radius: 50%; background: none; color: var(--label-2); display: grid; place-items: center; cursor: pointer; }
  .bd-hb:hover { background: var(--fill); color: var(--label); }
  .bd-hb[hidden] { display: none; }
  .bd-hb svg { width: 17px; height: 17px; }
  .bd.cv .bd-stage { container-type: inline-size; padding: 8px 10px 0; }
  .bd-cv { position: relative; height: clamp(300px, calc(var(--bd-ar, .5) * 100cqw + 150px), 620px); border: 1px solid var(--separator); border-radius: var(--r-lg); overflow: hidden; background: #fff; }
  .bd-cv > .bd-cv-x { position: absolute; inset: 0; }
  .bd-cv-load { position: absolute; inset: 0; display: grid; place-items: center; font: var(--footnote); color: var(--label-3); background: var(--surface); }
  .bd-cv-load[hidden] { display: none; }
  .bd.cv .bd-cover { z-index: 7; background: color-mix(in srgb, var(--surface) 30%, transparent); pointer-events: none; border-radius: var(--r-lg); inset: 8px 10px 0; }
  .bd-zoom { position: absolute; z-index: 6; right: 10px; bottom: 10px; display: flex; align-items: center; gap: 0; padding: 2px; border-radius: 10px;
    background: var(--surface); border: 1px solid var(--separator); box-shadow: var(--shadow-1); }
  .bd-zoom button { width: 30px; height: 30px; border: 0; border-radius: 8px; background: none; color: var(--label-2); display: grid; place-items: center; cursor: pointer; font: 600 16px/1 var(--font); }
  .bd-zoom button:hover { background: var(--fill); color: var(--label); }
  .bd-zoom button svg { width: 16px; height: 16px; }
  .bd-cv:has(.excalidraw:not(.excalidraw--mobile)) .bd-zoom, .bd-cv:not(:has(.excalidraw)) .bd-zoom { display: none; }
  .bd.cv .bd-cover > span { pointer-events: auto; cursor: pointer; padding: 16px 22px 12px; border-radius: 22px; background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); box-shadow: var(--shadow-2); }
  .bd.expanded { position: fixed; inset: 16px; z-index: 92; margin: 0; display: flex; flex-direction: column; box-shadow: var(--shadow-3); }
  .bd.expanded .bd-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bd.expanded .bd-svg { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bd.expanded .bd-cv { flex: 1; height: auto; }
  .bd.expanded .bd-tr { display: none; }
  .bd-scrim { position: fixed; inset: 0; z-index: 91; background: rgb(0 0 0 / .32); }
  body:has(.bd.expanded) .popover { z-index: 100; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .bd-cv { background: #121212; } }
  :root[data-theme="dark"] .bd-cv { background: #121212; }
  @media (max-width: 600px) { .bd.expanded { inset: 0; border-radius: 0; border: 0;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); } }
  /* touch: thumb-sized controls */
  @media (hover: none) and (pointer: coarse) {
    .bd-b { width: 40px; height: 40px; }
    .bd-hb { width: 40px; height: 40px; }
    .bd-zoom button { width: 40px; height: 40px; }
    .bd-prog button { height: 32px; }
  }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- voice ----------
  // MP3s made by the server (voice.js): the local Kokoro voice (free; a board's narration is made right
  // after the teacher's turn) or ElevenLabs (paid: made on Play, only the step playing + the next one).
  // Else the browser's speechSynthesis. All go through one token (sayToken), so a newer request silences an older one.

  const synth = window.speechSynthesis || null;
  const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Grandma|Grandpa|Rocko|Shelley|Flo|Eddy|Reed|Sandy)\b/;
  let voices = [];
  const loadVoices = () => { voices = synth ? synth.getVoices() : []; };
  if (synth) { loadVoices(); synth.addEventListener('voiceschanged', loadVoices); }
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // ---------- renderer: Excalidraw canvas or simple SVG drawing ----------
  // Pref boards.renderer ('auto' | 'canvas' | 'svg'; the ••• menu writes it): auto is the canvas on wide
  // screens, the SVG on phones (cramped there).
  const narrowScreen = () => matchMedia('(max-width: 600px)').matches;
  const rendererFor = (r) => (r === 'canvas' || r === 'svg' ? r : narrowScreen() ? 'svg' : 'canvas');
  const renderer = () => rendererFor(pget('boards.renderer', 'auto'));
  const HERE = new URL('.', (document.currentScript && document.currentScript.src) || location.href);
  let canvasLib = null;
  // ui/canvas.js + the vendored Excalidraw bundle, fetched the first time a canvas board is shown.
  function loadCanvas() {
    if (!canvasLib) {
      canvasLib = new Promise((resolve, reject) => {
        if (Q.canvas) return resolve(Q.canvas);
        const s = document.createElement('script');
        s.src = new URL('canvas.js', HERE).href;
        s.onload = () => (Q.canvas ? resolve(Q.canvas) : reject(new Error('canvas.js did not load')));
        s.onerror = () => reject(new Error('canvas.js did not load'));
        document.head.appendChild(s);
      }).then((c) => c.load().then(() => c));
      canvasLib.catch(() => { canvasLib = null; });
    }
    return canvasLib;
  }
  function englishVoices() {
    const score = (v) => (/premium/i.test(v.name) ? 4 : /enhanced/i.test(v.name) ? 3 : 0)
      + (/^(Ava|Zoe|Evan|Nathan|Noelle|Allison|Susan|Tom|Samantha|Daniel|Karen|Moira|Serena|Jamie|Google US English)\b/.test(v.name) ? 1 : 0)
      + (v.lang === 'en-US' ? 0.5 : 0) + (v.localService ? 0.2 : 0);
    return voices.filter((v) => /^en[-_]/i.test(v.lang) && !NOVELTY.test(v.name)).sort((a, b) => score(b) - score(a));
  }
  function voice() {
    const name = pref('board.voice', '');
    return (name && voices.find((v) => v.name === name)) || englishVoices()[0] || null;
  }
  // Speed: the voice.speed pref, unless a player's own speed button set one for that board (kept per board
  // while the page is open). MP3s play faster with playbackRate (pitch kept), so cached audio stays valid.
  const RATES = [0.85, 1, 1.15, 1.3, 1.5];
  const rateOverride = new Map();   // boardKey → speed chosen on that board

  // Voice status from the server: { engine: 'local'|'elevenlabs'|null, want, local, configured, usable, reason, voice, model, month, subscription? }
  let nat = null, natAt = 0, natReq = null;
  function natStatus(force) {
    if (!force && (natReq || Date.now() - natAt < 60000)) return natReq || Promise.resolve(nat);
    natReq = Q.api('api/voice/status').then((d) => { nat = d; natAt = Date.now(); noteCapAlert(d); return d; }).catch(() => nat).finally(() => { natReq = null; });
    return natReq;
  }
  // The server adds capAlert {pct, estUsd, cap, month} once this month's ElevenLabs spend reaches the
  // voice.capAlertPct share of the cap: one toast per month and threshold (remembered in this browser).
  function noteCapAlert(d) {
    const a = d && d.capAlert;
    if (!a || !a.pct || !a.month) return;
    const k = `quizCapAlert:${a.month}:${a.pct}`;
    try { if (localStorage.getItem(k)) return; localStorage.setItem(k, String(Date.now())); } catch { if (noteCapAlert.seen && noteCapAlert.seen.has(k)) return; }
    (noteCapAlert.seen = noteCapAlert.seen || new Set()).add(k);
    const full = a.estUsd >= a.cap;
    const msg = `ElevenLabs this month: ~${money(a.estUsd)} of your $${a.cap} budget (${a.usedPct != null ? a.usedPct : a.pct}%).${full ? ' New audio now uses the free voice.' : ''}`;
    if (Q.showToast) Q.showToast(msg); else console.info('[voice]', msg);
  }
  natStatus();
  // Natural voice wanted: the server has an engine (local or ElevenLabs) and he didn't switch to the browser voice in the ••• menu.
  const natural = () => !!(nat && nat.engine) && pref('board.engine', 'natural') === 'natural';
  const kchars = (n) => (n >= 950 ? `${(n / 1000).toFixed(1)}k` : `${Math.max(10, Math.round(n / 10) * 10)}`);
  const canSpeak = () => !!synth || natural();
  const voiceOn = () => canSpeak() && pref('board.voiceOn', '1') === '1';
  // v3 audio tags ([thoughtful], [short pause]) are for ElevenLabs only: never shown or read out by the browser.
  const plain = (t) => String(t || '').replace(/\[(?:[a-z]+(?: [a-z]+){0,2})\]\s*/gi, '').trim();

  // One <audio> element plays every MP3 (unlocked once by a click, so later steps may start on their own).
  const audio = new Audio();
  audio.preload = 'auto';
  const SILENT = (() => {   // 20 ms of silence as a WAV data URI, for unlocking
    const n = 160, b = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
    return 'data:audio/wav;base64,' + btoa(String.fromCharCode(...new Uint8Array(b.buffer)));
  })();
  let unlocked = false;
  function unlock() { if (unlocked) return; unlocked = true; audio.src = SILENT; audio.play().catch(() => {}); }
  // Warm the HTTP cache for upcoming steps (the server marks the MP3s immutable).
  const warm = new Map();
  function preload(url) { if (!url || warm.has(url)) return; const a = new Audio(); a.preload = 'auto'; a.src = url; warm.set(url, a); if (warm.size > 40) warm.delete(warm.keys().next().value); }

  let sayToken = 0;
  let rateSrc = speed;   // where the speed of what's playing now comes from (a player's, or the pref)
  // Speak one chunk with the browser voice; `done` runs once when it ends (not when cancelled by a newer one).
  // rf: a function giving the speed (the player's own, else the voice.speed pref).
  function speak(text, done, rf = speed) {
    const my = ++sayToken;
    rateSrc = rf;
    if (!synth) { setTimeout(() => { if (my === sayToken) done && done(); }, estimate(text, rf())); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(plain(text));
    const v = voice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = rf();
    let fired = false;
    const end = () => { if (fired || my !== sayToken) return; fired = true; clearTimeout(guard); done && done(); };
    u.onend = end; u.onerror = end;
    // Some browsers drop onend; never let a step hang on it.
    const guard = setTimeout(end, estimate(text, rf()) * 2.2 + 4000);
    speak.current = u;    // keep a reference (Chrome can garbage-collect a playing utterance)
    setTimeout(() => { if (my === sayToken) synth.speak(u); }, 60);
  }
  // Play an MP3; `done` when it ends. If it can't play, `fail` (the caller falls back to the browser voice).
  // resume: carry on from where a pause left it instead of starting over.
  function playUrl(url, done, fail, resume, rf = speed) {
    const my = ++sayToken;
    if (synth) synth.cancel();
    const abs = new URL(url, location.href).href;
    if (!resume || audio.src !== abs) { audio.src = abs; }
    rateSrc = rf;
    setRate(rf());
    audio.onended = () => { if (my === sayToken) done && done(); };
    audio.onerror = () => { if (my === sayToken) { console.warn('[board] audio failed, using the browser voice'); fail && fail(); } };
    audio.play().catch((e) => { if (my === sayToken && e.name !== 'AbortError') fail && fail(); });
    return my;
  }
  function hush() { sayToken++; if (synth) synth.cancel(); audio.onended = audio.onerror = null; if (!audio.paused) audio.pause(); }
  const estimate = (text, r = speed()) => (plain(text).split(/\s+/).length / (2.6 * r)) * 1000 + 700;
  // Loading a new src resets playbackRate to defaultPlaybackRate: set both. Pitch stays (no chipmunk voice).
  function setRate(r) {
    try { audio.preservesPitch = true; audio.webkitPreservesPitch = true; audio.defaultPlaybackRate = r; audio.playbackRate = r; } catch {}
  }

  // Audio for a board's steps: { engine, urls (null = no MP3 yet for that step), paidChars, estUsd }.
  // generate: false only asks for what's made (free). With ElevenLabs, `only` says which steps to make now
  // (the one about to play and the next); the local engine makes them all.
  const boardUrls = new Map();
  const boardKey = (b) => b.steps.map((s) => s.say).join('\u0001');
  async function urlsFor(b, generate, opts = {}) {
    const k = `${boardKey(b)}|${opts.engine || ''}`;
    const have = boardUrls.get(k);
    const need = opts.only || b.steps.map((_, i) => i);
    if (have && (!generate || need.every((i) => i >= b.steps.length || have.urls[i]))) return have;
    const d = await Q.api('api/voice/board', { steps: b.steps.map((s) => s.say), generate, only: opts.only, engine: opts.engine || undefined });
    noteCapAlert(d);
    const out = d.voice ? { engine: d.engine, urls: d.urls.map((u, i) => u || (have && have.urls[i]) || null), paidChars: d.paidChars || 0, estUsd: d.estUsd || 0 }
      : { engine: null, urls: b.steps.map(() => null), paidChars: 0, estUsd: 0 };
    boardUrls.set(k, out);
    if (generate && out.engine === 'elevenlabs') setTimeout(() => natStatus(true), 3000);   // the month's usage moved
    return out;
  }

  // ---------- the scene ----------

  const clone = (o) => JSON.parse(JSON.stringify(o));
  // The board as it stands after step k: elements, code highlights, and what step k itself did.
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
  function heightOf(b) {
    let h = 3;
    const els = new Map();
    for (const st of b.steps) for (const o of st.draw) {
      if (o.op === 'remove') els.delete(o.id);
      else if (o.op === 'set' && o.h && els.get(o.id)) els.get(o.id).h = o.h;
      else if (o.h !== undefined && o.op !== 'set') els.set(o.id, { ...o });
      for (const e of els.values()) if (e.y !== undefined) h = Math.max(h, e.y + e.h);
    }
    return h;
  }

  const TONE = { blue: '--blue', green: '--green', orange: '--orange', red: '--red', purple: '--purple', teal: '--teal' };
  const ink = (t) => (TONE[t] ? `var(${TONE[t]})` : 'var(--label-3)');
  const paper = (t) => (TONE[t] ? `color-mix(in srgb, var(${TONE[t]}) 9%, var(--surface))` : 'var(--surface)');
  const rr = (x, y, w, h, r = 12) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
  const T = (s) => esc(String(s ?? ''));
  function wrap(text, w) {
    const per = Math.max(4, Math.floor(w * 11));
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        if (line && line.length + 1 + word.length > per) { out.push(line); line = word; } else line += (line ? ' ' : '') + word;
      }
      out.push(line);
    }
    return out;
  }

  function drawEl(e, sc, isNew, delay) {
    const x = e.x * U, y = e.y * U, w = e.w * U, h = e.h * U;
    const tone = ink(e.tone);
    const g = (body) => `<g class="el ${e.op}${isNew ? ' new' : ''}" data-id="${T(e.id)}" style="--d:${delay}s">${body}</g>`;
    const mark = sc.marks.has(e.id) ? `<path class="mark" d="${rr(x - 7, y - 7, w + 14, h + 14, 16)}"/>` : '';
    if (e.op === 'box') {
      const rows = e.rows || [];
      let body = `<path class="fade" d="${rr(x, y, w, h)}" style="fill:${paper(e.tone)}"/>`;
      if (!rows.length) {
        body += `<text class="lbl fade" x="${x + w / 2}" y="${y + h / 2 + 7}" text-anchor="middle" data-fit="${w - 20}">${T(e.label)}</text>`;
      } else {
        const top = (e.label ? S.head : S.pad) * U;
        if (e.label) body += `<text class="lbl fade" x="${x + w / 2}" y="${y + 0.38 * U}" text-anchor="middle" data-fit="${w - 20}">${T(e.label)}</text>`
          + `<path class="fade" d="M${x} ${y + top}H${x + w}" style="stroke:${tone};stroke-opacity:.35;stroke-width:1.5"/>`;
        rows.forEach((r, i) => {
          const ry = y + top + i * S.row * U;
          if (sc.changed.has(`${e.id}:${i}`)) body += `<rect class="flash" x="${x + 4}" y="${ry + 2}" width="${w - 8}" height="${S.row * U - 4}" rx="6"/>`;
          if (i) body += `<path class="sep fade" d="M${x + 12} ${ry}H${x + w - 12}"/>`;
          body += `<text class="row fade" x="${x + 16}" y="${ry + 0.28 * U}" style="animation-delay:calc(var(--d) + ${0.45 + i * 0.1}s * var(--k, 1))" data-fit="${w - 28}">${T(r)}</text>`;
        });
      }
      body += `<path class="ink" pathLength="1" d="${rr(x, y, w, h)}" style="fill:none;stroke:${tone};stroke-width:2"/>`;
      return g(body + mark);
    }
    if (e.op === 'code') {
      const line = sc.lines[e.id];
      let body = `<path class="fade" d="${rr(x, y, w, h, 10)}" style="fill:var(--surface-2)"/>`;
      if (line) {
        const ly = y + S.pad * U + (line - 1) * S.code * U;
        body += `<rect class="hl${sc.changed.has(`${e.id}:L`) ? ' flash' : ''}" x="${x + 2}" y="${ly}" width="${w - 4}" height="${S.code * U}"/><rect class="hlbar" x="${x + 2}" y="${ly}" width="4" height="${S.code * U}"/>`;
      }
      e.lines.forEach((l, i) => {
        const ly = y + S.pad * U + i * S.code * U + 0.25 * U;
        body += `<text class="ln mono fade" x="${x + 30}" y="${ly}" text-anchor="end">${i + 1}</text>`
          + `<text class="mono fade" x="${x + 42}" y="${ly}" xml:space="preserve" style="font-size:16px;white-space:pre;animation-delay:calc(var(--d) + ${0.3 + i * 0.06}s * var(--k, 1))" data-fit="${w - 52}">${T(l)}</text>`;
      });
      body += `<path class="ink" pathLength="1" d="${rr(x, y, w, h, 10)}" style="fill:none;stroke:var(--separator-strong);stroke-width:1.5"/>`;
      return g(body + mark);
    }
    if (e.op === 'table') {
      const ncol = e.rows[0].length, cw = w / ncol, rh = S.row * U;
      let body = `<path class="fade" d="${rr(x, y, w, h, 8)}" style="fill:${paper(e.tone)}"/>`;
      let ry = y;
      if (e.cols) {
        body += `<path class="fade" d="M${x} ${y + rh}H${x + w}" style="stroke:${tone};stroke-opacity:.5;stroke-width:1.5"/>`;
        e.cols.forEach((c, i) => { body += `<text class="hd fade" x="${x + i * cw + cw / 2}" y="${y + rh * 0.66}" text-anchor="middle" data-fit="${cw - 10}">${T(c)}</text>`; });
        ry += rh;
      }
      e.rows.forEach((r, ri) => {
        const yy = ry + ri * rh;
        if (ri) body += `<path class="sep fade" d="M${x} ${yy}H${x + w}"/>`;
        r.forEach((c, ci) => {
          if (sc.changed.has(`${e.id}:${ri}:${ci}`)) body += `<rect class="flash" x="${x + ci * cw + 3}" y="${yy + 3}" width="${cw - 6}" height="${rh - 6}" rx="5"/>`;
          body += `<text class="mono fade" x="${x + ci * cw + cw / 2}" y="${yy + rh * 0.66}" text-anchor="middle" style="font-size:16px" data-fit="${cw - 10}">${T(c)}</text>`;
        });
      });
      for (let i = 1; i < ncol; i++) body += `<path class="sep fade" d="M${x + i * cw} ${y}V${y + h}"/>`;
      body += `<path class="ink" pathLength="1" d="${rr(x, y, w, h, 8)}" style="fill:none;stroke:${TONE[e.tone] ? tone : 'var(--separator-strong)'};stroke-width:1.5"/>`;
      return g(body + mark);
    }
    if (e.op === 'text') {
      const body = wrap(e.text, e.w).map((l, i) => `<text class="note fade" x="${x}" y="${y + 0.25 * U + i * S.text * U}" style="animation-delay:calc(var(--d) + ${0.1 + i * 0.08}s * var(--k, 1))">${T(l)}</text>`).join('');
      return g(body + mark);
    }
    return '';
  }

  // Where a line from rect a's centre toward b's centre leaves a (plus a small gap).
  function edge(a, b, gap) {
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy;
    const t = Math.min(dx ? (a.w / 2) / Math.abs(dx) : Infinity, dy ? (a.h / 2) / Math.abs(dy) : Infinity);
    const len = Math.hypot(dx, dy) || 1;
    return { x: cx + dx * t + (dx / len) * gap, y: cy + dy * t + (dy / len) * gap };
  }
  function drawArrow(e, sc, isNew, delay) {
    const A = sc.els.get(e.from), B = sc.els.get(e.to);
    if (!A || !B) return '';
    const px = (r) => ({ x: r.x * U, y: r.y * U, w: r.w * U, h: r.h * U });
    const a = px(A), b = px(B);
    const p1 = edge(a, b, 6), p2 = edge(b, a, 8);
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x), s = 12;
    const head = `M${p2.x} ${p2.y}L${p2.x - s * Math.cos(ang - 0.45)} ${p2.y - s * Math.sin(ang - 0.45)}L${p2.x - s * Math.cos(ang + 0.45)} ${p2.y - s * Math.sin(ang + 0.45)}Z`;
    const color = TONE[e.tone] ? ink(e.tone) : 'var(--label-2)';
    let body = e.dashed
      ? `<path class="fade" style="--e:0s;fill:none;stroke:${color};stroke-width:2;stroke-dasharray:7 6" d="M${p1.x} ${p1.y}L${p2.x} ${p2.y}"/>`
      : `<path class="ink" pathLength="1" style="fill:none;stroke:${color};stroke-width:2" d="M${p1.x} ${p1.y}L${p2.x} ${p2.y}"/>`;
    body += `<path class="fade" d="${head}" style="fill:${color}"/>`;
    if (e.label) {
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, lw = e.label.length * 7.6 + 14;
      body += `<rect class="fade" x="${mx - lw / 2}" y="${my - 12}" width="${lw}" height="24" rx="12" style="fill:var(--surface)"/>`
        + `<text class="alb fade" x="${mx}" y="${my + 5}" text-anchor="middle">${T(e.label)}</text>`;
    }
    return `<g class="el arrow${isNew ? ' new' : ''}" style="--d:${delay}s">${body}</g>`;
  }

  // pc (boards.pace): 'fast' staggers and draws ~3× quicker (with .bd.fast), 'instant' shows the step at once.
  function drawScene(b, k, animate, H, pc = 'voice') {
    const sc = k < 0 ? { els: new Map(), lines: {}, added: [], marks: new Set(), changed: new Set() } : sceneAt(b, k);
    const fresh = animate && !reduced() && pc !== 'instant' ? sc.added : [];
    const gap = pc === 'fast' ? 0.12 : 0.35;
    const delayOf = (id) => { const i = fresh.indexOf(id); return i < 0 ? 0 : i * gap; };
    if (!animate) { sc.marks.clear(); sc.changed.clear(); }
    let shapes = '', arrows = '';
    for (const e of sc.els.values()) {
      const isNew = fresh.includes(e.id);
      if (e.op === 'arrow') arrows += drawArrow(e, sc, isNew, delayOf(e.id));
      else shapes += drawEl(e, sc, isNew, delayOf(e.id));
    }
    // Arrows under the shapes' text would hide labels; draw shapes first, arrows on top (they end at the edges).
    return { svg: `<svg viewBox="${-PAD} ${-PAD} ${COLS * U + PAD * 2} ${H * U + PAD * 2}" role="img">${shapes}${arrows}</svg>`, ms: fresh.length ? (fresh.length - 1) * gap * 1000 + (pc === 'fast' ? 420 : 1100) : 300 };
  }

  // Squeeze any text that came out wider than its slot (the server's character estimate is rough).
  function fitText(svg) {
    svg.querySelectorAll('text[data-fit]').forEach((t) => {
      const max = Number(t.dataset.fit);
      try { if (t.getComputedTextLength() > max) { t.setAttribute('textLength', max); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); } } catch {}
    });
  }

  // ---------- the player ----------

  // ---------- his drawings ----------
  // What he drew on a board survives re-renders of the lesson stream (kept per board, in memory),
  // and the drawing that hasn't been sent yet is offered to the next message (Quiz.board.drawing).
  const learnerCache = new Map();   // boardKey → Excalidraw elements he drew
  const sentSig = new Map();        // boardKey → signature of the drawing already sent (or dismissed)
  const sigOf = (els) => els.map((e) => `${e.id}:${e.version}`).join('|');
  let lastDrawn = null;             // boardKey of the board he drew on last
  const drawSubs = new Set();
  const drawEmit = () => drawSubs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  const liveCanvasFor = (key) => [...players].find((p) => p.key === key && p.canvas() && p.root.isConnected);
  const drawing = {
    // { title } of the board with an unsent drawing, or null.
    pending() {
      if (!lastDrawn) return null;
      const els = learnerCache.get(lastDrawn) || [];
      if (!els.length || sigOf(els) === sentSig.get(lastDrawn) || !liveCanvasFor(lastDrawn)) return null;
      return { key: lastDrawn, title: liveCanvasFor(lastDrawn).title };
    },
    // { scene: describe(), png?: base64 } for the request; png only when he drew freehand strokes.
    async collect() {
      const pd = drawing.pending();
      if (!pd) return null;
      const cv = liveCanvasFor(pd.key).canvas();
      const scene = cv.describe();
      // His part: shapes/text/strokes in `learner`, his arrows in `arrows` (by: 'learner').
      if (!(scene.learner || []).length && !(scene.arrows || []).some((a) => a.by === 'learner')) return null;
      const out = { key: pd.key, sig: sigOf(learnerCache.get(pd.key) || []), scene };
      if ((scene.learner || []).some((x) => x.kind === 'freehand')) {
        for (const maxSize of [1600, 1100, 800]) {
          try {
            const blob = await cv.snapshotPng({ maxSize });
            if (blob.size > 300 * 1024) continue;
            out.png = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
            break;
          } catch (e) { console.warn('[board] snapshot failed', e); break; }
        }
      }
      return out;
    },
    // It went out with a message (or he said not to send it): don't offer it again until he draws more.
    sent(c) { if (c && c.key) { sentSig.set(c.key, c.sig); drawEmit(); } },
    dismiss() { if (lastDrawn) { sentSig.set(lastDrawn, sigOf(learnerCache.get(lastDrawn) || [])); drawEmit(); } },
    onChange(f) { drawSubs.add(f); return () => drawSubs.delete(f); },
  };

  const players = new Set();
  function stopAll(except) { for (const p of players) if (p !== except) p.pause(); if (!except) { hush(); reading(null); } }
  function stopDetached() { for (const p of [...players]) if (!p.root.isConnected) { p.pause(); p.dispose(); players.delete(p); } if (readBtn && !readBtn.isConnected) { hush(); reading(null); } drawEmit(); }

  function mount(host, b, opts = {}) {
    const N = b.steps.length;
    const H = heightOf(b);
    const root = el(`<div class="bd" tabindex="0" aria-label="Board: ${T(b.title || 'explanation')}">
      <div class="bd-head">${icon('board')}<span class="bd-title">${T(b.title || 'On the board')}</span>
        <button type="button" class="bd-hb" data-a="expand" aria-label="Full screen" title="Full screen, to draw comfortably" hidden>${icon('expand')}</button></div>
      <div class="bd-stage"><div class="bd-svg"></div>
        <button type="button" class="bd-cover" aria-label="Play the board"><span><i>${icon('play')}</i><b class="bd-cover-l">Play</b><small class="bd-len">${N} steps</small><small class="bd-cost" hidden></small></span></button></div>
      <div class="bd-cap idle"></div>
      <div class="bd-ctrl">
        <button type="button" class="bd-b" data-a="prev" aria-label="Previous step" title="Previous step">${icon('skip-back')}</button>
        <button type="button" class="bd-b play" data-a="play" aria-label="Play" title="Play (space)">${icon('play')}</button>
        <button type="button" class="bd-b" data-a="next" aria-label="Next step" title="Next step">${icon('skip-forward')}</button>
        <div class="bd-prog" role="group" aria-label="Steps">${b.steps.map((_, i) => `<button type="button" data-step="${i}" aria-label="Step ${i + 1}" title="Step ${i + 1}"></button>`).join('')}</div>
        <button type="button" class="bd-b speed" data-a="speed" title="Speed">1×</button>
        <button type="button" class="bd-b" data-a="voice" aria-label="Voice" title="Voice on or off"></button>
        ${opts.menu ? `<button type="button" class="bd-b" data-a="more" aria-label="Board settings" title="Drawing and voice" aria-haspopup="menu">${icon('ellipsis')}</button>` : ''}
      </div>
      <details class="bd-tr"><summary>${icon('chevron-right')}Transcript</summary><ol>${b.steps.map((s, i) => `<li data-step="${i}">${T(plain(s.say))}</li>`).join('')}</ol></details>
    </div>`);
    host.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const stage = $('.bd-svg'), cap = $('.bd-cap'), cover = $('.bd-cover');
    let idx = N - 1, playing = false, started = false, token = 0, timers = [];
    let urls = null;          // MP3 per step, null entries → not made yet (ElevenLabs) or browser voice
    let engine = null;        // the engine those MP3s come from ('local' | 'elevenlabs')
    let paidLeft = 0;         // ElevenLabs characters still to pay for on this board (shown before Play)
    let override = null;      // 'elevenlabs': this one board plays with the premium voice
    let held = null;          // { idx, after } a step whose MP3 was paused midway: Play resumes it
    const key = boardKey(b);
    const prate = () => rateOverride.get(key) ?? speed();   // this board's speed
    let mode = renderer();    // 'canvas' | 'svg'
    let cv = null, cvP = null, cvHost = null, io = null, scrim = null;
    let touched = false;      // he has used the canvas: the big Play cover stays out of his way

    // The SVG renderer: the whole drawing, repainted each step. Returns how long the drawing animates (ms).
    function paintSvg(k, animate) {
      const { svg, ms } = drawScene(b, k, animate, H, pace());
      stage.innerHTML = svg;
      fitText(stage.firstElementChild);
      return ms;
    }
    // The canvas renderer: mounted the first time the board comes near the screen (or is played).
    function startCanvas() {
      if (cvP) return cvP;
      const host = cvHost;
      cvP = loadCanvas().then((C) => {
        if (mode !== 'canvas' || cvHost !== host) return null;
        const inner = document.createElement('div');
        inner.className = 'bd-cv-x';
        host.appendChild(inner);
        cv = C.mount(inner, {
          lesson: true,
          learner: learnerCache.get(key),
          onChange: (c) => { const els = c.learnerElements(); learnerCache.set(key, els); if (els.length) lastDrawn = key; drawEmit(); },
        });
        return cv.play(b, { at: started ? idx : N - 1, animate: false }).then(() => { const l = host.querySelector('.bd-cv-load'); if (l) l.hidden = true; return cv; });
      }).catch((e) => {
        console.warn('[board] canvas unavailable, using the simple drawing:', e.message);
        if (cvHost === host) { mode = 'svg'; cvHost = null; cvP = null; buildStage(); }
        return null;
      });
      return cvP;
    }
    function dropCanvas() {
      if (io) { io.disconnect(); io = null; }
      if (cv) { const els = cv.learnerElements(); if (els.length) learnerCache.set(key, els); cv.dispose(); }
      cv = null; cvP = null; cvHost = null;
      if (root.classList.contains('expanded')) expand(false);
    }
    // (Re)build the stage for the current renderer, showing step idx (or the finished board).
    function buildStage() {
      dropCanvas();
      root.classList.toggle('cv', mode === 'canvas');
      $('[data-a=expand]').hidden = mode !== 'canvas';
      if (mode === 'svg') { paintSvg(started ? idx : N - 1, false); return; }
      stage.innerHTML = '';
      cvHost = el(`<div class="bd-cv" style="--bd-ar:${(H / COLS).toFixed(3)}"><div class="bd-cv-load"><span class="activity"></span></div>
        <div class="bd-zoom" role="group" aria-label="Zoom"><button type="button" data-z="out" aria-label="Zoom out" title="Zoom out">${icon('minus')}</button><button type="button" data-z="in" aria-label="Zoom in" title="Zoom in">${icon('plus')}</button><button type="button" data-z="fit" aria-label="Fit the board" title="Fit the board">${icon('fit')}</button></div></div>`);
      cvHost.addEventListener('pointerdown', () => { if (!touched) { touched = true; sync(); } }, true);
      if ((learnerCache.get(key) || []).length) touched = true;
      cvHost.querySelector('.bd-zoom').onclick = (e) => {
        const z = e.target.closest('[data-z]');
        if (!z || !cv) return;
        if (z.dataset.z === 'fit') cv.fit(); else cv.zoomBy(z.dataset.z === 'in' ? 1.2 : 1 / 1.2);
      };
      stage.appendChild(cvHost);
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); io = null; startCanvas(); } }, { rootMargin: '300px 0px' });
      io.observe(cvHost);
    }
    // Show step k. SVG: returns the drawing's duration (ms). Canvas: a promise, settled when the step is drawn.
    function paint(k, animate) {
      if (mode === 'svg') return paintSvg(k, animate);
      return startCanvas().then((c) => c && c.goTo(k, { animate, pace: pace() }));
    }
    function expand(on) {
      root.classList.toggle('expanded', on);
      const btn = $('[data-a=expand]');
      btn.innerHTML = icon(on ? 'shrink' : 'expand');
      btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      btn.title = on ? 'Exit full screen (Esc)' : 'Full screen, to draw comfortably';
      if (on && !scrim) { scrim = el('<div class="bd-scrim"></div>'); scrim.onclick = () => expand(false); root.before(scrim); document.addEventListener('keydown', escKey, true); }
      if (!on && scrim) { scrim.remove(); scrim = null; document.removeEventListener('keydown', escKey, true); }
      if (cv) requestAnimationFrame(() => requestAnimationFrame(() => cv && cv.fit()));
    }
    function escKey(e) { if (e.key === 'Escape' && !e.defaultPrevented && !(e.target.closest && e.target.closest('.excalidraw textarea'))) { e.stopPropagation(); expand(false); } }
    function sync() {
      const pb = $('[data-a=play]');
      pb.innerHTML = icon(playing ? 'pause' : 'play');
      pb.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      pb.classList.toggle('play', !playing);
      $('[data-a=prev]').disabled = !started || idx <= 0;
      $('[data-a=next]').disabled = !started || idx >= N - 1;
      root.querySelectorAll('.bd-prog button').forEach((x, i) => { x.classList.toggle('on', started && i <= idx); x.classList.toggle('cur', started && i === idx); });
      root.querySelectorAll('.bd-tr li').forEach((x, i) => x.classList.toggle('cur', started && i === idx));
      const sb = $('[data-a=speed]');
      sb.textContent = fmtRate(prate());
      sb.title = rateOverride.has(key) ? `Speed for this board (default ${fmtRate(speed())} in Settings)` : 'Speed (default from Settings)';
      root.classList.toggle('fast', pace() === 'fast');
      $('.bd-len').textContent = `${N} steps · about ${Math.max(1, Math.round(b.steps.reduce((t, s) => t + estimate(s.say, prate()), 0) / 60000))} min`;
      const vb = $('[data-a=voice]');
      vb.innerHTML = icon(voiceOn() ? 'speaker' : 'speaker-off');
      vb.disabled = !canSpeak();
      vb.setAttribute('aria-pressed', String(voiceOn()));
      cover.hidden = started || (mode === 'canvas' && touched);
      $('.bd-cover-l').textContent = voiceOn() ? 'Play with voice' : 'Play';
      // Paid audio not made yet: say what Play will cost before he presses it.
      const cost = natural() && voiceOn() && engine === 'elevenlabs' && paidLeft > 0 ? `Premium voice · ~${kchars(paidLeft)} chars` : '';
      $('.bd-cost').textContent = cost;
      $('.bd-cost').hidden = !cost;
      cap.classList.toggle('idle', !started);
      cap.classList.toggle('keep', !started && !!cost && cover.hidden);   // a cost note, not a caption: shown with captions off too
      if (!started) cap.textContent = b.steps[0] ? `The finished board. Press play to watch it built step by step${mode === 'canvas' ? ', or draw on it' : ''}.${cost && cover.hidden ? ` ${cost} (made step by step as it plays).` : ''}` : '';
    }
    function clear() { token++; timers.forEach(clearTimeout); timers = []; }
    function take(d) { urls = d.urls; engine = d.engine; paidLeft = d.paidChars; }
    // The MP3 for step k. With ElevenLabs, asks for k and k + 1 when either isn't made yet (never the whole board).
    async function stepUrl(k) {
      if (urls && urls[k] && (engine !== 'elevenlabs' || k + 1 >= N || urls[k + 1])) return urls[k];
      const paid = override === 'elevenlabs' || (engine || (nat && nat.engine)) === 'elevenlabs';
      take(await urlsFor(b, true, { engine: override, only: paid ? [k, k + 1] : undefined }));
      return urls[k];
    }
    // Narrate step k: its MP3 when there is one, else the browser voice, else a reading-time pause.
    function narrate(k, done) {
      const say = b.steps[k].say;
      if (!voiceOn()) { timers.push(setTimeout(done, estimate(say, prate()))); return; }
      if (!natural()) { speak(say, done, prate); return; }
      const my = token;
      stepUrl(k).then((url) => {
        if (my !== token) return;
        if (url) playUrl(url, done, () => speak(say, done, prate), false, prate); else speak(say, done, prate);
        if (urls && urls[k + 1]) preload(urls[k + 1]);
        sync();
      }).catch(() => { if (my === token) speak(say, done, prate); });
    }
    // Show step k (animated), and when playing, narrate it and move on when both drawing and voice are done.
    function go(k) {
      clear();
      held = null;
      if (playing || voiceOn()) hush();
      started = true;
      idx = Math.max(0, Math.min(N - 1, k));
      const drawP = paint(idx, true);
      cap.textContent = plain(b.steps[idx].say);
      sync();
      if (!playing) return;
      const my = token;
      let drawn = false, said = false;
      const next = () => {
        if (my !== token || !drawn || !said) return;
        if (!root.isConnected) { pause(); return; }
        held = null;
        if (idx < N - 1) timers.push(setTimeout(() => { if (my === token) go(idx + 1); }, 450));
        else { playing = false; sync(); }
      };
      // The next step waits for both: the drawing (its fixed duration, or the canvas saying it's done) and the voice.
      if (typeof drawP === 'number') timers.push(setTimeout(() => { drawn = true; next(); }, drawP));
      else drawP.then(() => { if (my === token) { drawn = true; next(); } });
      held = { idx, said: () => { said = true; next(); } };
      narrate(idx, held.said);
    }
    // Pick up a step whose MP3 was paused midway (the drawing has finished by now).
    function resume() {
      clear();
      const my = token;
      const k = idx;
      const after = () => {
        if (my !== token) return;
        held = null;
        if (k < N - 1) timers.push(setTimeout(() => { if (my === token) go(k + 1); }, 450));
        else { playing = false; sync(); }
      };
      held = { idx: k, said: after, mid: false };
      playUrl(urls[k], after, () => speak(b.steps[k].say, after, prate), true, prate);
      sync();
    }
    async function play() {
      stopAll(api);
      hush(); reading(null);
      unlock();    // inside the click: later steps may start their audio on their own
      playing = true;
      sync();
      if (held && held.mid && started && natural() && urls && urls[held.idx] && voiceOn()) { resume(); return; }
      const from = !started || idx >= N - 1 ? 0 : idx;
      if (natural() && voiceOn() && !(urls && urls[from])) {
        const my = token;
        cover.classList.add('busy');
        // Local: the whole board (free, usually made already). ElevenLabs: this step and the next only.
        const paid = override === 'elevenlabs' || (engine || (nat && nat.engine)) === 'elevenlabs';
        try { take(await urlsFor(b, true, { engine: override, only: paid ? [from, from + 1] : undefined })); } catch {}
        cover.classList.remove('busy');
        if (my !== token || !playing) return;
        if (urls) urls.slice(from, from + 2).forEach(preload);
      }
      go(from);
    }
    function pause() {
      if (playing) {
        playing = false;
        // An MP3 can stop mid-sentence and carry on later; the browser voice can't (it restarts the step).
        const mid = held && natural() && urls && urls[held.idx] && audio.src && !audio.paused && !audio.ended;
        clear(); hush();
        if (held) held.mid = !!mid;
      }
      sync();
    }
    const api = {
      root, key, pause, play, sync, title: b.title || 'the board',
      reset() { urls = null; engine = null; paidLeft = 0; held = null; lookup(); sync(); },
      get override() { return override; },
      get paidLeft() { return engine === 'elevenlabs' ? paidLeft : null; },
      // Premium voice (ElevenLabs) for this one board while the free voice is the default; null: back to the default.
      premium(on) { pause(); override = on ? 'elevenlabs' : null; urls = null; engine = null; held = null; lookup().then(() => { if (on) play(); }); },
      canvas: () => cv,
      get mode() { return mode; },
      setMode(m) { if (m === mode) return; mode = m; buildStage(); sync(); },
      // boards.font changed: the canvas redraws itself (ui/canvas.js); boards.pace / voice.speed: sync() shows them.
      rate: prate,
      dispose() { dropCanvas(); },
    };
    players.add(api);

    cover.onclick = play;
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      const st = e.target.closest('[data-step]');
      if (st) { go(Number(st.dataset.step)); return; }
      if (!a) return;
      const act = a.dataset.a;
      if (act === 'play') playing ? pause() : play();
      else if (act === 'expand') expand(!root.classList.contains('expanded'));
      else if (act === 'prev') go(idx - 1);
      else if (act === 'next') go(idx + 1);
      else if (act === 'speed') {
        // Cycle through the speeds (and the Settings default); back at the default, the board follows Settings again.
        const list = [...new Set([...RATES, speed()])].sort((x, y) => x - y);
        const cur = prate();
        const nxt = list[(list.findIndex((r) => Math.abs(r - cur) < 1e-6) + 1) % list.length];
        if (Math.abs(nxt - speed()) < 1e-6) rateOverride.delete(key); else rateOverride.set(key, nxt);
        if (playing && !audio.paused && rateSrc === prate) setRate(prate());   // an MP3 changes speed in place
        sync();
      }
      else if (act === 'voice') { setPref('board.voiceOn', voiceOn() ? '0' : '1'); if (!voiceOn()) hush(); sync(); if (playing) go(idx); }
      else if (act === 'more' && opts.menu) voiceMenu(a, opts.menu, () => { urls = null; held = null; if (playing) play(); else sync(); }, api);
    });
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('summary, li, .bd-cv')) return;   // keys inside the canvas are Excalidraw's
      if (e.key === ' ' && e.target === root) { e.preventDefault(); playing ? pause() : play(); }
      else if (e.key === 'ArrowRight' && started) { e.preventDefault(); go(idx + 1); }
      else if (e.key === 'ArrowLeft' && started) { e.preventDefault(); go(idx - 1); }
    });

    // Audio made ahead (the local voice, right after the teacher's turn) costs nothing to look up: then Play
    // starts at once. With ElevenLabs it also tells what Play would cost (shown on the cover).
    function lookup() {
      return natStatus().then(() => {
        sync();
        if (natural() && !urls) return urlsFor(b, false, { engine: override }).then((d) => { if (!urls) { take(d); sync(); } }).catch(() => {});
      });
    }
    buildStage();
    sync();
    lookup();
    return api;
  }

  // ---------- voice menu (••• on a board) ----------

  const money = (n) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(n < 10 ? 2 : 0)}`);
  // "This month: 12,400 chars · ~$1.10 of $5"
  function usageLine(s) {
    const m = s.month;
    return `This month: ${m.chars.toLocaleString()} chars · ~${money(m.estUsd)} of $${m.cap}`;
  }
  function refreshPlayers() { boardUrls.clear(); for (const p of players) p.reset(); }

  // The drawing renderer for every board: the boards.renderer pref (players follow it on quiz:prefs, below).
  function setRenderer(m) {
    for (const p of players) p.setMode(rendererFor(m));   // at once; the pref round trip confirms it
    drawEmit();
    const p = P();
    if (p) p.set({ 'boards.renderer': m }).catch((e) => Q.showToast && Q.showToast(`Couldn't save the drawing choice: ${e.message}`));
  }

  async function voiceMenu(anchor, menu, changed, player) {
    const s = await natStatus(true);
    const mode = player ? player.mode : renderer();
    const items = [
      { label: 'Hand-drawn canvas (Excalidraw)', icon: mode === 'canvas' ? 'check' : 'pencil', run: () => setRenderer('canvas') },
      { label: 'Simple drawing', icon: mode === 'svg' ? 'check' : 'board', run: () => setRenderer('svg') },
      '-',
    ];
    const useNat = natural();
    const settingsItem = { label: 'Voice settings…', icon: 'gear', run: () => Q.settings && Q.settings.open() };
    if (s && s.engine) {
      if (s.engine === 'local') {
        // The free local voice (s.local.where: on this Mac / on this server): its voices, a sample when he picks one.
        const cur = s.local && s.local.voice && s.local.voice.id;
        for (const v of (s.local && s.local.voices) || []) items.push({
          label: `${v.name} · ${v.note.replace(/ · default$/, '')}`,
          icon: useNat && v.id === cur ? 'check' : 'speaker',
          run: async () => {
            stopAll();
            setPref('board.engine', 'natural');
            try { await Q.api('api/voice/local-voice', { voice: v.id }); } catch (e) { Q.showToast && Q.showToast(`Couldn't save the voice: ${e.message}`); return; }
            await natStatus(true);
            refreshPlayers();
            try { const d = await Q.api('api/voice/preview', { voice: v.id }); playUrl(d.url, null, null); } catch { changed(); }
          },
        });
        // One board with the paid voice, while the free one stays the default.
        if (player && s.configured && s.usable) {
          items.push('-', player.override
            ? { label: 'Back to the free voice for this board', icon: 'speaker', run: () => { stopAll(); player.premium(false); } }
            : { label: 'Play with premium voice (ElevenLabs)', icon: 'sparkles', run: () => { stopAll(); setPref('board.engine', 'natural'); player.premium(true); } });
          if (player.override && player.paidLeft) items.push({ label: `Still to make: ~${kchars(player.paidLeft)} chars`, icon: 'info', disabled: true, run() {} });
        }
      } else {
        let list = [];
        try { list = (await Q.api('api/voice/voices')).voices || []; } catch {}
        const cur = s.voice && s.voice.id;
        // English narrators first (the teacher speaks English), then the rest; at most 12.
        const rank = (v) => (/narrat|educat|inform/i.test(JSON.stringify(v.labels)) ? 2 : 0) + (/^(american|british|australian|irish)/i.test(v.labels.accent || '') ? 1 : 0) + (v.id === cur ? 5 : 0);
        list = list.slice().sort((a, b2) => rank(b2) - rank(a)).slice(0, 12);
        for (const v of list) {
          const tag = [v.labels.accent, v.labels.descriptive || v.labels.description].filter(Boolean).join(', ');
          items.push({
            label: `${v.name}${tag ? ` · ${tag}` : ''}`,
            icon: useNat && v.id === cur ? 'check' : 'speaker',
            run: async () => {
              stopAll();
              setPref('board.engine', 'natural');
              try { await Q.api('api/voice/config', { voiceId: v.id }); } catch (e) { Q.showToast && Q.showToast(`Couldn't save the voice: ${e.message}`); return; }
              await natStatus(true);
              refreshPlayers();
              if (v.preview_url) playUrl(v.preview_url, null, null); else changed();
            },
          });
        }
        if (!list.length) items.push({ label: 'Couldn’t load ElevenLabs voices', icon: 'warning', disabled: true, run() {} });
      }
      items.push('-', {
        label: useNat ? 'Use the browser voice instead' : `Use the natural voice (${s.engine === 'local' ? `free, ${(s.local && s.local.where) || 'on this computer'}` : 'ElevenLabs'})`,
        icon: useNat ? 'speaker-off' : 'sparkles',
        run: () => { stopAll(); setPref('board.engine', useNat ? 'browser' : 'natural'); refreshPlayers(); changed(); },
      });
      if (!useNat) {
        loadVoices();
        const bv = voice();
        if (bv) items.push({ label: `Browser voice: ${bv.name.replace(/\s*\(.*\)$/, '')}`, icon: 'info', disabled: true, run() {} });
      }
      items.push(settingsItem);
      if (s.fallback) items.push({ label: s.fallback, icon: 'info', disabled: true, run() {} });
      if (s.configured) items.push('-', { label: usageLine(s), icon: 'chart', disabled: true, run() {} });
      if (s.configured && s.engine === 'elevenlabs' && s.subscription && s.subscription.limit) items.push({ label: `ElevenLabs plan: ${s.subscription.used.toLocaleString()} of ${s.subscription.limit.toLocaleString()} credits`, icon: 'info', disabled: true, run() {} });
      if (s.reason === 'cap') items.push({ label: 'Budget reached: new audio uses the free voice', icon: 'warning', disabled: true, run() {} });
      else if (s.lastError) items.push({ label: `Last error: ${s.lastError.message}`, icon: 'warning', disabled: true, run() {} });
    } else {
      loadVoices();
      const list = englishVoices().slice(0, 10);
      const cur = voice();
      for (const v of list) items.push({
        label: `${v.name.replace(/\s*\(.*\)$/, '')}${/premium|enhanced/i.test(v.name) ? ' ✦' : ''} · ${v.lang}`,
        icon: cur && v.name === cur.name ? 'check' : 'speaker',
        run: () => { setPref('board.voice', v.name); hush(); speak('This is how I sound.', changed); },
      });
      if (!items.length) items.push({ label: 'No English voices found', icon: 'info', disabled: true, run() {} });
      items.push('-', { label: 'Get better voices…', icon: 'external', run: () => Q.showToast && Q.showToast('System Settings → Accessibility → Spoken Content → System voice → Manage Voices: download a Premium English voice, then reload.') });
      if (s && s.local && !s.local.installed) items.push({ label: 'Free natural voice: install it…', icon: 'sparkles', run: () => Q.showToast && Q.showToast(`In Terminal, in the quiz app folder (~/learning-quiz on homebox): ${s.local.installCmd} (about 1 GB, once). Then reopen this menu.`) });
      items.push(settingsItem);
    }
    menu(anchor, items);
  }

  // ---------- read a teacher reply aloud ----------

  let readBtn = null;
  function reading(btn, label) {
    if (readBtn && readBtn !== btn) { readBtn.classList.remove('on', 'busy'); readBtn.setAttribute('aria-pressed', 'false'); const l = readBtn.querySelector('span'); if (l) l.textContent = 'Read aloud'; }
    readBtn = btn;
    if (btn) { btn.classList.add('on'); btn.classList.toggle('busy', label === 'busy'); btn.setAttribute('aria-pressed', 'true'); const l = btn.querySelector('span'); if (l) l.textContent = label === 'busy' ? 'Preparing voice…' : 'Stop reading'; }
  }
  // Markdown to something worth hearing: code blocks are announced, not read symbol by symbol.
  function spoken(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' (see the code block) ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*|__|[*_#>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*[-•]\s+/gm, '')
      .replace(/\s+/g, ' ').trim();
  }
  // The browser voice, sentence group by sentence group (long single utterances get cut off in some browsers).
  function readWithBrowser(text, btn) {
    if (!synth) { reading(null); Q.showToast && Q.showToast('This browser has no speech voice.'); return; }
    rateSrc = speed;
    reading(btn);
    const parts = plain(spoken(text)).match(/[^.!?]+[.!?]*\s*/g) || [];
    const chunks = [];
    for (const p of parts) { if (chunks.length && (chunks[chunks.length - 1] + p).length < 220) chunks[chunks.length - 1] += p; else chunks.push(p); }
    let i = 0;
    const nextChunk = () => {
      if (readBtn !== btn || !btn.isConnected) { if (readBtn === btn) reading(null); return; }
      if (i >= chunks.length) { reading(null); return; }
      speak(chunks[i++].trim(), nextChunk, speed);
    };
    nextChunk();
  }
  // Sentence groups for the natural voice: a short first one (quick start), then up to ~400 characters each.
  function chunksOf(text) {
    const parts = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) || [text];
    const out = [];
    for (const p of parts) {
      const last = out.length - 1;
      if (last >= 0 && (out[last] + p).length < (last === 0 ? 220 : 400)) out[last] += p; else out.push(p);
    }
    return out.map((c) => c.trim()).filter(Boolean);
  }
  // Natural voice, chunk by chunk: each chunk is made while the one before plays, so stopping early
  // never pays for (or waits on) the rest of the reply.
  // opts.free: only the free local voice (engine 'local' on the server), else the browser voice; never ElevenLabs
  // (for automatic read-aloud). Without it, the configured engine (local or ElevenLabs) as before.
  async function readAloud(text, btn, opts = {}) {
    if (readBtn === btn) { hush(); reading(null); return; }
    const free = !!(opts && opts.free === true);
    stopAll();
    unlock();
    await natStatus();
    const localOk = !!(nat && nat.local && nat.local.installed && nat.local.state !== 'error');
    if (free ? !(localOk && pref('board.engine', 'natural') === 'natural') : !natural()) return readWithBrowser(text, btn);
    const chunks = chunksOf(spoken(text));
    if (!chunks.length) return;
    const reqs = [];
    const body = (t) => (free ? { text: t, purpose: 'read', engine: 'local' } : { text: t, purpose: 'read' });
    const get = (i) => (reqs[i] = reqs[i] || Q.api('api/voice/tts', body(chunks[i])).then((d) => { noteCapAlert(d); return d.url; }).catch((e) => { console.warn('[board] natural voice unavailable:', e.message); return null; }));
    reading(btn, 'busy');
    let i = 0;
    const next = async () => {
      if (readBtn !== btn || !btn.isConnected) { if (readBtn === btn) { hush(); reading(null); } return; }
      if (i >= chunks.length) { reading(null); setTimeout(() => natStatus(true), 1500); return; }
      const k = i;
      const url = await get(k);
      if (readBtn !== btn) return;               // stopped while it was being made
      if (!url) return readWithBrowser(chunks.slice(k).join(' '), btn);
      if (k + 1 < chunks.length) get(k + 1);
      reading(btn);
      i = k + 1;
      playUrl(url, next, () => readWithBrowser(chunks.slice(k).join(' '), btn), false, speed);
    };
    next();
  }

  // Settings changed the engine or voice: boards look their audio up again (and show the new cost line).
  window.addEventListener('quiz:voice-changed', () => { natStatus(true).then(refreshPlayers); });

  // Preferences changed (Settings, another tab's ••• menu, or the first server copy arriving): apply them live.
  window.addEventListener('quiz:prefs', (e) => {
    const ch = (e.detail && e.detail.changed) || [];
    if (ch.includes('voice.captions')) syncCaptions();
    if (ch.includes('voice.speed') && !audio.paused) setRate(rateSrc());   // the MP3 playing now (unless its board has its own speed)
    if (ch.includes('boards.renderer')) { for (const p of players) p.setMode(renderer()); drawEmit(); }
    if (ch.some((k) => k === 'voice.speed' || k === 'boards.pace')) for (const p of players) p.sync();
  });

  Q.board = {
    mount, readAloud, stopAll, stopDetached, drawing, noteCapAlert,
    get available() { return canSpeak(); },
    status: () => natStatus(true),
  };
})();
