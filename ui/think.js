// Think out loud: a thinking field, local voice dictation (whisper.cpp via dictation.js) and a
// "How sure are you?" control. One answer is one bit; the reasoning behind it is the picture,
// so the thinking and confidence go to the AI grader with the answer (payload → extra).
//
// Shared API other modules use (keep this shape):
//   Quiz.think.mic(textarea, { hint })         → <button> right after the textarea; records, transcribes, inserts at cursor
//   Quiz.think.field(container, { label, placeholder, open, hint }) → { el, value, open(), focus(), dictated }
//   Quiz.think.confidence(container, { value, onChange })           → { el, value (null|0|30|50|70|90|100), reset() }
//   Quiz.think.dictate(blob, hint) → Promise<string>;  Quiz.think.available (Whisper ready on the server)
//   Quiz.think.info                            the last api/dictate/status (model in use, fallback reason…);
//                                              window event 'quiz:dictate-status' {detail: info} whenever it's reloaded
//   window event 'quiz:dictated' {detail: {target: <textarea>, text, auto, via}} after dictated text is inserted.
//     auto: true when the recording stopped itself after silence (pref mic.autoSendSec); via: 'click' | 'key'
//     (⌥M) | 'ptt' (push-to-talk release, pref mic.pushToTalk) | 'silence' | 'limit' (5-minute cap).
//     Teach auto-sends its composer on auto; the quiz answer box never reveals by itself.
(() => {
  const Quiz = window.Quiz;
  if (!Quiz) return;
  const STOPS = [0, 30, 50, 70, 90, 100];
  const MAX_REC_MS = 5 * 60 * 1000;    // auto-stop: longer clips take Whisper too long
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const SHORTCUT = MAC ? '⌥M' : 'Alt+M';
  const pref = (k, d) => { try { const v = Quiz.prefs && Quiz.prefs.get(k); return v === undefined || v === null ? d : v; } catch { return d; } };
  // Silence detection (auto-stop): RMS of the mic signal, 0..1. "Speech" must clear both a floor and the
  // room's noise level (tracked slowly while quiet), for long enough to count as having spoken.
  const SPEECH_MIN = 0.02, SPOKE_MS = 300, PTT_HOLD_MS = 250;

  const ic = (n) => (Quiz.icon ? Quiz.icon(n) : '');

  const style = document.createElement('style');
  style.textContent = `
  /* Mic: a round icon button. Inside a field wrapper (.field-wrap, the thinking field) it floats at the
     field's bottom-right corner; anywhere else it sits on its own row, right-aligned. */
  .think-mic { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .field-wrap > .think-mic, details.think-field > .think-mic { position: absolute; right: 8px; bottom: 8px; margin: 0; }
  .hidden + .think-mic, .think-mic.off { display: none; }
  .think-mic .tm-btn { width: 32px; height: 32px; padding: 0; border-radius: 50%; background: var(--surface); color: var(--label-2); box-shadow: var(--shadow-1), 0 0 0 .5px var(--separator); }
  .think-mic .tm-btn:hover:not(:disabled) { color: var(--accent); background: var(--surface); }
  .think-mic .tm-btn svg { width: 17px; height: 17px; }
  .think-mic .tm-btn.rec { background: var(--red); color: #fff; box-shadow: 0 0 0 4px color-mix(in srgb, var(--red) 22%, transparent); }
  .think-mic .tm-btn .spinner { margin: 0; }
  .think-mic .tm-msg { font: 500 12px/16px var(--font); color: var(--label-2); background: var(--surface); padding: 4px 10px; border-radius: var(--r-pill);
    box-shadow: var(--shadow-1), 0 0 0 .5px var(--separator); max-width: 260px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .think-mic .tm-msg:empty { display: none; }
  .think-mic .tm-msg.err { color: var(--red); }
  .think-mic.recording .tm-msg::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--red);
    margin-right: 6px; vertical-align: 1px; animation: tm-pulse 1.2s ease-in-out infinite; }
  @keyframes tm-pulse { 50% { opacity: .3; } }
  .think-mic .lvl { width: 44px; height: 4px; background: var(--fill); border-radius: 2px; overflow: hidden; display: none; }
  .think-mic.recording .lvl { display: inline-block; }
  .think-mic .lvl i { display: block; height: 100%; width: 0; background: var(--red); transition: width .08s; }
  #chat.locked .think-mic { opacity: .45; pointer-events: none; }
  .chat-input .think-mic .tm-btn { box-shadow: none; background: transparent; width: 28px; height: 28px; }

  /* "Your thinking": a disclosure that opens into a field */
  details.think-field { position: relative; }
  details.think-field > summary { display: inline-flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; list-style: none;
    font: 400 15px/20px var(--font); color: var(--label); }
  details.think-field > summary::-webkit-details-marker { display: none; }
  details.think-field > summary::before { content: ""; width: 6px; height: 6px; margin: 0 3px 0 1px; border-right: 1.7px solid var(--label-3); border-bottom: 1.7px solid var(--label-3);
    transform: rotate(-45deg); transition: transform var(--dur) var(--ease); }
  details.think-field[open] > summary::before { transform: rotate(45deg) translate(-1px, -1px); }
  details.think-field > summary:hover::before { border-color: var(--label-2); }
  details.think-field > summary .tf-sub { color: var(--label-3); }
  details.think-field textarea { margin-top: 8px; min-height: 96px; padding-bottom: 44px; }
  details.think-field textarea:disabled { color: var(--label-2); }

  /* "How sure are you?": label + segmented control */
  .think-conf { display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }
  .think-conf > .tc-label { font: 400 15px/20px var(--font); color: var(--label); }
  .think-conf .segmented button { min-width: 48px; font-variant-numeric: tabular-nums; }
  /* the chosen stop in solid accent: the default segmented look (white on light gray) vanishes in daylight */
  .think-conf .seg.segmented button.on[aria-pressed="true"] { background: var(--accent); color: #fff; font-weight: 600; box-shadow: none; }
  .think-conf .seg.segmented button { transition: background var(--dur), color var(--dur); }
  @media (max-width: 600px) {
    .think-conf .segmented { display: flex; width: 100%; }
    .think-conf .segmented button { flex: 1; min-width: 0; padding: 0 4px; }
  }
  .think-shown .yours { font: var(--subhead); line-height: 1.45; }
  .think-shown .conf { font: var(--subhead); color: var(--label-2); }
  .think-shown .conf strong { color: var(--label); }
  `;
  document.head.appendChild(style);

  // ---------- server side: is Whisper ready? ----------
  let available = false, info = null;
  const loadStatus = () => Quiz.api('api/dictate/status').then((s) => { info = s; available = !!s.available; }).catch(() => {})
    .then(() => document.querySelectorAll('.think-mic').forEach((m) => {
      m.classList.toggle('off', !available);
      const b = m.querySelector('.tm-btn'); if (b) b.title = micTitle();
    }))
    .then(() => window.dispatchEvent(new CustomEvent('quiz:dictate-status', { detail: info })));
  const status = loadStatus();
  // Tooltip: the shortcut(s) and the model in use.
  function micTitle() {
    const ptt = pref('mic.pushToTalk', 'none');
    const hold = ptt === 'alt' ? (MAC ? ', or hold ⌥' : ', or hold Alt') : ptt === 'backquote' ? ', or hold `' : '';
    const model = info && info.using ? ` Model: ${info.using.replace(/^ggml-|\.bin$/g, '')}.` : '';
    return `Dictate (${SHORTCUT}${hold}). Transcribed on ${(info && info.install && info.install.machine) || 'this computer'}, not in the cloud.${model}${info && info.fallback ? ' ' + info.fallback : ''}`;
  }
  // Another model / language / shortcut chosen in Settings: ask the server which model that means now.
  window.addEventListener('quiz:prefs', (e) => {
    const changed = (e.detail && e.detail.changed) || [];
    if (changed.some((k) => k === 'mic.model' || k === 'mic.language')) {
      loadStatus().then(() => { if (info && info.fallback) Quiz.showToast(info.fallback); });
    } else if (changed.includes('mic.pushToTalk')) document.querySelectorAll('.think-mic .tm-btn').forEach((b) => (b.title = micTitle()));
  });

  async function dictate(blob, hint) {
    const r = await fetch('api/dictate' + (hint ? '?hint=' + encodeURIComponent(String(hint).slice(0, 600)) : ''), {
      method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data.text || '';
  }

  // ---------- recording (one at a time across the page) ----------
  let rec = null;   // { mic, recorder, stream, ctx, chunks, started, timer, raf, discard }

  function pickMime() {
    if (!window.MediaRecorder) return null;
    for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  // Puts text at the textarea's cursor with a space on either side as needed, then tells listeners.
  function insertAtCursor(ta, text) {
    if (!text) return;
    const v = ta.value;
    const s = ta.selectionStart ?? v.length, e = ta.selectionEnd ?? v.length;
    const before = v.slice(0, s), after = v.slice(e);
    const pre = before && !/\s$/.test(before) ? ' ' : '';
    const post = after && !/^\s/.test(after) ? ' ' : '';
    ta.value = before + pre + text + post + after;
    const pos = (before + pre + text).length;
    try { ta.setSelectionRange(pos, pos); } catch {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function start(m, via = 'click') {
    if (rec) await stop();   // another field was recording: finish that one first (it still gets transcribed)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || pickMime() === null) {
      return m.say('This browser can’t record audio here.', true);
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      return m.say(e.name === 'NotAllowedError' ? 'Microphone blocked: allow it in the browser’s site settings.' : 'No microphone: ' + e.message, true);
    }
    const mime = pickMime();
    let recorder;
    try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      return m.say('Recording failed: ' + e.message, true);
    }
    const r = { mic: m, recorder, stream, chunks: [], started: Date.now(), discard: false, ctx: null, raf: 0, via, auto: false };
    rec = r;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    recorder.onstop = () => finish(r);
    recorder.start(1000);
    m.setState('recording');
    window.dispatchEvent(new CustomEvent('quiz:mic', { detail: { on: true, target: m.ta } }));   // e.g. Teach stops reading aloud
    // Live level meter so the learner sees it hears them.
    try {
      r.ctx = new (window.AudioContext || window.webkitAudioContext)();
      r.ctx.resume().catch(() => {});   // Safari may start it suspended once the click is awaited past
      const an = r.ctx.createAnalyser();
      an.fftSize = 512;
      r.ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      // Silence detection for auto-stop (mic.autoSendSec): after some speech, N quiet seconds end the take.
      let floor = 0.01, loudMs = 0, lastLoud = Date.now(), lastT = Date.now(), rms = 0;
      const sample = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const x of buf) sum += (x - 128) * (x - 128);
        rms = Math.sqrt(sum / buf.length) / 128;
        const now = Date.now(), dt = Math.min(250, now - lastT);
        lastT = now;
        const loud = rms > Math.max(SPEECH_MIN, floor * 2.5);
        if (loud) { loudMs += dt; lastLoud = now; } else floor = floor * 0.98 + rms * 0.02;   // room noise, learned while quiet
        r.spoke = loudMs >= SPOKE_MS;
        const sec = Number(pref('mic.autoSendSec', 0)) || 0;
        if (sec > 0 && r.spoke && r.via !== 'ptt' && r.via !== 'hold' && now - lastLoud >= sec * 1000 && rec === r) {
          r.auto = true; r.via = 'silence';
          stop();
          return true;
        }
        return false;
      };
      r.sample = sample;
      const tick = () => {
        if (sample()) return;
        m.level(Math.min(1, rms * 4));
        r.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
    r.timer = setInterval(() => {
      const ms = Date.now() - r.started;
      m.say(Quiz.fmt(ms));
      // requestAnimationFrame pauses in a background tab: keep the silence check going from here too.
      if (r.sample && document.hidden && r.sample()) return;
      if (ms >= MAX_REC_MS) { r.via = 'limit'; stop(); }
    }, 250);
    m.say('0:00');
  }

  // Stops the current recording; discard = throw the audio away (e.g. the question changed).
  function cleanup(r) {
    if (rec === r) rec = null;
    clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    if (r.ctx && r.ctx.state !== 'closed') r.ctx.close().catch(() => {});
  }
  function stop(discard = false) {
    const r = rec;
    if (!r) return Promise.resolve();
    r.discard = discard;
    cleanup(r);
    return new Promise((resolve) => {
      r.done = resolve;
      try { r.recorder.state !== 'inactive' ? r.recorder.stop() : finish(r); } catch { finish(r); }
    });
  }

  async function finish(r) {
    if (r.finished) return;
    r.finished = true;
    cleanup(r);
    r.stream.getTracks().forEach((t) => t.stop());   // only now: stopping first would cut the last chunk
    const m = r.mic;
    if (r.done) r.done();
    if (r.discard || !r.chunks.length) { m.setState('idle'); m.say(''); return; }
    const blob = new Blob(r.chunks, { type: (r.recorder.mimeType || r.chunks[0].type || '').split(';')[0] || 'audio/webm' });
    const gen = m.gen;
    m.setState('busy');
    m.say('Transcribing…');
    try {
      const text = await dictate(blob, typeof m.hint === 'function' ? m.hint() : m.hint);
      // Drop it if the field was reset (new question) or removed while Whisper worked.
      if (gen !== m.gen || !m.ta.isConnected) return;
      m.setState('idle');
      if (!text) return m.say('Didn’t catch anything, try again closer to the mic.', true);
      insertAtCursor(m.ta, text);
      m.used = true;
      if (m.onText) m.onText(text);
      m.say('');
      m.ta.focus();
      window.dispatchEvent(new CustomEvent('quiz:dictated', { detail: { target: m.ta, text, auto: !!r.auto, via: r.via } }));
    } catch (e) {
      if (gen !== m.gen) return;
      m.setState('idle');
      m.say(e.message, true);
    }
  }

  // ---------- mic button ----------
  function mic(ta, { hint, onText } = {}) {
    if (ta._thinkMic) {   // already has one: just refresh the hint
      if (hint !== undefined) ta._thinkMic.hint = hint;
      return ta._thinkMic.btn;
    }
    const wrap = document.createElement('div');
    wrap.className = 'think-mic' + (available ? '' : ' off');
    wrap.innerHTML = `<span class="tm-msg" aria-live="polite"></span><span class="lvl"><i></i></span>
      <button type="button" class="tm-btn" aria-label="Dictate">${ic('mic')}</button>`;
    wrap.querySelector('button').title = micTitle();
    ta.insertAdjacentElement('afterend', wrap);
    const btn = wrap.querySelector('button'), msg = wrap.querySelector('.tm-msg'), bar = wrap.querySelector('.lvl i');
    const m = {
      ta, btn, hint, onText, gen: 0, used: false, state: 'idle',
      say(t, err = false) { msg.textContent = t; msg.classList.toggle('err', err); },
      level(x) { bar.style.width = Math.round(x * 100) + '%'; },
      setState(s) {
        m.state = s;
        wrap.classList.toggle('recording', s === 'recording');
        btn.classList.toggle('rec', s === 'recording');
        btn.disabled = s === 'busy';
        btn.innerHTML = s === 'recording' ? ic('stop') : s === 'busy' ? '<span class="spinner"></span>' : ic('mic');
        btn.setAttribute('aria-label', s === 'recording' ? 'Stop dictation' : 'Dictate');
      },
      toggle(via = 'click') {
        if (m.state === 'busy' || m.starting || ta.disabled) return;
        if (rec && rec.mic === m) return void stop();
        m.starting = true;   // waiting on the permission prompt: ignore double clicks
        return start(m, via).finally(() => { m.starting = false; });
      },
      // New question: forget any recording/transcription in flight for this field.
      reset() {
        m.gen++; m.used = false;
        if (rec && rec.mic === m) stop(true);
        m.setState('idle'); m.say('');
      },
    };
    btn.onclick = () => m.toggle();
    ta._thinkMic = m;
    return btn;
  }

  // ---------- thinking field ----------
  function field(container, { label = 'Think out loud', placeholder = 'How are you reasoning? What are you unsure about?', open = false, hint } = {}) {
    const d = document.createElement('details');
    d.className = 'think-field';
    d.open = !!open;
    d.innerHTML = `<summary><span class="tf-label"></span><span class="tf-sub"></span></summary><textarea class="field"></textarea>`;
    // "Your thinking · optional" → the part after " · " is shown as quiet secondary text
    const [main, sub] = String(label).split(' · ');
    d.querySelector('.tf-label').textContent = main;
    d.querySelector('.tf-sub').textContent = sub ? sub[0].toUpperCase() + sub.slice(1) : '';
    const ta = d.querySelector('textarea');
    ta.placeholder = placeholder;
    container.appendChild(d);
    mic(ta, { hint });
    return {
      el: d, textarea: ta,
      get value() { return ta.value.trim(); },
      set value(v) { ta.value = v || ''; },
      open() { d.open = true; },
      focus() { d.open = true; ta.focus(); },
      get dictated() { return !!ta._thinkMic.used; },
    };
  }

  // ---------- confidence ----------
  function confidence(container, { value = null, onChange } = {}) {
    const el = document.createElement('div');
    el.className = 'think-conf';
    el.innerHTML = `<span class="tc-label">How sure are you?</span><span class="seg segmented" role="group" aria-label="How sure are you?">${
      STOPS.map((s) => `<button type="button" data-v="${s}" aria-pressed="false">${s}%</button>`).join('')}</span>`;
    container.appendChild(el);
    let cur = STOPS.includes(value) ? value : null;
    const paint = () => el.querySelectorAll('.seg button').forEach((b) => {
      const on = Number(b.dataset.v) === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    el.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => {
      const v = Number(b.dataset.v);
      cur = cur === v ? null : v;   // click the chosen stop again to unset (unset ≠ 50%)
      paint();
      b.blur();                     // so 1–4 keep rating after reveal
      if (onChange) onChange(cur);
    }));
    paint();
    return { el, get value() { return cur; }, reset() { cur = null; paint(); } };
  }

  let think = null, conf = null;   // this question's thinking field and confidence control
  Quiz.think = {
    mic, field, confidence, dictate, get available() { return available; }, ready: status, get info() { return info; },
    get recording() { return rec ? rec.mic.ta : null; },
    get current() { return think; },             // the thinking field on the current question card (mcq.js reads it)
    get currentConfidence() { return conf; },    // its confidence control (.value null when unset)
  };

  // ---------- the quiz card ----------
  // Vocabulary for Whisper: topic, the question and key terms from the answer (`code` and **bold** bits).
  function hintFor(cur) {
    if (!cur || !cur.question) return '';
    const q = cur.question;
    const terms = [...String(q.answer || '').matchAll(/`([^`\n]{2,40})`|\*\*([^*\n]{2,40})\*\*/g)]
      .map((x) => x[1] || x[2]);
    return [q.topic, q.question, [...new Set(terms)].slice(0, 20).join(', ')].filter(Boolean).join('. ').slice(0, 600);
  }
  const currentHint = () => hintFor(Quiz.current);

  const input = Quiz.$('input');
  mic(input, { hint: currentHint });
  if (Quiz.$('chatInput')) mic(Quiz.$('chatInput'), { hint: currentHint });

  Quiz.on('showQuestion', (cur) => {
    think = conf = null;
    if (rec) stop(true);   // a recording from the previous question (its field may be gone already)
    for (const id of ['input', 'chatInput']) { const t = Quiz.$(id); if (t && t._thinkMic) t._thinkMic.reset(); }
    const box = Quiz.$('answerExtras');
    let wasOpen = false;
    try { wasOpen = localStorage.getItem('think.open2') === '1'; } catch {}
    think = field(box, {
      label: 'Your thinking · optional',
      placeholder: 'e.g. "I think it’s about the scheduler, because… not sure whether the child keeps the parent’s file descriptors"',
      open: wasOpen, hint: currentHint,
    });
    think.el.addEventListener('toggle', () => { try { localStorage.setItem('think.open2', think.el.open ? '1' : '0'); } catch {} });
    conf = confidence(box);
    think.cur = cur;
    syncThinkVisibility();
  });

  // Open questions use one box: the answer box takes both the answer and any thinking out loud,
  // and the grader picks out the final answer. The separate thinking field is only for multiple
  // choice (the answer box is hidden there, and a pick alone says nothing about the reasoning).
  const writing = () => !input.classList.contains('hidden');
  function syncThinkVisibility() {
    if (!think) return;
    const hide = writing();
    think.el.classList.toggle('hidden', hide);
    if (hide && rec && rec.mic.ta === think.textarea) stop();   // switched to writing mid-dictation: keep the text
    // Thinking typed before switching MCQ → write moves into the answer box instead of being lost.
    if (hide && think.value && !Quiz.revealed) {
      input.value = input.value.trim() ? `${input.value.trim()}\n\n${think.value}` : think.value;
      think.value = '';
    }
  }
  new MutationObserver(syncThinkVisibility).observe(input, { attributes: true, attributeFilter: ['class'] });

  Quiz.on('payload', (cur) => {
    if (!think || think.cur !== cur) return {};
    const out = {
      thinking: (!writing() && think.value) || undefined,
      confidence: conf ? conf.value : null,
      dictated: !!(input._thinkMic.used || think.dictated) || undefined,
    };
    if (!input.classList.contains('hidden')) out.format = 'write';
    return out;
  });

  // Show what was sent along with the answer, small and muted, under "Your answer".
  Quiz.on('afterReveal', (cur) => {
    if (!think || think.cur !== cur) return;
    if (rec && (rec.mic.ta === input || rec.mic.ta === think.textarea)) stop(true);
    if (document.activeElement === think.textarea) think.textarea.blur();   // so 1–4 rate instead of hitting a disabled field
    think.textarea.disabled = true;   // it's been sent; editing now would be misleading
    think.textarea.nextElementSibling.classList.add('off');
    if (!think.value) think.el.classList.add('hidden');            // nothing written: the empty box is just noise now
    if (cur.mcq && conf) conf.el.classList.add('hidden');          // multiple choice repeats it in the verdict line
    const c = conf ? conf.value : null;
    if (!think.value && c === null) return;
    if (!think.value && cur.mcq) return;   // multiple choice shows "you were N% sure" in its own verdict line
    const el = document.createElement('div');
    el.className = 'answer think-shown';
    const sure = c !== null ? `You were <strong>${c}%</strong> sure.` : '';
    el.innerHTML = think.value
      ? `<h3 class="section-label">Your thinking</h3><div class="yours"></div>${sure ? `<p class="conf" style="margin:8px 0 0">${sure}</p>` : ''}`
      : `<h3 class="section-label">Confidence</h3><p class="conf" style="margin:0">${sure}</p>`;
    if (think.value) el.querySelector('.yours').textContent = think.value;
    Quiz.$('afterExtras').appendChild(el);
  });

  // Where a keyboard-started dictation goes: the focused field if it has a mic, else the Teach composer
  // (when a lesson is open), else the question's answer box (or the thinking field in multiple choice),
  // else, after reveal, the side chat.
  const shown = (el) => !!(el && el.isConnected && el.getClientRects().length);
  function targetMic() {
    const a = document.activeElement;
    if (a && a._thinkMic && !a.disabled && shown(a)) return a._thinkMic;
    const tc = document.getElementById('tcAsk');
    if (tc && tc._thinkMic && document.body.classList.contains('teach-on') && shown(tc)) return tc._thinkMic;
    const quizOn = !Quiz.$('quiz').classList.contains('hidden');
    if (quizOn && !Quiz.revealed) {
      if (!input.classList.contains('hidden')) return input._thinkMic;
      if (think && !think.el.classList.contains('hidden') && !think.textarea.disabled) { think.open(); return think.textarea._thinkMic; }
    }
    if (quizOn && Quiz.revealed) {
      const c = Quiz.$('chatInput');
      if (c && c._thinkMic && !Quiz.$('chat').classList.contains('hidden')) return c._thinkMic;
    }
    return null;
  }

  // ⌥M / Alt+M: stop the running recording, else dictate into the target above.
  // e.code because ⌥M types "µ" on a Mac keyboard.
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== 'KeyM') return;
    if (!available) return;
    e.preventDefault();
    if (ptt) { clearTimeout(ptt.timer); ptt = null; }   // ⌥ was held for this shortcut, not for push-to-talk
    if (rec) return void stop();
    const m = targetMic();
    if (m && !m.ta.disabled && m.state !== 'busy') m.toggle('key');
  });

  // ---------- push-to-talk (pref mic.pushToTalk: 'alt' = hold ⌥/Alt alone, 'backquote' = hold `) ----------
  // Hold the key ≥ 250 ms to record into the target; release to stop and transcribe. A shorter press is
  // ignored, so ⌥-shortcuts and a typed ` still work: any other key during the wait cancels it, and a `
  // typed into a field is taken back out only once the hold is confirmed. Backquote in a text field that
  // has no mic is always just typing.
  let ptt = null;   // { mode, timer, m (once recording), released, undo }
  const isPttKey = (e, mode) => (mode === 'alt' ? e.key === 'Alt' : mode === 'backquote' ? e.code === 'Backquote' : false);
  const editable = (el) => !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable
    || (el.tagName === 'INPUT' && /^(text|search|email|url|password|number|tel)?$/i.test(el.getAttribute('type') || '')));
  function pttRelease(p) {
    if (!p || p.released) return;
    p.released = true;
    clearTimeout(p.timer);
    if (ptt === p) ptt = null;
    if (p.m && rec && rec.mic === p.m) stop();   // still starting (permission prompt)? start's .finally stops it
  }
  document.addEventListener('keydown', (e) => {
    const mode = pref('mic.pushToTalk', 'none');
    if (mode === 'none' || !available) return;
    if (ptt) {
      if (isPttKey(e, ptt.mode)) { if (e.repeat) e.preventDefault(); return; }   // key repeat: no more `s while held
      if (!ptt.m) { clearTimeout(ptt.timer); ptt = null; }   // another key while waiting: a shortcut or typing
      return;
    }
    if (e.repeat || e.isComposing || !isPttKey(e, mode)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || (mode === 'backquote' && e.altKey)) return;   // ⇧` is ~
    if (rec) return;   // a recording started another way is running: its own stop applies
    const a = document.activeElement;
    if (mode === 'backquote' && editable(a) && !a._thinkMic) return;
    const p = { mode, m: null, released: false, undo: null };
    if (mode === 'backquote' && editable(a)) {
      // Let the ` be typed; if this turns out to be a hold, take it back out.
      const before = a.value, s0 = a.selectionStart, s1 = a.selectionEnd;
      p.undo = () => {
        if (a.value !== before.slice(0, s0) + '`' + before.slice(s1)) return;
        a.value = before;
        try { a.setSelectionRange(s0, s1); } catch {}
        a.dispatchEvent(new Event('input', { bubbles: true }));
      };
    } else if (mode === 'backquote') e.preventDefault();
    ptt = p;
    p.timer = setTimeout(() => {
      if (ptt !== p || p.released) return;
      const m = targetMic();
      if (!m || m.ta.disabled || m.state === 'busy' || m.starting) { ptt = null; return; }
      if (p.undo) p.undo();
      p.m = m;
      m.starting = true;
      start(m, 'ptt').finally(() => {
        m.starting = false;
        if (p.released && rec && rec.mic === m) stop();   // let go while the mic was still opening
      });
    }, PTT_HOLD_MS);
  });
  document.addEventListener('keyup', (e) => {
    if (!ptt || !isPttKey(e, ptt.mode)) return;
    if (ptt.m) e.preventDefault();   // Alt alone would focus the menu bar on Windows
    pttRelease(ptt);
  });
  // Switching windows mid-hold: the keyup never arrives.
  window.addEventListener('blur', () => pttRelease(ptt));
})();
