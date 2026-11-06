// Live board answers: the teacher talks and draws at once (server: LiveRun in teach.js).
// The reply streams over SSE (GET api/teach/<id>/live): `say {seq, text}` sentences, `draw {op, afterSeq}`
// ops, `title`, then `done {turn, board}` or `error`. Text arrives ~40× faster than speech, so the
// drawing follows the VOICE, not the stream: sentence k is spoken in order, and the ops written before
// it (afterSeq = k - 1) are drawn on the Excalidraw canvas when it starts.
// Voice per sentence: POST api/voice/tts {text, purpose: 'live'} (a free local engine, see voice.js)
// when the server says it has one, else the browser's speechSynthesis. The next sentence's audio is
// fetched while one plays.
//   const lv = Quiz.live.start(sessionId, { onDone(data), onEnd(info) })
//   lv.el → the element to show; lv.turn → the stored turn's index once done; lv.stop()
// onDone: the turn is stored (cards can show); onEnd: playback is over or stopped (show the normal player).
// Prefs (Quiz.prefs): voice.speed (applied live), voice.captions (ui/board.js hides .bd-cap), boards.pace
// ('voice': ops draw when their sentence starts; 'fast': as soon as they arrive; 'instant': with their sentence,
// no animation), boards.autoplay (false: nothing is said or drawn while it streams, a quiet "Preparing the
// board…", then onEnd({why: 'ready'}) hands over to the normal player and its Play cover).
(() => {
  const Q = window.Quiz;
  if (!Q) return;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const T = (s) => Q.esc(String(s || ''));
  const HERE = new URL('.', (document.currentScript && document.currentScript.src) || location.href);
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const P = () => window.QuizPrefs || (window.Quiz && window.Quiz.prefs) || null;
  const pget = (k, d) => { const p = P(); const v = p ? p.get(k) : undefined; return v === undefined || v === null ? d : v; };
  const noteCap = (d) => { if (Q.board && Q.board.noteCapAlert) Q.board.noteCapAlert(d); };

  const css = `
  .bd.lv .bd-head { padding-right: 10px; }
  .lv-pill { display: inline-flex; align-items: center; gap: 5px; margin-left: 4px; padding: 2px 8px; border-radius: 10px; flex: none;
    font: 600 11px/16px var(--font); letter-spacing: .02em; text-transform: uppercase; color: var(--red); background: color-mix(in srgb, var(--red) 12%, transparent); }
  .lv-pill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: bd-pulse 1.2s var(--ease) infinite; }
  .lv.ended .lv-pill { color: var(--label-3); background: var(--fill); }
  .lv.ended .lv-pill i { animation: none; }
  .lv-stop { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 0; border-radius: 15px; flex: none;
    background: var(--fill); color: var(--label); font: 600 13px/1 var(--font); cursor: pointer; }
  .lv-stop:hover { background: var(--fill-2, var(--fill)); }
  .lv-stop svg { width: 14px; height: 14px; }
  .lv-stop[hidden] { display: none; }
  .lv-wait { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; pointer-events: none; }
  .lv-wait > span { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 20px; font: var(--subhead); color: var(--label-2);
    background: var(--material-thick, var(--surface)); box-shadow: var(--shadow-1); }
  .lv-wait[hidden] { display: none; }
  .lv .bd-cap { min-height: 52px; }
  .lv .bd-cap.idle { color: var(--label-3); }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ui/canvas.js + vendored Excalidraw (ui/board.js loads the same files for its players).
  let canvasP = null;
  function loadCanvas() {
    if (!canvasP) {
      canvasP = new Promise((resolve, reject) => {
        if (Q.canvas) return resolve(Q.canvas);
        const s = document.createElement('script');
        s.src = new URL('canvas.js', HERE).href;
        s.onload = () => (Q.canvas ? resolve(Q.canvas) : reject(new Error('canvas.js did not load')));
        s.onerror = () => reject(new Error('canvas.js did not load'));
        document.head.appendChild(s);
      }).then((c) => c.load().then(() => c));
      canvasP.catch(() => { canvasP = null; });
    }
    return canvasP;
  }

  // ---------- voice ----------
  const synth = window.speechSynthesis || null;
  const rate = () => { const r = Number(pget('voice.speed', 1)); return r >= 0.5 && r <= 2 ? r : 1; };   // the voice.speed pref
  const voiceOn = () => pref('board.voiceOn', '1') === '1';
  const estimate = (text) => (String(text).split(/\s+/).length / (2.6 * rate())) * 1000 + 300;
  function browserVoice() {
    const vs = synth ? synth.getVoices() : [];
    const name = pref('board.voice', '');
    const en = vs.filter((v) => /^en[-_]/i.test(v.lang));
    return (name && vs.find((v) => v.name === name)) || en.find((v) => /premium/i.test(v.name)) || en.find((v) => /enhanced/i.test(v.name)) || en.find((v) => v.lang === 'en-US') || en[0] || null;
  }
  // Does the server have a voice for live talk? purpose 'live' uses the local engine (voice.js: Kokoro,
  // no per-character cost; never ElevenLabs unless data/voice.json says liveEngine 'elevenlabs').
  // Only when it is installed is the TTS route used; otherwise (or when a request fails) the browser voice speaks.
  let liveTts = null, liveTtsAt = 0;
  function liveTtsOk() {
    if (!liveTts || Date.now() - liveTtsAt > 60000) {
      liveTtsAt = Date.now();
      liveTts = Q.api('api/voice/status').then((s) => { noteCap(s); return !!(s && s.local && s.local.installed && s.local.state !== 'error'); }).catch(() => false);
    }
    return liveTts;
  }
  const SILENT_MIN = 250;

  // ---------- one live answer ----------
  function start(sessionId, { onDone, onEnd } = {}) {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const timings = { startedAt: Math.round(t0), firstSayEvent: null, firstAudio: null, firstDraw: null, done: null, end: null, voice: null };
    const autoplay = pget('boards.autoplay', true) !== false;   // read once: this answer either plays live or waits
    const livePace = () => { const v = pget('boards.pace', 'voice'); return v === 'fast' || v === 'instant' ? v : 'voice'; };
    const root = el(`<div class="bd cv lv" aria-live="off">
      <div class="bd-head">${icon('board')}<span class="bd-title">On the board</span><span class="lv-pill"><i></i>Live</span>
        <button type="button" class="lv-stop" title="Stop the live answer">${icon('stop')}<span>Stop</span></button></div>
      <div class="bd-stage"><div class="bd-svg"><div class="bd-cv" style="--bd-ar:.6"><div class="bd-cv-x"></div>
        <div class="lv-wait"><span><span class="activity"></span><b>${autoplay ? 'Thinking…' : 'Preparing the board…'}</b></span></div></div></div></div>
      <div class="bd-cap idle keep" role="status">${autoplay ? 'The teacher is about to explain on the board.' : 'The board is being prepared; press Play when it’s ready.'}</div>
    </div>`);
    const $ = (s) => root.querySelector(s);
    const cap = $('.bd-cap'), wait = $('.lv-wait');
    const says = [];               // seq → text
    const opsFor = new Map();      // seq → ops drawn when sentence seq starts
    const board = { title: 'On the board', steps: [] };
    let cur = -1, speaking = false, streamDone = false, stopped = false, ended = false;
    let cvP = null, cv = null, fitH = 0, token = 0;
    const audios = new Map();      // seq → Promise<HTMLAudioElement|null>
    let playingAudio = null;

    // The canvas mounts right away (Excalidraw takes a moment), so the first op draws without delay.
    // (Not when it waits for Play: nothing is drawn here then.)
    cvP = !autoplay ? Promise.resolve(null) : loadCanvas().then((C) => {
      if (stopped) return null;
      cv = C.mount($('.bd-cv-x'), { lesson: true, minRows: 6 });
      return cv.ready.then(() => cv);
    }).catch((e) => { console.warn('[live] canvas unavailable:', e.message); return null; });
    let drawChain = cvP;

    function heightOf(ops) { for (const o of ops) if (o.y !== undefined && o.h !== undefined) fitH = Math.max(fitH, o.y + o.h); return fitH; }
    function applyOps(ops, say) {
      if (!ops.length) return;
      board.steps.push({ say, draw: ops });
      const k = board.steps.length - 1, before = fitH, after = heightOf(ops);
      if (timings.firstDraw === null) timings.firstDraw = ms();
      const pc = livePace();
      drawChain = drawChain.then(async (c) => {
        if (!c || ended) return c;
        if (k === 0) await c.play(board, { at: 0, pace: pc });
        else { if (after > Math.max(before, 6)) c.fit(); await c.goTo(k, { pace: pc }); }
        return c;
      }).catch((e) => { console.warn('[live] draw failed:', e); return cv; });
    }

    // Audio for sentence i: an MP3/WAV from the server's live voice, or null (→ browser voice).
    function audioFor(i) {
      if (audios.has(i)) return audios.get(i);
      if (says[i] === undefined) return Promise.resolve(null);
      const p = liveTtsOk().then((ok) => {
        if (!ok || !voiceOn() || says[i] === undefined) return null;
        return Q.api('api/voice/tts', { text: says[i], purpose: 'live' }).then((d) => {
          noteCap(d);
          if (!d || !d.url) return null;
          const a = new Audio();
          a.preload = 'auto';
          a.src = new URL(d.url, location.href).href;
          return a;
        });
      }).catch((e) => { console.warn('[live] live voice unavailable, using the browser voice:', e.message); return null; });
      audios.set(i, p);
      return p;
    }
    function hush() {
      token++;
      if (synth) synth.cancel();
      if (playingAudio) { playingAudio.onended = playingAudio.onerror = null; playingAudio.pause(); playingAudio = null; }
    }
    // Speak sentence i; resolves when it has been said (or right away when stopped).
    function speak(i) {
      const text = says[i];
      const my = ++token;
      return new Promise((resolve) => {
        const started = performance.now();
        let fired = false;
        const end = () => { if (fired) return; fired = true; clearTimeout(guard); resolve(); };
        const guard = setTimeout(end, estimate(text) * 2.2 + 4000);
        const pace = () => setTimeout(end, Math.max(0, estimate(text) - (performance.now() - started)));   // a voice that failed: keep the pace
        const first = () => { if (timings.firstAudio === null) timings.firstAudio = ms(); };
        if (!voiceOn()) { first(); timings.voice = timings.voice || 'off'; pace(); return; }
        const browser = () => {
          if (my !== token) return end();
          if (!synth) { first(); pace(); return; }
          const u = new SpeechSynthesisUtterance(text);
          const v = browserVoice();
          if (v) { u.voice = v; u.lang = v.lang; }
          u.rate = rate();
          u.onstart = first;
          u.onend = () => (performance.now() - started < SILENT_MIN ? pace() : end());   // ended at once: no real voice
          u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') end(); else { first(); pace(); } };
          speak.u = u;   // Chrome can garbage-collect a playing utterance
          timings.voice = timings.voice || 'browser';
          synth.speak(u);
        };
        audioFor(i).then((a) => {
          if (my !== token) return end();
          if (!a) return browser();
          playingAudio = a;
          try { a.preservesPitch = true; a.defaultPlaybackRate = rate(); } catch {}
          a.playbackRate = rate();
          a.onended = end;
          a.onerror = () => { if (my === token) browser(); };
          a.onplaying = first;
          timings.voice = timings.voice || 'live';
          a.play().catch((e) => { if (my === token && e.name !== 'AbortError') browser(); });
        });
      });
    }

    // Play the next sentence when it has arrived; its ops draw as it starts.
    function pump() {
      if (stopped || speaking || ended || !autoplay) return;
      const i = cur + 1;
      if (says[i] !== undefined) {
        cur = i;
        speaking = true;
        wait.hidden = true;
        cap.classList.remove('idle', 'keep');
        cap.textContent = says[i];
        applyOps(opsFor.get(i) || [], says[i]);
        opsFor.delete(i);
        if (says[i + 1] !== undefined) audioFor(i + 1);   // fetch the next one while this plays
        speak(i).then(() => { speaking = false; pump(); });
        return;
      }
      if (streamDone) {
        // Ops written after the last sentence: draw them now, then hand over to the normal player.
        const rest = [...opsFor.keys()].sort((a, b) => a - b).flatMap((k) => opsFor.get(k));
        opsFor.clear();
        applyOps(rest, says[cur] || '');
        drawChain.then(() => setTimeout(() => finish('played'), rest.length ? 900 : 300));
      } else if (cur >= 0) cap.classList.add('idle');
    }

    function finish(why) {
      if (ended) return;
      ended = true;
      timings.end = ms();
      hush();
      es.close();
      clearTimeout(fastTimer);
      window.removeEventListener('quiz:prefs', onPrefs);
      root.classList.add('ended');
      $('.lv-stop').hidden = true;
      $('.lv-pill').lastChild.textContent = why === 'stopped' ? 'Stopped' : why === 'error' ? 'Failed' : why === 'ready' ? 'Ready' : 'Done';
      window.__liveTimings = { ...timings, why };
      console.info('[live]', JSON.stringify(window.__liveTimings));
      if (onEnd) onEnd({ why, turn: api.turn, board: api.board });
      setTimeout(() => { if (cv && !root.isConnected) { cv.dispose(); cv = null; } }, 0);
    }

    // ---------- the stream ----------
    const es = new EventSource(`api/teach/${encodeURIComponent(sessionId)}/live`);
    const on = (type, f) => es.addEventListener(type, (e) => { if (ended) return; let d = {}; try { d = JSON.parse(e.data); } catch {} f(d); });
    on('title', (d) => { board.title = d.text || board.title; $('.bd-title').textContent = board.title; });
    on('say', (d) => {
      if (timings.firstSayEvent === null) timings.firstSayEvent = ms();
      says[d.seq] = d.text;
      if (!autoplay) { wait.querySelector('b').textContent = `Preparing the board… (${says.filter((x) => x !== undefined).length} sentences so far)`; return; }
      if (d.seq <= cur + 2) audioFor(d.seq);
      pump();
    });
    // pace 'fast': ops draw as they arrive (a burst of them in one step), not when the voice reaches them.
    let fastOps = [], fastTimer = 0;
    on('draw', (d) => {
      if (!autoplay) return;
      if (livePace() === 'fast') {
        fastOps.push(d.op);
        clearTimeout(fastTimer);
        fastTimer = setTimeout(() => { const ops = fastOps; fastOps = []; wait.hidden = true; applyOps(ops, says[Math.max(cur, 0)] || ''); }, 60);
        return;
      }
      const k = Math.max(cur + 1, (Number.isFinite(d.afterSeq) ? d.afterSeq : -1) + 1);
      if (!opsFor.has(k)) opsFor.set(k, []);
      opsFor.get(k).push(d.op);
      if (cur < 0) wait.querySelector('b').textContent = 'Drawing…';
    });
    on('done', (d) => {
      timings.done = ms();
      streamDone = true;
      api.turn = typeof d.turn === 'number' ? d.turn : null;
      api.board = d.board || null;
      es.close();
      if (d.board && d.board.title) { board.title = d.board.title; $('.bd-title').textContent = board.title; }
      if (onDone) onDone(d);
      if (!autoplay) { finish(d.board ? 'ready' : 'error'); return; }   // the normal player, with its Play cover
      if (!says.length) { finish(d.board ? 'played' : 'error'); return; }   // it answered without talking: the player takes over
      if (fastOps.length) { clearTimeout(fastTimer); const ops = fastOps; fastOps = []; applyOps(ops, says[Math.max(cur, 0)] || ''); }
      pump();
    });
    on('error', (d) => {   // the server's "error" event (a failed turn); EventSource's own errors come without data
      if (!d || !d.message) return;
      streamDone = true;
      cap.classList.remove('idle');
      cap.classList.add('keep');
      cap.textContent = `The live answer failed: ${d.message}`;
      finish('error');
    });
    on('none', () => finish('none'));   // nothing live on the server (e.g. it restarted): the normal view takes over
    es.onerror = () => { if (es.readyState === EventSource.CLOSED && !streamDone) { streamDone = true; finish('error'); } };

    $('.lv-stop').onclick = () => api.stop();
    // voice.speed changed in Settings: the sentence playing now speeds up or slows down in place.
    function onPrefs(e) {
      const ch = (e.detail && e.detail.changed) || [];
      if (ch.includes('voice.speed') && playingAudio) { try { playingAudio.defaultPlaybackRate = rate(); playingAudio.playbackRate = rate(); } catch {} }
    }
    window.addEventListener('quiz:prefs', onPrefs);

    const api = {
      el: root, turn: null, board: null, timings,
      get ended() { return ended; },
      // What he has heard so far: the sentences spoken (the last one maybe only partly) and how many
      // written ones he hasn't. A stream still running may write more, so unheard can grow after a stop.
      heard() {
        const said = says.slice(0, cur + 1).filter((x) => x !== undefined);
        return { heard: said.join(' '), unheard: Math.max(0, says.filter((x) => x !== undefined).length - said.length), streaming: !streamDone };
      },
      // Stop talking and drawing; the turn still completes on the server and shows as a normal board.
      stop() { if (ended) return; stopped = true; finish('stopped'); },
      dispose() { if (!ended) { stopped = true; finish('stopped'); } if (cv) { cv.dispose(); cv = null; } },
    };
    return api;
  }

  Q.live = { start };
})();
