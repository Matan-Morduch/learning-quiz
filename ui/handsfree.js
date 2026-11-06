// Hands-free talk in a lesson (computer): the mic stays open, and speaking cuts the teacher off.
// Your words are sent as a question when you pause; you never touch the keyboard.
//
// How it hears you: the raw mic signal (with the browser's echo cancellation) runs through a simple
// voice detector. Speech starts once it's loud enough for ~0.25 s (louder and longer while the teacher
// is talking, so its own voice from the speakers doesn't count); it ends after a pause (talk.pauseMs).
// The take is kept as raw audio with ~0.8 s from before the start, so the first word isn't clipped,
// encoded as a 16 kHz WAV, transcribed by the server's Whisper (POST api/dictate) and sent.
// A take that only repeats what the teacher just said is dropped (its voice leaking into the mic).
//
// The screen using it provides the talk target: Quiz.talkTarget (the interview, ui/interview.js) or else
// Quiz.teachTalk (a lesson, ui/teach.js) = { interrupt(), send(text, {ms}), speaking(), hint(), said(), typing?() }.
// typing(): keys pressed just now, so keyboard clatter needs to be louder to count as speech.
// easyBargeIn(): he's on headphones, so talking over the other voice needs only normal speech.
//   Quiz.handsfree.toggle() / .stop() / .on → state; the composer's headphones button calls toggle().
(() => {
  const Q = window.Quiz;
  if (!Q) return;
  const PAUSE_MS = 1100;       // silence that ends a take
  const START_MS = 250;        // speech this long starts a take
  const START_MS_TALKING = 400;
  const MIN_SPEECH_MS = 400;   // shorter takes are noise (a cough, a click)
  const PRE_MS = 800;          // audio kept from before the start (the first word)
  const MAX_MS = 60000;
  const OUT_RATE = 16000;

  const T = () => Q.talkTarget || Q.teachTalk || null;
  let st = null;   // { stream, ctx, node, src, rate, ring: [Float32Array], ringMs, take, floor, ... }
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(api.state); } catch {} });

  function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }

  async function start() {
    if (st) return;
    if (!(Q.think && Q.think.available)) { Q.showToast('Hands-free needs dictation on the server (Settings → Mic).'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      Q.showToast(e.name === 'NotAllowedError' ? 'Microphone blocked: allow it in the browser’s site settings.' : 'No microphone: ' + e.message);
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    // ScriptProcessor: deprecated but everywhere, and fine for one mono stream (≈85 ms frames at 48 kHz).
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain(); mute.gain.value = 0;   // keep the node running without playing the mic back
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    st = { stream, ctx, src, node, mute, rate: ctx.sampleRate, ring: [], ringMs: 0, take: null, floor: 0.008, loudRun: 0, phase: 'listening', level: 0, tick: 0, busy: Promise.resolve() };
    node.onaudioprocess = (e) => frame(new Float32Array(e.inputBuffer.getChannelData(0)));
    emit();
  }

  function stop() {
    if (!st) return;
    const s = st; st = null;
    try { s.node.disconnect(); s.src.disconnect(); s.mute.disconnect(); } catch {}
    s.stream.getTracks().forEach((t) => t.stop());
    s.ctx.close().catch(() => {});
    emit();
  }

  function frame(buf) {
    const s = st;
    if (!s) return;
    const ms = (buf.length / s.rate) * 1000;
    const level = rms(buf);
    s.level = level;
    const tg = T();
    const aiTalking = !!(tg && tg.speaking());
    const typing = !!(tg && tg.typing && tg.typing());
    // On headphones (the target says so) the other voice can't leak into the mic, so cutting in only
    // needs normal speech, a little firmer than usual; on speakers the bar is high so its own voice doesn't count.
    const easy = !!(tg && tg.easyBargeIn && tg.easyBargeIn());
    const hard = typing || (aiTalking && !easy);   // keyboard clatter, or its voice from the speakers
    const thresh = hard ? Math.max(0.045, s.floor * 6) : aiTalking ? Math.max(0.022, s.floor * 3.5) : Math.max(0.018, s.floor * 3);
    const loud = level > thresh;
    if (!s.take) {
      // keep a short ring of recent audio for the pre-roll
      s.ring.push(buf); s.ringMs += ms;
      while (s.ringMs - (s.ring[0].length / s.rate) * 1000 > PRE_MS) { s.ringMs -= (s.ring.shift().length / s.rate) * 1000; }
      if (loud) s.loudRun += ms; else { s.loudRun = 0; if (!aiTalking) s.floor = s.floor * 0.95 + level * 0.05; }   // its voice mustn't raise the floor
      if (s.loudRun >= (hard ? START_MS_TALKING : START_MS)) {
        s.take = { chunks: [...s.ring], ms: s.ringMs, speechMs: s.loudRun, quietMs: 0 };
        s.ring = []; s.ringMs = 0; s.loudRun = 0;
        s.phase = 'hearing';
        if (T()) T().interrupt();   // you started talking: the teacher stops
        emit();
      }
    } else {
      const t = s.take;
      t.chunks.push(buf); t.ms += ms;
      if (loud) { t.speechMs += ms; t.quietMs = 0; } else t.quietMs += ms;
      if (t.quietMs >= PAUSE_MS || t.ms >= MAX_MS) {
        s.take = null;
        s.phase = 'listening';
        emit();
        if (t.speechMs >= MIN_SPEECH_MS) finishTake(t);
      }
    }
    if (++s.tick % 3 === 0) emit();   // the level meter, about 4 times a second
  }

  // ---------- a take → WAV → text → the teacher ----------
  function resample(chunks, from) {
    const n = chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(n);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const ratio = from / OUT_RATE, out = new Float32Array(Math.floor(n / ratio));
    for (let i = 0; i < out.length; i++) {
      const x = i * ratio, i0 = Math.floor(x), f = x - i0;
      out[i] = (all[i0] || 0) * (1 - f) + (all[i0 + 1] || 0) * f;
    }
    return out;
  }
  function wav(samples) {
    const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, OUT_RATE, true);
    v.setUint32(28, OUT_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([b], { type: 'audio/wav' });
  }
  const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  // Its own voice through the speakers: most of the words were in what the teacher just said.
  function isEcho(text) {
    const said = new Set(words(T() && T().said ? T().said() : ''));
    const w = words(text);
    if (w.length < 3 || !said.size) return false;
    return w.filter((x) => said.has(x)).length / w.length >= 0.7;
  }
  function finishTake(t) {
    const s = st;
    if (!s) return;
    const blob = wav(resample(t.chunks, s.rate));
    // One transcription at a time, in order.
    s.busy = s.busy.then(async () => {
      api.transcribing++; emit();
      try {
        const text = (await Q.think.dictate(blob, T() && T().hint ? T().hint() : '')).trim();
        if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) return;   // nothing, or Whisper's [BLANK_AUDIO] / (noise)
        if (isEcho(text)) { console.info('[handsfree] dropped as echo:', text); return; }
        if (T()) T().send(text, { ms: Math.round(t.ms) });
      } catch (e) { Q.showToast(`Couldn't transcribe: ${e.message}`); }
      finally { api.transcribing--; emit(); }
    });
  }

  const api = {
    transcribing: 0,
    get on() { return !!st; },
    get state() { return !st ? 'off' : api.transcribing && st.phase !== 'hearing' ? 'transcribing' : st.phase; },
    get level() { return st ? st.level : 0; },
    get stream() { return st ? st.stream : null; },   // the open mic (the interview records it)
    toggle() { st ? stop() : start(); },
    start, stop,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  };
  Q.handsfree = api;
  // Leaving the lesson or the interview turns it off.
  new MutationObserver(() => { if (st && !document.body.classList.contains('teach-on') && !document.body.classList.contains('interview-on')) stop(); })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
