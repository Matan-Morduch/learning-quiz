// Lab terminal front end: Quiz.lab.Pane draws a live terminal (xterm.js, vendored in ui/xterm*.js)
// for one Teach lesson, plus the list of commands the server cut out of the stream.
// Server side: lab.js. Output arrives over Server-Sent Events; keystrokes go out as small POSTs,
// sent in order. Every lab request carries the X-Quiz-Lab header (lab.js refuses requests without it).
(() => {
  const Q = window.Quiz;
  if (!Q) return;

  const css = `
  .lab-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; border-radius: var(--r-xl);
    background: var(--surface); border: 1px solid var(--separator); box-shadow: var(--shadow-1); position: relative; }
  .lab-head { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--separator); flex: none; }
  .lab-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--label-4); flex: none; }
  .lab-dot.on { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 20%, transparent); }
  .lab-dot.wait { background: var(--orange); }
  .lab-title { min-width: 0; display: flex; flex-direction: column; line-height: 1.15; }
  .lab-title b { font: 600 14px/18px var(--font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lab-title small { font: var(--caption); color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lab-head .spacer { flex: 1; }
  .lab-head .btn { height: 30px; padding: 0 10px; font-size: 13px; gap: 6px; }
  .lab-head .btn svg { width: 15px; height: 15px; }
  .lab-head .lab-n { font: 600 12px/1 var(--font); font-variant-numeric: tabular-nums; }
  .lab-body { position: relative; flex: 1; min-height: 0; display: flex; }
  .lab-term { flex: 1; min-width: 0; padding: 8px 4px 4px 10px; background: var(--lab-bg); }
  .lab-xt { width: 100%; height: 100%; }   /* no padding here: the fit addon measures this box */
  .lab-term .xterm { height: 100%; }
  .lab-term .xterm-viewport { background: transparent !important; }
  .lab-term .xterm-viewport::-webkit-scrollbar { width: 8px; }
  .lab-term .xterm-viewport::-webkit-scrollbar-thumb { background: var(--fill-hover); border-radius: 4px; }
  .lab-msg { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; background: color-mix(in srgb, var(--surface) 88%, transparent);
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); z-index: 2; }
  .lab-msg.hidden { display: none; }
  .lab-msg > div { max-width: 340px; }
  .lab-msg h3 { font: var(--headline); margin: 10px 0 4px; }
  .lab-msg p { font: var(--subhead); color: var(--label-2); margin: 0 0 14px; }
  .lab-msg .lab-ic { width: 44px; height: 44px; margin: 0 auto; border-radius: 12px; display: grid; place-items: center; background: var(--fill); color: var(--label-2); }
  .lab-msg .lab-ic svg { width: 24px; height: 24px; }
  /* command list: slides over the terminal */
  .lab-log { position: absolute; inset: 0; z-index: 3; overflow-y: auto; background: var(--surface); padding: 6px 0 12px; }
  .lab-log.hidden { display: none; }
  .lab-log .empty { padding: 28px 20px; font: var(--subhead); color: var(--label-2); text-align: center; }
  .lab-row { border-bottom: 1px solid var(--separator); }
  .lab-row > button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; width: 100%; padding: 10px 14px; border: 0; background: none; text-align: left; cursor: pointer; color: var(--label); }
  .lab-row > button:hover { background: var(--fill); }
  .lab-row code { font: 500 13px/18px var(--font-mono) !important; white-space: pre-wrap; overflow-wrap: anywhere; background: none !important; padding: 0 !important; }
  .lab-row .meta { grid-column: 1 / -1; font: var(--caption); color: var(--label-2); }
  .lab-row .ex { font: 600 11.5px/1 var(--font-mono); padding: 4px 7px; border-radius: 6px; align-self: start;
    background: color-mix(in srgb, var(--green) 16%, transparent); color: color-mix(in srgb, var(--green) 80%, var(--label)); }
  .lab-row .ex.bad { background: color-mix(in srgb, var(--red) 14%, transparent); color: var(--red); }
  .lab-row .new { color: var(--accent); font-weight: 600; }
  .lab-out { padding: 0 14px 12px; }
  .lab-out pre { margin: 0; max-height: 320px; overflow: auto; padding: 10px 12px; border-radius: var(--r); background: var(--surface-2); font: 400 12px/1.45 var(--font-mono); white-space: pre; }
  .lab-out .row { display: flex; gap: 8px; margin-top: 8px; }
  .lab-out .btn { height: 28px; font-size: 13px; padding: 0 10px; }
  /* the bar under the terminal: what the teacher will see */
  .lab-foot { flex: none; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 8px 6px 14px; border-top: 1px solid var(--separator); font: var(--footnote); color: var(--label-2); }
  .lab-foot .grow { flex: 1; min-width: 0; }
  .lab-foot .btn { height: 30px; font-size: 13px; padding: 0 12px; flex: none; }
  .lab-foot b { color: var(--label); font-weight: 600; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const esc = Q.esc;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

  // ---------- requests ----------

  async function api(path, body) {
    const init = body === undefined ? { headers: { 'X-Quiz-Lab': '1' } }
      : { method: 'POST', headers: { 'X-Quiz-Lab': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const r = await fetch(path, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { data: j, status: r.status });
    return j;
  }

  let statusCache = null;
  async function status(force) {
    if (!force && statusCache && Date.now() - statusCache.at < 10000) return statusCache.value;
    const value = await api(`api/lab/status${force ? '?force=1' : ''}`).catch((e) => ({ ok: false, error: e.message }));
    statusCache = { at: Date.now(), value };
    return value;
  }

  // xterm.js is ~280 KB: load it the first time a terminal opens.
  let xtermP = null;
  function loadXterm() {
    if (window.Terminal && window.FitAddon) return Promise.resolve();
    if (xtermP) return xtermP;
    const script = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(`couldn't load ${src}`)); document.head.appendChild(s); });
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'ui/xterm.css';
    document.head.appendChild(link);
    xtermP = script('ui/xterm.js').then(() => script('ui/xterm-fit.js')).catch((e) => { xtermP = null; throw e; });
    return xtermP;
  }

  // Terminal colours from the app's own tokens (resolved to rgb by the browser), light or dark.
  function theme() {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const get = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
    const dark = Q.prefs ? Q.prefs.isDark() : matchMedia('(prefers-color-scheme: dark)').matches;
    const t = {
      background: dark ? '#1c1c1e' : '#fbfbfd', foreground: get('--label'), cursor: get('--accent'), cursorAccent: dark ? '#1c1c1e' : '#fbfbfd',
      selectionBackground: dark ? 'rgba(10,132,255,.35)' : 'rgba(0,122,255,.22)',
      black: dark ? '#3a3a3c' : '#1d1d1f', red: dark ? '#ff6961' : '#c41a16', green: dark ? '#4cd964' : '#007400', yellow: dark ? '#ffd60a' : '#826b28',
      blue: dark ? '#64a8ff' : '#0b4fd6', magenta: dark ? '#da8fff' : '#a12aa1', cyan: dark ? '#70d7ff' : '#0e7c86', white: dark ? '#d1d1d6' : '#8e8e93',
      brightBlack: '#8e8e93', brightRed: dark ? '#ff8a80' : '#e0362a', brightGreen: dark ? '#7ee787' : '#1f9d38', brightYellow: dark ? '#ffe066' : '#a68a1a',
      brightBlue: dark ? '#8cc0ff' : '#2f6fe8', brightMagenta: dark ? '#e7b0ff' : '#c040c0', brightCyan: dark ? '#9be7ff' : '#1497a3', brightWhite: dark ? '#ffffff' : '#3a3a3c',
    };
    probe.remove();
    return t;
  }

  const ago = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`);

  // ---------- one terminal pane ----------
  //
  // new Pane(container, owner, { seen(): id the teacher already saw, onCommand(cmd), onAsk(cmd), onShare(), shareDisabled(),
  //   dir(): the lesson folder relative to home ("lessons/<slug>"): the shell starts there, and a header button cds back to it })

  class Pane {
    constructor(container, owner, opts = {}) {
      this.owner = owner; this.opts = opts;
      this.offset = 0; this.cmds = []; this.alive = false; this.disposed = false;
      this.q = ''; this.sending = false;
      this.el = el(`<div class="lab-pane">
        <div class="lab-head">
          <span class="lab-dot wait"></span>
          <div class="lab-title"><b>Lab terminal</b><small>Connecting…</small></div>
          <span class="spacer"></span>
          <button class="btn btn-plain hidden" type="button" data-a="dir">${icon('folder')}<span>Lesson folder</span></button>
          <button class="btn btn-plain" type="button" data-a="log" title="Commands you ran, as the teacher sees them" aria-pressed="false">${icon('list')}<span>Commands</span><span class="lab-n"></span></button>
          <button class="icon-btn" type="button" data-a="hide" aria-label="Hide the terminal" title="Hide (it keeps running)">${icon('close')}</button>
        </div>
        <div class="lab-body">
          <div class="lab-term"><div class="lab-xt"></div></div>
          <div class="lab-msg hidden"></div>
          <div class="lab-log hidden" role="list"></div>
        </div>
        <div class="lab-foot"></div>
      </div>`);
      container.appendChild(this.el);
      this.$ = (s) => this.el.querySelector(s);
      this.$('[data-a=log]').onclick = () => this.toggleLog();
      const dirBtn = this.$('[data-a=dir]');
      const dir = this.dir();
      if (dir) {
        dirBtn.classList.remove('hidden');
        dirBtn.title = `Go to ~/${dir}`;
        dirBtn.onclick = () => this.goToDir();
      }
      this.$('[data-a=hide]').onclick = () => opts.onHide && opts.onHide();
    }

    async start() {
      try { await loadXterm(); }
      catch (e) { this.message('warning', 'Couldn’t load the terminal', e.message); return; }
      if (this.disposed) return;
      const box = this.$('.lab-term');
      const th = theme();
      box.style.setProperty('--lab-bg', th.background);
      this.term = new window.Terminal({
        // A concrete font (not ui-monospace / "SF Mono"): xterm measures characters on a canvas, and Safari's
        // canvas can't use ui-monospace, so it measured a fallback font while the page drew SF Mono, and the
        // last letters of a full line were cut off. Menlo is on every Mac; the others cover Linux.
        fontFamily: 'Menlo, Monaco, "DejaVu Sans Mono", "Liberation Mono", monospace', fontSize: 13, lineHeight: 1.18, cursorBlink: true,
        scrollback: 5000, macOptionIsMeta: true, allowProposedApi: false, theme: th,
      });
      this.fit = new window.FitAddon.FitAddon();
      this.term.loadAddon(this.fit);
      this.term.open(box.querySelector('.lab-xt'));
      this.fitNow();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.fitNow());
      this.term.onData((d) => this.send(d));
      this.term.onResize(({ cols, rows }) => { if (this.alive) api(`api/lab/term/${this.owner}/resize`, { cols, rows }).catch(() => {}); });
      this.ro = new ResizeObserver(() => this.fitNow());
      this.ro.observe(box);
      // Follows Settings → Look → Theme (quiz:theme), which already includes the system's changes.
      this.onScheme = () => { const t = theme(); this.term.options.theme = t; box.style.setProperty('--lab-bg', t.background); };
      window.addEventListener('quiz:theme', this.onScheme);
      try { this.cmds = (await api(`api/lab/term/${this.owner}/commands`)).commands || []; } catch {}
      this.renderLog(); this.renderFoot();
      await this.connect();
    }

    dir() {
      const d = this.opts.dir && this.opts.dir();
      return d && /^lessons\/[a-z0-9][a-z0-9-]{0,40}$/.test(d) ? d : null;
    }
    // Clear whatever is half-typed (Ctrl-E, Ctrl-U), then cd into the lesson folder (made if missing).
    // dirPath comes from the server (the folder under the chosen lessons folder, already shell-quoted).
    goToDir() {
      const d = this.dirPath;
      if (!d || !this.alive) return;
      this.send(`\x05\x15mkdir -p ${d} && cd ${d}\r`);
      this.focus();
    }

    async connect() {
      this.setDot('wait', 'Connecting…');
      this.message(null);
      let r;
      try { r = await api(`api/lab/term/${this.owner}/open`, { cols: this.term.cols, rows: this.term.rows, dir: this.dir() || undefined }); }
      catch (e) {
        const st = e.data && e.data.status;
        this.setDot('', st && st.host ? `${st.host} · offline` : 'Offline');
        this.message('terminal', st && st.mode === 'local' ? 'The lab terminal didn’t start' : 'Can’t reach your lab machine', e.message, 'Try again');
        return;
      }
      if (this.disposed) return;
      const st = r.status || {};
      this.$('.lab-title b').textContent = st.hostname || st.host || 'Lab terminal';
      this.host = st;
      this.dirPath = r.dirPath || null;
      this.stream();
      this.term.focus();
    }

    stream() {
      if (this.es) this.es.close();
      const es = new EventSource(`api/lab/term/${this.owner}/stream?since=${this.offset}`);
      this.es = es;
      es.onmessage = (m) => {
        let ev; try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === 'data') {
          // Reconnects replay from where the URL said: skip what's already on screen.
          let d = ev.d;
          if (ev.o + d.length <= this.offset) return;
          if (ev.o < this.offset) d = d.slice(this.offset - ev.o);
          this.offset = ev.o + ev.d.length;
          this.term.write(d);
        } else if (ev.type === 'reset') { this.term.reset(); this.offset = 0; }
        else if (ev.type === 'state') { this.setAlive(ev.alive); }
        else if (ev.type === 'exit') { this.setAlive(false); }
        else if (ev.type === 'cmd') {
          if (!this.cmds.some((c) => c.id === ev.cmd.id)) this.cmds.push(ev.cmd);
          this.renderLog(); this.renderFoot();
          if (this.opts.onCommand) this.opts.onCommand(ev.cmd);
        }
      };
      // The stream closed for good (e.g. the server restarted and the terminal is gone: 404). Retry a few
      // times for a network blip, then show Reconnect instead of retrying forever behind a green dot.
      es.onopen = () => { this.streamFails = 0; };
      es.onerror = () => {
        if (es.readyState !== EventSource.CLOSED || this.disposed || this.es !== es) return;
        this.streamFails = (this.streamFails || 0) + 1;
        if (this.streamFails > 3) { this.setAlive(false); return; }
        setTimeout(() => { if (this.alive && this.es === es && !this.disposed) this.stream(); }, 2000);
      };
    }

    setAlive(on) {
      this.alive = on;
      const st = this.host || {};
      if (on) { this.setDot('on', [st.user, st.os].filter(Boolean).join(' · ') || 'Connected'); this.message(null); }
      else { this.setDot('', 'Disconnected'); this.message('terminal', 'The terminal disconnected', 'The shell ended, the server restarted, or the network dropped. Your scrollback and command log are kept.', 'Reconnect'); }
    }

    setDot(cls, sub) {
      this.$('.lab-dot').className = `lab-dot ${cls}`;
      this.$('.lab-title small').textContent = sub;
    }

    // A message over the terminal (offline, failed to load). `action`: a button that reconnects.
    message(ic, title, text, action) {
      const m = this.$('.lab-msg');
      if (!ic) { m.classList.add('hidden'); return; }
      m.innerHTML = `<div><div class="lab-ic">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text || '')}</p>${action ? `<button class="btn btn-tinted" type="button">${icon('refresh')}${esc(action)}</button>` : ''}</div>`;
      m.classList.remove('hidden');
      const b = m.querySelector('button');
      if (b) b.onclick = async () => { b.disabled = true; await status(true); this.connect(); };
    }

    // Keystrokes go out in order, batched while a request is in flight.
    send(d) {
      if (!this.alive) return;
      this.q += d;
      if (this.sending) return;
      this.sending = true;
      (async () => {
        while (this.q && !this.disposed) {
          const chunk = this.q; this.q = '';
          try { await api(`api/lab/term/${this.owner}/input`, { data: chunk }); }
          catch (e) { this.q = ''; if (e.status === 409) this.setAlive(false); else Q.showToast(e.message); }
        }
        this.sending = false;
      })();
    }

    newCount() { const seen = this.opts.seen ? this.opts.seen() : 0; return this.cmds.filter((c) => c.id > seen).length; }

    renderFoot() {
      const n = this.newCount();
      this.$('.lab-n').textContent = this.cmds.length ? String(this.cmds.length) : '';
      const f = this.$('.lab-foot');
      f.innerHTML = n
        ? `<span class="grow"><b>${n} new command${n === 1 ? '' : 's'}</b>. The teacher sees ${n === 1 ? 'it' : 'them'} with your next answer or message.</span><button class="btn btn-tinted" type="button">Show the teacher</button>`
        : `<span class="grow">You type every command. The teacher sees what you ran with your next answer or message.</span>`;
      const b = f.querySelector('button');
      if (b) { b.disabled = !!(this.opts.shareDisabled && this.opts.shareDisabled()); b.onclick = () => this.opts.onShare && this.opts.onShare(); }
    }

    toggleLog(force) {
      const log = this.$('.lab-log');
      const show = force !== undefined ? force : log.classList.contains('hidden');
      log.classList.toggle('hidden', !show);
      this.$('[data-a=log]').setAttribute('aria-pressed', String(show));
      if (show) { this.renderLog(); log.scrollTop = log.scrollHeight; } else if (this.term) this.term.focus();
    }

    renderLog() {
      const log = this.$('.lab-log');
      if (log.classList.contains('hidden') && !this.logDirty) { this.logDirty = true; return; }
      this.logDirty = false;
      const seen = this.opts.seen ? this.opts.seen() : 0;
      if (!this.cmds.length) { log.innerHTML = '<div class="empty">Commands you run show up here, with their output and exit code. This is what the teacher reads.</div>'; return; }
      log.innerHTML = '';
      for (const c of this.cmds) {
        const row = el(`<div class="lab-row" role="listitem"><button type="button"><code>$ ${esc(c.cmd)}</code><span class="ex${c.exit ? ' bad' : ''}" title="exit code">${c.exit}</span>
          <span class="meta">${c.id > seen ? '<span class="new">Not seen by the teacher yet</span> · ' : ''}${esc(ago(c.ts))} · ${esc(c.cwd || '')} · ${c.lines} line${c.lines === 1 ? '' : 's'}${c.ms >= 1000 ? ` · ${fmtMs(c.ms)}` : ''}${c.cut ? ` · ${c.cut} lines cut` : ''}</span></button></div>`);
        row.querySelector('button').onclick = () => this.expand(row, c);
        log.appendChild(row);
      }
    }

    async expand(row, c) {
      const open = row.querySelector('.lab-out');
      if (open) { open.remove(); return; }
      const out = el(`<div class="lab-out"><pre>Loading…</pre><div class="row"><button class="btn btn-sm" type="button">${icon('chat')}Ask about this</button></div></div>`);
      row.appendChild(out);
      out.querySelector('button').onclick = () => { if (this.opts.onAsk) this.opts.onAsk(c); };
      try { const full = await api(`api/lab/term/${this.owner}/command/${c.id}`); out.querySelector('pre').textContent = full.output || '(no output)'; }
      catch (e) { out.querySelector('pre').textContent = e.message; }
    }

    focus() { if (this.term) this.term.focus(); }

    // Fit the terminal to its box, checked against what the browser really draws: the fit addon trusts
    // xterm's measured cell width, and when that's a little narrower than the drawn letters (a font or
    // zoom mismatch) the shell gets more columns than fit, and the line's last letters are cut off.
    // So measure 100 letters in the rows' own style, keep the smaller column count, and leave one spare.
    fitNow() {
      if (!this.term || !this.fit) return;
      let dims;
      try { dims = this.fit.proposeDimensions(); } catch { return; }
      if (!dims || !dims.cols || !dims.rows || !isFinite(dims.cols)) return;
      let cols = dims.cols;
      try {
        const rowsEl = this.term.element.querySelector('.xterm-rows');
        const screen = this.term.element.querySelector('.xterm-screen');
        const box = this.term.element.parentElement;
        if (rowsEl && screen && box) {
          const probe = document.createElement('span');
          probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none';
          probe.textContent = 'W'.repeat(100);
          rowsEl.appendChild(probe);
          const drawn = probe.getBoundingClientRect().width / 100;
          probe.remove();
          // The room for text: the box, minus the scrollbar xterm reserves (as the fit addon does).
          // (xterm's rule: the measured scrollbar, or 15px when it's an overlay; scaled for the text-size zoom).
          const vp = this.term.element.querySelector('.xterm-viewport');
          const scale = box.getBoundingClientRect().width / (box.offsetWidth || 1);
          const bar = ((vp ? vp.offsetWidth - vp.clientWidth : 0) || 15) * scale;
          const room = box.getBoundingClientRect().width - bar;
          if (drawn > 0) cols = Math.min(cols, Math.floor(room / drawn));
        }
      } catch {}
      cols = Math.max(20, cols - 1);
      if (cols !== this.term.cols || dims.rows !== this.term.rows) this.term.resize(cols, dims.rows);
    }

    dispose() {
      this.disposed = true;
      if (this.es) this.es.close();
      if (this.ro) this.ro.disconnect();
      if (this.onScheme) window.removeEventListener('quiz:theme', this.onScheme);
      if (this.term) this.term.dispose();
      this.el.remove();
    }
  }

  Q.lab = { api, status, Pane, loadXterm };
})();
