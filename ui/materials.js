// 📎 Materials front end (server: materials.js). Used by Teach (ui/teach.js):
//   Quiz.materials.library(box, { onUse(att) })   the "Materials" section on the Teach page
//   Quiz.materials.pick({ goal, subject, material }) → Promise<att | null>   the attach sheet
//   Quiz.materials.upload(files, { subject }) → Promise<material>   (several photos → one photo set)
//   Quiz.materials.chip(att, { removable })       markup of an attachment token
//   Quiz.materials.openUrl(att)                   where to view it (PDF opens at its first page)
// att = { id, title, kind, pages: "40-55" (as typed), range: "40–55", role, count }
(() => {
  const Q = window.Quiz;
  if (!Q) return;
  const esc = Q.esc;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

  const ROLES = [
    { id: 'learned', label: 'Covered today', hint: 'Teach exactly what these pages cover, their way' },
    { id: 'practice', label: 'Practice from', hint: 'Get me ready to solve these exercises myself' },
    { id: 'reference', label: 'Reference', hint: 'Background the teacher can use' },
  ];
  const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));
  const KIND_ICON = { pdf: 'note', images: 'photo', text: 'list' };
  const ACCEPT = '.pdf,application/pdf,image/*,.md,.txt,.markdown,.py,.c,.h,.cpp,.java,.js,.ts,.go,.rs,.sh,.json,.csv,.yaml,.yml';

  const css = `
  .mt-sec { margin-top: 40px; }
  .mt-sec .list-header { display: flex; align-items: baseline; gap: 12px; padding-left: 16px; padding-bottom: 10px; font: var(--title3); font-size: 20px; color: var(--label); }
  .mt-sec .list-header .mt-acts { margin-left: auto; display: inline-flex; gap: 6px; padding-right: 4px; }
  .mt-sec .list-header .btn { font: 500 14px/1 var(--font); }
  .mt-drop { position: relative; }
  .mt-drop.over::after { content: "Drop to add to your materials"; position: absolute; inset: 0; display: grid; place-items: center; border-radius: var(--r-lg);
    border: 2px dashed var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); color: var(--accent); font: var(--headline); z-index: 3; }
  .mt-subj { font: var(--footnote); font-weight: 600; color: var(--label-2); text-transform: uppercase; letter-spacing: .04em; padding: 12px 16px 4px; }
  .mt-row { cursor: pointer; padding: 10px 8px 10px 16px; align-items: center; transition: background var(--dur); }
  .mt-row:hover { background: var(--fill); }
  .mt-ic { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; flex: none; background: var(--accent-tint); color: var(--accent); }
  .mt-ic svg { width: 19px; height: 19px; }
  .mt-ic.images { background: color-mix(in srgb, var(--orange) 14%, transparent); color: color-mix(in srgb, var(--orange) 85%, var(--label)); }
  .mt-ic.text { background: var(--fill); color: var(--label-2); }
  .mt-row .t { font: var(--body); color: var(--label); overflow-wrap: anywhere; }
  .mt-row .m { font: var(--footnote); color: var(--label-2); margin-top: 2px; }
  .mt-empty { padding: 16px; font: var(--subhead); color: var(--label-2); }
  .mt-empty b { color: var(--label); font-weight: 600; }
  .mt-up { display: flex; align-items: center; gap: 10px; padding: 12px 16px; font: var(--subhead); color: var(--label-2); }
  .mt-up .bar { flex: 1; height: 4px; border-radius: 2px; background: var(--fill); overflow: hidden; }
  .mt-up .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
  .mt-warn { padding: 10px 16px; font: var(--footnote); color: var(--orange); }

  /* the attach sheet */
  .mt-pick .mt-search { width: 100%; }
  .mt-pick .list { max-height: 46vh; overflow-y: auto; }
  .mt-pick .mt-row { min-height: 52px; }
  .mt-pick .mt-row[aria-selected="true"] { background: var(--accent-tint); }
  .mt-sel { display: flex; gap: 12px; align-items: center; }
  .mt-sel .t { font: var(--headline); overflow-wrap: anywhere; }
  .mt-sel .m { font: var(--footnote); color: var(--label-2); margin-top: 2px; }
  .mt-field label { display: block; font: var(--footnote); font-weight: 600; color: var(--label-2); margin-bottom: 6px; }
  .mt-field .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .mt-field input.field { max-width: 220px; font-size: 16px; }
  .mt-field .note { font: var(--footnote); color: var(--label-2); }
  .mt-field .note button { border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; padding: 0; }
  .mt-field .err { font: var(--footnote); color: var(--red); margin-top: 6px; }
  .mt-roles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .mt-roles button { display: block; text-align: left; padding: 10px 12px; border-radius: var(--r-md); border: 1px solid var(--separator); background: var(--surface); cursor: pointer; color: var(--label); }
  .mt-roles button b { display: block; font: var(--subhead); font-weight: 600; }
  .mt-roles button span { display: block; font: var(--caption1, 12px/1.3 var(--font)); color: var(--label-2); margin-top: 3px; }
  .mt-roles button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-tint); box-shadow: 0 0 0 1px var(--accent) inset; }
  .mt-thumbs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; min-height: 20px; }
  .mt-thumbs figure { margin: 0; flex: none; text-align: center; }
  .mt-thumbs img { display: block; height: 118px; border-radius: 6px; border: 1px solid var(--separator); background: #fff; }
  .mt-thumbs figcaption { font: var(--caption2, 11px/1.3 var(--font)); color: var(--label-2); margin-top: 3px; }
  .mt-thumbs .more { align-self: center; font: var(--footnote); color: var(--label-2); padding: 0 6px; }
  @media (max-width: 640px) { .mt-roles { grid-template-columns: 1fr; } .mt-thumbs img { height: 96px; } }

  /* attachment tokens */
  .mt-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 30px; padding: 0 4px 0 10px; border-radius: var(--r-pill);
    background: var(--accent-tint); color: var(--accent); font: 500 14px/1 var(--font); }
  .mt-chip > svg { width: 15px; height: 15px; flex: none; }
  .mt-chip .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .mt-chip .rl { color: var(--label-2); font-weight: 400; white-space: nowrap; }
  .mt-chip .icon-btn { width: 24px; height: 24px; color: inherit; flex: none; }
  .mt-chip .icon-btn svg { width: 13px; height: 13px; }
  .mt-chip:not(:has(.icon-btn)) { padding-right: 12px; }
  `;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  let cache = null;
  async function load(force) {
    if (!cache || force) cache = await Q.api('api/materials');
    return cache;
  }
  const pagesWord = (m) => (m.kind === 'images' ? (m.pages === 1 ? 'photo' : 'photos') : m.pages === 1 ? 'page' : 'pages');
  function metaLine(m, withSubject = true) {
    const bits = [];
    if (withSubject && m.subject) bits.push(esc(m.subject));
    if (m.kind === 'text') bits.push('text');
    else bits.push(`${m.pages} ${pagesWord(m)}`);
    if (m.textless) bits.push('scanned');
    if (m.lastPages) bits.push(`last: p. ${esc(m.lastPages)}`);
    return bits.join(' · ');
  }

  // ---------- upload ----------

  function send(file, url, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch {}
        if (x.status >= 200 && x.status < 300) resolve(d); else reject(new Error(d.error || `Upload failed (${x.status})`));
      };
      x.onerror = () => reject(new Error('Upload failed (connection)'));
      x.send(file);
    });
  }
  // Several photos picked together become one photo set (its pages = the photos, in order).
  async function upload(files, { subject, onProgress } = {}) {
    files = [...files].filter(Boolean);
    if (!files.length) return null;
    const isImg = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(f.name);
    const photos = files.filter(isImg).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const others = files.filter((f) => !isImg(f));
    const total = files.reduce((n, f) => n + f.size, 0) || 1;
    let done = 0;
    const prog = (f) => (p) => onProgress && onProgress((done + p * f.size) / total);
    const q = (name, extra = '') => `api/materials/upload?name=${encodeURIComponent(name)}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}${extra}`;
    let last = null;
    for (const f of others) { last = await send(f, q(f.name), prog(f)); done += f.size; }
    if (photos.length) {
      const name = photos.length > 1 ? `Photos ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : (photos[0].name.startsWith('image.') ? `Photo ${new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : photos[0].name);
      const first = await send(photos[0], q(photos.length > 1 ? `${name}.jpg` : photos[0].name.startsWith('image.') ? `${name}.jpg` : name), prog(photos[0]));
      done += photos[0].size;
      for (const f of photos.slice(1)) { last = await send(f, `api/materials/upload?name=${encodeURIComponent(f.name)}&to=${first.id}`, prog(f)); done += f.size; }
      last = photos.length > 1 ? last : first;
    }
    await load(true);
    return last;
  }

  // Wire drag-and-drop of files onto an element. onFiles(FileList).
  function dropZone(node, onFiles) {
    let depth = 0;
    const has = (e) => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');
    node.addEventListener('dragenter', (e) => { if (!has(e)) return; e.preventDefault(); depth++; node.classList.add('over'); });
    node.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
    node.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; node.classList.remove('over'); } });
    node.addEventListener('drop', (e) => { if (!has(e)) return; e.preventDefault(); depth = 0; node.classList.remove('over'); onFiles(e.dataTransfer.files); });
  }
  // Pasted images (a screenshot, a photo copied from Photos).
  function pastedFiles(e) {
    const out = [];
    for (const it of (e.clipboardData && e.clipboardData.items) || []) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); }
    return out;
  }
  function chooseFiles({ multiple = true } = {}) {
    return new Promise((resolve) => {
      // In the page (hidden): a detached input may never fire change in some browsers.
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT, multiple, hidden: true });
      document.body.appendChild(inp);
      inp.onchange = () => { resolve(inp.files && inp.files.length ? [...inp.files] : null); inp.remove(); };
      inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
      inp.click();
    });
  }

  // ---------- the library section (Teach page) ----------

  async function library(box, { onUse } = {}) {
    box.classList.add('mt-sec');
    let data;
    try { data = await load(true); } catch (e) { box.innerHTML = ''; return; }
    const subjOpts = (cur) => `<option value="">No subject</option>${data.subjects.map((s) => `<option${s === cur ? ' selected' : ''}>${esc(s)}</option>`).join('')}`;
    box.innerHTML = `<div class="list-header">Materials<span class="mt-acts"><button class="btn btn-sm btn-tinted" type="button" data-a="up">${icon('plus')}Add files</button></span></div>
      <div class="list mt-drop"></div>`;
    const list = box.querySelector('.list');
    const addFiles = async (files) => {
      if (!files || !files.length) return;
      const up = el(`<div class="mt-up"><span>Uploading ${files.length === 1 ? esc(files[0].name) : `${files.length} files`}…</span><span class="bar"><i></i></span></div>`);
      list.prepend(up);
      try {
        await upload(files, { subject: localStorage.getItem('teach.subject') || '', onProgress: (p) => { up.querySelector('i').style.width = `${Math.round(p * 100)}%`; } });
        library(box, { onUse });
      } catch (e) { up.remove(); Q.showToast(e.message); }
    };
    box.querySelector('[data-a=up]').onclick = async () => addFiles(await chooseFiles());
    dropZone(list, addFiles);
    if (!data.pdf) list.appendChild(el(`<div class="mt-warn">${icon('warning')} The PDF reader isn't installed on the server, so only text files can be added. Run <code>tools/pdf/install.sh</code> there.</div>`));
    if (!data.materials.length) {
      list.appendChild(el(`<div class="mt-empty"><b>Your course material, for the teacher.</b> Add a book or slides as PDF, photos of pages, or a text file (or drop them here). Then attach pages to a lesson: “we covered pages 40–55 today”, or “practice is from these pages”, and the teacher teaches from them.</div>`));
      return;
    }
    // Grouped by subject (most recently used first inside each).
    const groups = new Map();
    for (const m of data.materials) { const k = m.subject || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    const keys = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
    for (const k of keys) {
      if (keys.length > 1 || k) list.appendChild(el(`<div class="mt-subj">${esc(k || 'No subject')}</div>`));
      for (const m of groups.get(k)) {
        const row = el(`<div class="list-row mt-row" role="button" tabindex="0">
          <span class="mt-ic ${m.kind}">${icon(KIND_ICON[m.kind] || 'note')}</span>
          <div class="grow"><div class="t">${esc(m.title)}</div><div class="m">${metaLine(m, false)}</div></div>
          <span class="btn btn-sm btn-tinted">Teach me</span>
          <button class="icon-btn tc-more" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false">${icon('ellipsis')}</button>
        </div>`);
        const use = async () => { const a = await pick({ material: m.id, subject: m.subject, goal: (document.getElementById('tcGoal') || {}).value || '' }); if (a && onUse) onUse(a); };
        row.onclick = (e) => { if (!e.target.closest('.tc-more')) use(); };
        row.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); use(); } };
        row.querySelector('.tc-more').onclick = (e) => {
          e.stopPropagation();
          popMenu(e.currentTarget, [
            { label: 'Teach me from it…', icon: 'teach', run: use },
            { label: m.kind === 'pdf' ? 'Open the PDF' : 'Open', icon: 'external', run: () => window.open(openUrl({ id: m.id, kind: m.kind }), '_blank') },
            '-',
            { label: 'Rename…', icon: 'pencil', run: () => edit(m, 'title') },
            { label: 'Subject…', icon: 'book', run: () => edit(m, 'subject', subjOpts) },
            ...(m.kind === 'pdf' ? [{ label: 'Page numbers…', icon: 'list', run: () => edit(m, 'numbers') }] : []),
            ...(m.kind === 'images' ? [{ label: 'Add photos…', icon: 'photo', run: async () => {
              const files = await chooseFiles();
              if (!files) return;
              try { for (const f of files) await send(f, `api/materials/upload?name=${encodeURIComponent(f.name)}&to=${m.id}`); library(box, { onUse }); } catch (err) { Q.showToast(err.message); }
            } }] : []),
            '-',
            { label: 'Delete…', icon: 'trash', danger: true, run: async () => {
              if (!confirm(`Delete “${m.title}” from your materials? Lessons that used it keep what the teacher already read.`)) return;
              try { await Q.api(`api/materials/${m.id}/delete`, {}); library(box, { onUse }); } catch (err) { Q.showToast(err.message); }
            } },
          ]);
        };
        list.appendChild(row);
      }
    }
    async function edit(m, what, opts) {
      const html = what === 'title' ? `<div class="tc-modal-head"><h2>Rename</h2></div><div class="tc-modal-body"><input class="field" id="mtV" value="${esc(m.title)}"></div>`
        : what === 'subject' ? `<div class="tc-modal-head"><h2>Subject</h2><p>Materials are grouped by subject, and the attach sheet shows the lesson's subject first.</p></div><div class="tc-modal-body"><select class="field" id="mtV">${opts(m.subject)}</select></div>`
        : `<div class="tc-modal-head"><h2>Page numbers</h2><p>You type pages as printed in the book. ${m.hasLabels ? `This PDF carries its own page numbers (${esc(m.labelFirst || '')} to ${esc(m.labelLast || '')}), used unless you set one here.` : 'If the PDF has a cover or a preface first, say which PDF page is the book’s page 1.'}</p></div>
           <div class="tc-modal-body"><label class="mt-field"><span class="note">The book's page 1 is PDF page</span> <input class="field" id="mtV" type="number" min="1" max="${m.pages}" value="${m.firstPage > 1 ? m.firstPage : ''}" placeholder="1" style="max-width:120px"></label></div>`;
      const s = el(`<div class="scrim tc-scrim"><div class="tc-modal small" role="dialog" aria-modal="true">${html}<div class="tc-modal-foot"><span class="spacer"></span><button class="btn" data-a="no">Cancel</button><button class="btn btn-primary" data-a="ok">Save</button></div></div></div>`);
      document.body.appendChild(s);
      const close = () => s.remove();
      s.addEventListener('pointerdown', (e) => { if (e.target === s) close(); });
      s.querySelector('[data-a=no]').onclick = close;
      const v = s.querySelector('#mtV'); v.focus();
      s.querySelector('[data-a=ok]').onclick = async () => {
        const body = what === 'title' ? { title: v.value } : what === 'subject' ? { subject: v.value } : { firstPage: v.value ? Number(v.value) : null };
        try { await Q.api(`api/materials/${m.id}`, body); close(); library(box, { onUse }); } catch (e) { Q.showToast(e.message); }
      };
      v.addEventListener('keydown', (e) => { if (e.key === 'Enter') s.querySelector('[data-a=ok]').click(); });
    }
  }

  // A small popover menu (the same look as Teach's).
  let openMenu = null;
  function popMenu(anchor, items) {
    if (openMenu) { const again = openMenu.anchor === anchor; openMenu.close(); if (again) return; }
    const m = el('<div class="popover tc-menu" role="menu"></div>');
    for (const it of items) {
      if (it === '-') { m.appendChild(el('<div class="tc-menu-sep"></div>')); continue; }
      const b = el(`<button type="button" role="menuitem" class="tc-menu-item${it.danger ? ' danger' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`);
      b.onclick = (e) => { e.stopPropagation(); openMenu && openMenu.close(); it.run(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
    const outside = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) openMenu && openMenu.close(); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    openMenu = { anchor, close() { m.remove(); document.removeEventListener('pointerdown', outside, true); openMenu = null; } };
  }

  // ---------- the attach sheet ----------

  // "pages 40-55", "p. 40 to 55", "pp 40–55" in what he wrote: the pages he means.
  function pagesFromText(t) {
    const m = String(t || '').match(/\b(?:pages?|pp?\.?)\s*(\d+(?:\s*(?:-|–|—|to)\s*\d+)?(?:\s*(?:,|and)\s*\d+(?:\s*(?:-|–|—|to)\s*\d+)?)*)/i);
    return m ? m[1].replace(/\s*(?:–|—|to)\s*/g, '-').replace(/\s*and\s*/g, ', ') : '';
  }

  // Resolves to the attachment, or null when cancelled. opts.material: open straight on that one.
  function pick({ goal = '', subject = '', material = null, files = null } = {}) {
    return new Promise(async (resolve) => {
      let data;
      try { data = await load(true); } catch (e) { Q.showToast(e.message); resolve(null); return; }
      const s = el(`<div class="scrim tc-scrim"><div class="tc-modal mt-pick" role="dialog" aria-modal="true" aria-label="Attach material"></div></div>`);
      const panel = s.firstElementChild;
      document.body.appendChild(s);
      let result = null;
      const close = () => { s.remove(); document.removeEventListener('keydown', onKey, true); resolve(result); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
      document.addEventListener('keydown', onKey, true);
      s.addEventListener('pointerdown', (e) => { if (e.target === s) close(); });
      dropZone(panel, (fl) => uploadThen([...fl]));

      async function uploadThen(fl) {
        if (!fl || !fl.length) return;
        panel.innerHTML = `<div class="tc-modal-head"><h2>Adding ${fl.length === 1 ? esc(fl[0].name) : `${fl.length} files`}…</h2></div><div class="tc-modal-body"><div class="mt-up"><span class="bar"><i></i></span></div></div>`;
        try {
          const m = await upload(fl, { subject, onProgress: (p) => { const i = panel.querySelector('.bar i'); if (i) i.style.width = `${Math.round(p * 100)}%`; } });
          data = await load();
          details(data.materials.find((x) => x.id === m.id) || m);
        } catch (e) { Q.showToast(e.message); chooser(); }
      }

      function chooser() {
        const ms = data.materials.slice().sort((a, b) => (b.subject === subject) - (a.subject === subject));
        panel.innerHTML = `<div class="tc-modal-head"><h2>Attach material</h2><p>Pick a file from your materials, or add one. The teacher reads the pages you choose.</p></div>
          <div class="tc-modal-body">
            ${ms.length > 6 ? '<input class="field mt-search" type="search" placeholder="Search your materials" aria-label="Search">' : ''}
            <div class="list">${ms.length ? '' : '<div class="mt-empty">No materials yet. Add a PDF, photos of pages or a text file.</div>'}</div>
          </div>
          <div class="tc-modal-foot"><button class="btn" data-a="up" type="button">${icon('plus')}Add files…</button><span class="spacer"></span><button class="btn" data-a="no" type="button">Cancel</button></div>`;
        const list = panel.querySelector('.list');
        const paint = (q) => {
          list.querySelectorAll('.mt-row').forEach((r) => r.remove());
          for (const m of ms.filter((x) => !q || `${x.title} ${x.subject || ''}`.toLowerCase().includes(q))) {
            const row = el(`<div class="list-row mt-row" role="button" tabindex="0"><span class="mt-ic ${m.kind}">${icon(KIND_ICON[m.kind] || 'note')}</span>
              <div class="grow"><div class="t">${esc(m.title)}</div><div class="m">${metaLine(m)}</div></div>
              <svg class="chevron" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5-5 5"/></svg></div>`);
            row.onclick = () => details(m);
            row.onkeydown = (e) => { if (e.key === 'Enter') details(m); };
            list.appendChild(row);
          }
        };
        paint('');
        const search = panel.querySelector('.mt-search');
        if (search) { search.oninput = () => paint(search.value.trim().toLowerCase()); search.focus(); }
        panel.querySelector('[data-a=no]').onclick = close;
        panel.querySelector('[data-a=up]').onclick = async () => uploadThen(await chooseFiles());
      }

      function details(m) {
        const textOnly = m.kind === 'text';
        const guess = pagesFromText(goal);
        const pre = textOnly ? '' : guess || (m.kind === 'images' ? '' : m.lastPages || '');
        let role = /practi|homework|exercise|assignment|תרגיל/i.test(goal) ? 'practice' : 'learned';
        panel.innerHTML = `<div class="tc-modal-head"><h2>Attach material</h2></div>
          <div class="tc-modal-body">
            <div class="mt-sel"><span class="mt-ic ${m.kind}">${icon(KIND_ICON[m.kind] || 'note')}</span><div class="grow"><div class="t">${esc(m.title)}</div><div class="m">${metaLine(m)}</div></div>
              ${data.materials.length > 1 ? '<button class="btn btn-plain btn-sm" type="button" data-a="other">Change</button>' : ''}</div>
            ${textOnly ? '' : `<div class="mt-field"><label for="mtPages">${m.kind === 'images' ? 'Photos' : 'Pages'}</label>
              <div class="row"><input class="field" id="mtPages" inputmode="numeric" autocomplete="off" placeholder="${m.pages > data.maxPages ? 'e.g. 40-55' : `all ${m.pages}`}" value="${esc(pre)}">
              <span class="note">${m.kind === 'images' ? `of ${m.pages}` : `as printed in the book${m.hasLabels ? '' : ` · <button type="button" data-a="num">Numbers off?</button>`}`}</span></div>
              <div class="err" hidden></div></div>
              <div class="mt-thumbs" aria-label="Preview"></div>`}
            <div class="mt-field"><label>These are…</label><div class="mt-roles">${ROLES.map((r) => `<button type="button" data-role="${r.id}" aria-pressed="${r.id === role}"><b>${r.label}</b><span>${r.hint}</span></button>`).join('')}</div></div>
          </div>
          <div class="tc-modal-foot"><button class="btn" data-a="open" type="button">${icon('external')}Open</button><span class="spacer"></span><button class="btn" data-a="no" type="button">Cancel</button><button class="btn btn-primary" data-a="ok" type="button">Attach</button></div>`;
        panel.querySelector('[data-a=no]').onclick = close;
        const other = panel.querySelector('[data-a=other]');
        if (other) other.onclick = chooser;
        panel.querySelector('[data-a=open]').onclick = () => window.open(openUrl({ id: m.id, kind: m.kind, first: null }), '_blank');
        panel.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => {
          role = b.dataset.role;
          panel.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        }));
        const inp = panel.querySelector('#mtPages');
        const err = panel.querySelector('.err');
        const thumbs = panel.querySelector('.mt-thumbs');
        const ok = panel.querySelector('[data-a=ok]');
        let resolved = null, seq = 0, timer = null;
        async function check() {
          const my = ++seq;
          try {
            const r = await Q.api(`api/materials/${m.id}/resolve`, { pages: inp ? inp.value : '', role });
            if (my !== seq) return;
            resolved = r;
            if (err) err.hidden = true;
            ok.disabled = false;
            if (thumbs) {
              const show = r.pages.length > 8 ? [...r.pages.slice(0, 6), null, r.pages[r.pages.length - 1]] : r.pages;
              thumbs.innerHTML = show.map((i, k) => i === null ? `<span class="more">+${r.pages.length - 7}</span>`
                : `<figure><img loading="lazy" alt="" src="api/materials/${m.id}/page/${i}.jpg?w=360"><figcaption>${m.kind === 'images' ? 'photo' : 'p.'} ${esc(r.names[r.pages.indexOf(i)] || String(i + 1))}</figcaption></figure>`).join('');
            }
          } catch (e) {
            if (my !== seq) return;
            resolved = null; ok.disabled = true;
            if (err) { err.textContent = e.message; err.hidden = false; }
            if (thumbs) thumbs.innerHTML = '';
          }
        }
        if (inp) {
          inp.oninput = () => { clearTimeout(timer); timer = setTimeout(check, 350); };
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); check().then(() => !ok.disabled && ok.click()); } });
          setTimeout(() => inp.focus(), 30);
        }
        const num = panel.querySelector('[data-a=num]');
        if (num) num.onclick = async () => {
          const v = prompt(`Which PDF page is the book's page 1? (now: ${m.firstPage || 1})`, String(m.firstPage || 1));
          if (v === null) return;
          try { const nm = await Q.api(`api/materials/${m.id}`, { firstPage: v.trim() ? Number(v) : null }); Object.assign(m, nm); check(); } catch (e) { Q.showToast(e.message); }
        };
        check();
        ok.onclick = async () => {
          if (inp) { clearTimeout(timer); await check(); }
          if (!resolved) return;
          result = { id: m.id, title: m.title, kind: m.kind, pages: inp ? inp.value.trim() : '', range: resolved.range, role, count: resolved.count, first: resolved.pages[0] ?? null };
          close();
        };
      }

      if (files && files.length) uploadThen(files);
      else if (material) { const m = data.materials.find((x) => x.id === material); m ? details(m) : chooser(); }
      else chooser();
    });
  }

  // ---------- tokens ----------

  function chip(a, { removable = false } = {}) {
    const name = `${a.title}${a.range ? ` · p. ${a.range}` : ''}`;
    return `<span class="mt-chip" title="${esc(`${name} (${ROLE_LABEL[a.role] || ''})`)}">${icon(a.kind === 'images' ? 'photo' : 'paperclip')}<span class="nm">${esc(name)}</span><span class="rl">${esc(ROLE_LABEL[a.role] || '')}</span>${removable ? `<button class="icon-btn" type="button" aria-label="Remove">${icon('close')}</button>` : ''}</span>`;
  }
  function openUrl(a) {
    if (a.kind === 'images') return `api/materials/${a.id}/page/${a.first || 0}.jpg?w=1600`;
    return `api/materials/${a.id}/file${a.kind === 'pdf' && a.first != null ? `#page=${a.first + 1}` : ''}`;
  }

  Q.materials = { library, pick, upload, chip, openUrl, pastedFiles, dropZone, ROLE_LABEL, pagesFromText };
})();
