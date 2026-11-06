// 📎 Materials: files the teacher can read (Teach mode). PDFs (a book, slides, a homework sheet),
// photos of pages, and text files, kept in data/materials/<id>/ and sorted by subject.
// A lesson attaches one with a page range and a role ("we covered these today", "practice is from
// these", "just for reference"); teach.js sends those pages to Claude: a PDF as a real PDF document
// (Claude reads the text AND sees the figures), photos as images, text as text.
//
// PDFs need PyMuPDF (tools/pdf/install.sh → ~/.local/share/quiz-pdf). Photos too (they're resized
// to ≤1600 px JPEGs on upload). Without it, only text files can be added.
//
//   GET  /api/materials                     {materials[], subjects[], pdf: bool}
//   POST /api/materials/upload?name=&subject=[&to=<id>]   raw file body → the material (to: add a photo to it)
//   GET  /api/materials/<id>                the material
//   POST /api/materials/<id>                {title?, subject?, firstPage?} → the material
//   POST /api/materials/<id>/delete
//   POST /api/materials/<id>/resolve        {pages: "40-55, 60"} → {pages: [idx], labels: [...]} or 400
//   GET  /api/materials/<id>/file           the PDF / text file itself (Range supported)
//   GET  /api/materials/<id>/page/<idx>.jpg[?w=]   a page (or photo) as a JPEG

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(__dirname, 'data', 'materials');
const PDF_HOME = process.env.QUIZ_PDF_HOME || path.join(os.homedir(), '.local', 'share', 'quiz-pdf');
const PY = path.join(PDF_HOME, 'venv', 'bin', 'python');
const TOOL = path.join(__dirname, 'tools', 'pdf', 'pdftool.py');
const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_PAGES = 40;            // pages one attachment may send (a PDF page is ~1.5–3k tokens)
const PDF_INLINE_MAX = 9 * 1024 * 1024;   // a bigger slice (scans) goes as page images instead
const TEXT_LIMIT = 60000;
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'];
const TEXT_EXT = ['.md', '.txt', '.markdown', '.py', '.c', '.h', '.cpp', '.java', '.js', '.ts', '.go', '.rs', '.sh', '.json', '.csv', '.yaml', '.yml'];

let ctx = null;
const pdfReady = () => fs.existsSync(PY);

function tool(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!pdfReady()) return reject(Object.assign(new Error('The PDF reader is not installed (run tools/pdf/install.sh on the server)'), { status: 503 }));
    execFile(PY, ['-I', TOOL, ...args], { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').pop() || 'pdf tool failed'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('pdf tool: bad output')); }
    });
  });
}

// ---------- storage ----------

const dirOf = (id) => path.join(DIR, id);
const validId = (id) => /^m-[a-z0-9]+-[a-f0-9]{4}$/.test(id || '');
function load(id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'meta.json'), 'utf8')); } catch { return null; }
}
function save(m) {
  m.updated = new Date().toISOString();
  const f = path.join(dirOf(m.id), 'meta.json');
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(m, null, 1));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}
function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).map(load).filter(Boolean).sort((a, b) => (b.lastUsed || b.created).localeCompare(a.lastUsed || a.created));
}
const cleanTitle = (s) => String(s || '').replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);

// What the browser sees.
function publicView(m) {
  if (!m) return null;
  return {
    id: m.id, title: m.title, subject: m.subject || null, kind: m.kind, pages: m.pages || 0, size: m.size || 0,
    origName: m.origName || null, created: m.created, updated: m.updated, lastUsed: m.lastUsed || null, lastPages: m.lastPages || null,
    firstPage: m.firstPage || 1, hasLabels: !!(m.labels && m.labels.some(Boolean)), textless: !!m.textless,
    labelFirst: m.labels ? m.labels[0] || null : null, labelLast: m.labels ? m.labels[m.labels.length - 1] || null : null,
  };
}

// ---------- page numbers ----------
// He says "pages 40-55" meaning the numbers printed in the book. A PDF that carries page labels maps
// them itself; otherwise firstPage = the PDF page where the book's page 1 is (set per material).

function parseSpec(spec) {
  const s = String(spec || '').trim().toLowerCase().replace(/pages?|pp?\.?|and/g, ' ').replace(/[–—]|\bto\b/g, '-').replace(/\s*-\s*/g, '-');
  if (!s.trim()) return [];
  const out = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) throw Object.assign(new Error(`“${part}” isn't a page or a range (like 40-55)`), { status: 400 });
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (b < a) throw Object.assign(new Error(`${a}-${b}: the range goes backwards`), { status: 400 });
    if (b - a > 2000) throw Object.assign(new Error('That range is too big'), { status: 400 });
    for (let n = a; n <= b; n++) out.push(n);
  }
  return [...new Set(out)];
}

// Book page numbers → 0-based PDF page indexes (or photo indexes).
function resolvePages(m, spec) {
  const nums = parseSpec(spec);
  const total = m.pages || 0;
  if (!nums.length) {
    if (m.kind === 'text') return [];
    if (total > MAX_PAGES) throw Object.assign(new Error(`It has ${total} pages: pick which (up to ${MAX_PAGES}), e.g. 40-55`), { status: 400 });
    return [...Array(total).keys()];
  }
  if (m.kind === 'text') return [];
  let idx;
  if (m.kind === 'pdf' && m.labels && m.labels.some(Boolean) && !m.firstPageSet) {
    const at = new Map();
    m.labels.forEach((l, i) => { if (l && !at.has(l)) at.set(l, i); });
    idx = nums.map((n) => (at.has(String(n)) ? at.get(String(n)) : null));
    const miss = nums.filter((n, i) => idx[i] === null);
    if (miss.length) throw Object.assign(new Error(`No page ${miss[0]} in it (its pages run ${m.labels[0] || 1}–${m.labels[total - 1] || total})`), { status: 400 });
  } else {
    const off = (m.kind === 'pdf' ? (m.firstPage || 1) : 1) - 1;
    idx = nums.map((n) => n - 1 + off);
    const bad = nums.find((n, i) => idx[i] < 0 || idx[i] >= total);
    if (bad !== undefined) throw Object.assign(new Error(`No page ${bad} in it (it has ${total} ${m.kind === 'images' ? 'photos' : 'pages'}${off ? `; book page 1 is PDF page ${off + 1}` : ''})`), { status: 400 });
  }
  if (idx.length > MAX_PAGES) throw Object.assign(new Error(`That's ${idx.length} pages: up to ${MAX_PAGES} per attachment`), { status: 400 });
  return idx;
}

// How a page is named to him and to the teacher.
function pageName(m, i) {
  if (m.kind === 'images') return String(i + 1);
  if (m.labels && m.labels[i] && !m.firstPageSet) return m.labels[i];
  return String(i + 2 - (m.firstPage || 1));
}
function rangeText(m, idx) {
  const names = idx.map((i) => pageName(m, i));
  const parts = [];
  for (let k = 0; k < names.length; k++) {
    let j = k;
    while (j + 1 < names.length && /^\d+$/.test(names[j]) && Number(names[j + 1]) === Number(names[j]) + 1) j++;
    parts.push(j > k ? `${names[k]}–${names[j]}` : names[k]);
    k = j;
  }
  return parts.join(', ');
}

// ---------- upload ----------

function receive(req, file, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(file);
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { req.destroy(); out.destroy(); reject(Object.assign(new Error(`The file is too big (over ${Math.round(max / 1048576)} MB)`), { status: 413 })); return; }
      out.write(c);
    });
    req.on('end', () => out.end(() => resolve(size)));
    req.on('error', (e) => { out.destroy(); reject(e); });
  });
}

function kindOf(name, head) {
  const ext = path.extname(name).toLowerCase();
  if (head.slice(0, 5).toString('latin1') === '%PDF-' || ext === '.pdf') return 'pdf';
  if (IMG_EXT.includes(ext) || /^(\xff\xd8\xff|\x89PNG|GIF8|RIFF)/.test(head.slice(0, 4).toString('latin1'))) return 'image';
  if (ext === '.heic' || ext === '.heif') return 'heic';
  if (TEXT_EXT.includes(ext)) return 'text';
  return null;
}

async function upload(req, url) {
  fs.mkdirSync(DIR, { recursive: true });
  const name = cleanTitle(url.searchParams.get('name') || 'file');
  const tmp = path.join(DIR, `.up-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const size = await receive(req, tmp, MAX_UPLOAD);
    if (!size) throw Object.assign(new Error('The file is empty'), { status: 400 });
    const fd = fs.openSync(tmp, 'r'); const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
    const kind = kindOf(name, head);
    if (kind === 'heic') throw Object.assign(new Error('HEIC photos aren’t supported: share it as JPEG (on iPhone: Settings → Camera → Formats → Most Compatible)'), { status: 415 });
    if (!kind) throw Object.assign(new Error('Add a PDF, a photo (JPEG/PNG) or a text file'), { status: 415 });

    // A photo added to an existing photo set ("Add photos" on it).
    const to = url.searchParams.get('to');
    if (to) {
      const m = load(to);
      if (!m || m.kind !== 'images') throw Object.assign(new Error('That photo set is gone'), { status: 404 });
      if (kind !== 'image') throw Object.assign(new Error('Only photos can be added to a photo set'), { status: 415 });
      await tool(['image', tmp, path.join(dirOf(m.id), `p${m.pages}.jpg`), '1600']);
      m.pages += 1; m.size = (m.size || 0) + size;
      save(m);
      return m;
    }

    const id = `m-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    const dir = dirOf(id);
    fs.mkdirSync(dir, { recursive: true });
    const subject = cleanTitle(url.searchParams.get('subject')) || null;
    const m = { id, title: cleanTitle(name.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_]+/g, ' ')) || 'Untitled', subject, origName: name,
      kind: kind === 'image' ? 'images' : kind, size, created: new Date().toISOString() };
    try {
      if (kind === 'pdf') {
        fs.renameSync(tmp, path.join(dir, 'file.pdf'));
        const inf = await tool(['info', path.join(dir, 'file.pdf')]);
        m.pages = inf.pages;
        if (!m.pages) throw Object.assign(new Error('That PDF has no pages'), { status: 400 });
        if (inf.labels.some(Boolean) && inf.labels.some((l, i) => l !== String(i + 1))) m.labels = inf.labels;   // only when they differ from 1..n
        m.firstPage = 1;
        const withText = inf.chars.filter((c) => c > 40).length;
        if (withText < m.pages / 3) m.textless = true;   // a scan: the teacher still sees the pages as images
      } else if (kind === 'image') {
        await tool(['image', tmp, path.join(dir, 'p0.jpg'), '1600']);
        m.pages = 1;
      } else {
        const text = fs.readFileSync(tmp, 'utf8');
        if (text.includes('\u0000')) throw Object.assign(new Error('That doesn’t look like a text file'), { status: 415 });
        fs.renameSync(tmp, path.join(dir, `file${path.extname(name).toLowerCase() || '.txt'}`));
        m.file = `file${path.extname(name).toLowerCase() || '.txt'}`;
        m.chars = text.length;
        m.pages = 0;
      }
    } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
    save(m);
    return m;
  } finally { fs.rmSync(tmp, { force: true }); }
}

// ---------- page images ----------

async function pageJpeg(m, i, w) {
  if (!Number.isInteger(i) || i < 0 || i >= (m.pages || 0)) return null;
  if (m.kind === 'images') return path.join(dirOf(m.id), `p${i}.jpg`);
  if (m.kind !== 'pdf') return null;
  const out = path.join(dirOf(m.id), 'thumbs', String(w));
  const f = path.join(out, `${i}.jpg`);
  if (!fs.existsSync(f)) await tool(['render', path.join(dirOf(m.id), 'file.pdf'), out, String(w), String(i)]);
  return f;
}

// ---------- for the teacher (teach.js) ----------

const ROLES = {
  learned: 'He covered these pages (in class, a lecture or his own reading). Teach toward exactly what they cover, the way they cover it.',
  practice: 'His practice or homework comes from these pages. Prepare him to solve that kind of exercise himself.',
  reference: 'Background reference for this lesson. Use it where it helps; it is not the syllabus.',
};
const ROLE_LABEL = { learned: 'Covered today', practice: 'Practice from', reference: 'Reference' };

// A lesson's attachment, checked: {id, title, kind, pages: [idx], range: "40–55", role}.
function attachment(ref) {
  const m = load(ref && ref.id);
  if (!m) throw Object.assign(new Error('That material is gone'), { status: 404 });
  const role = ROLES[ref.role] ? ref.role : 'learned';
  const idx = resolvePages(m, ref.pages);
  return { id: m.id, title: m.title, kind: m.kind, subject: m.subject || null, spec: String(ref.pages || '').trim().slice(0, 100), pages: idx,
    range: m.kind === 'text' ? '' : rangeText(m, idx), role, count: m.kind === 'text' ? 0 : idx.length };
}

// Remember the pages last used (the picker offers them next time).
function markUsed(a) {
  const m = load(a.id);
  if (!m) return;
  m.lastUsed = new Date().toISOString();
  if (a.spec) m.lastPages = a.spec;
  try { save(m); } catch {}
}

// Content blocks (Anthropic message format) for one attachment: a text header, then the pages.
async function blocksFor(a) {
  const m = load(a.id);
  if (!m) return [{ type: 'text', text: `<material title="${a.title}">(This file was deleted from his materials since; work from what you already know of it.)</material>` }];
  const head = `<material title="${m.title.replace(/"/g, "'")}" role="${a.role}"${m.subject ? ` subject="${m.subject}"` : ''}>\n${ROLES[a.role]}\n`;
  if (m.kind === 'text') {
    let text = fs.readFileSync(path.join(dirOf(m.id), m.file), 'utf8');
    if (text.length > TEXT_LIMIT) text = text.slice(0, TEXT_LIMIT) + '\n[… truncated]';
    return [{ type: 'text', text: `${head}File: ${m.origName || m.title}\n\n${text}\n</material>` }];
  }
  const names = a.pages.map((i) => pageName(m, i));
  const what = m.kind === 'images' ? `${a.pages.length} photo${a.pages.length === 1 ? '' : 's'} of pages he took (photo ${a.range})`
    : `${m.kind === 'pdf' && m.labels ? '' : ''}pages ${a.range} of “${m.title}”`;
  const order = a.pages.length > 1 ? ` The attached ${m.kind === 'pdf' ? 'PDF' : 'images'}' pages are, in order, ${m.kind === 'images' ? 'photos' : 'book pages'} ${names.join(', ')}: when you refer to a page, use those numbers, as he sees them in his copy.` : '';
  const blocks = [{ type: 'text', text: `${head}Attached below: ${what}.${order}\n</material>` }];
  if (m.kind === 'pdf') {
    const key = crypto.createHash('sha1').update(a.pages.join(',')).digest('hex').slice(0, 12);
    const slice = path.join(dirOf(m.id), 'slices', `${key}.pdf`);
    if (!fs.existsSync(slice)) { fs.mkdirSync(path.dirname(slice), { recursive: true }); await tool(['slice', path.join(dirOf(m.id), 'file.pdf'), slice, a.pages.join(',')]); }
    if (fs.statSync(slice).size <= PDF_INLINE_MAX) {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(slice).toString('base64') }, title: `${m.title}, pages ${a.range}` });
      return blocks;
    }
    // A heavy scan: the pages as images (with their text, if any) instead.
    const out = path.join(dirOf(m.id), 'thumbs', '1300');
    const need = a.pages.filter((i) => !fs.existsSync(path.join(out, `${i}.jpg`)));
    if (need.length) await tool(['render', path.join(dirOf(m.id), 'file.pdf'), out, '1300', need.join(',')], 300000);
    let texts = {};
    try { texts = Object.fromEntries((await tool(['text', path.join(dirOf(m.id), 'file.pdf'), a.pages.join(',')])).pages.map((p) => [p.i, p.text])); } catch {}
    for (const i of a.pages) {
      blocks.push({ type: 'text', text: `[page ${pageName(m, i)}]${texts[i] && texts[i].trim() ? `\n${texts[i].trim().slice(0, 6000)}` : ''}` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(path.join(out, `${i}.jpg`)).toString('base64') } });
    }
    return blocks;
  }
  for (const i of a.pages) {
    blocks.push({ type: 'text', text: `[photo ${i + 1}]` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(path.join(dirOf(m.id), `p${i}.jpg`)).toString('base64') } });
  }
  return blocks;
}

// ---------- http ----------

function serveFile(req, res, file, type) {
  let stat;
  try { stat = fs.statSync(file); } catch { ctx.send(res, 404, { error: 'not found' }); return; }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const common = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { ...common, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...common, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  }
}

async function readJson(req) {
  try { const b = await ctx.readBody(req); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; }
  catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); }
}

async function handle(req, res, url, c) {
  ctx = ctx || c;
  const p = url.pathname;
  if (!p.startsWith('/api/materials')) return false;
  const send = ctx.send;
  try {
    if (req.method === 'GET' && p === '/api/materials') {
      let subjects = [];
      try { subjects = fs.readdirSync(ctx.LEARNING_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !/^[_.]/.test(d.name)).map((d) => d.name); } catch {}
      return send(res, 200, { materials: list().map(publicView), subjects, pdf: pdfReady(), maxPages: MAX_PAGES }), true;
    }
    if (req.method === 'POST' && p === '/api/materials/upload') return send(res, 200, publicView(await upload(req, url))), true;
    const mm = p.match(/^\/api\/materials\/(m-[a-z0-9]+-[a-f0-9]{4})(?:\/(.+))?$/);
    if (!mm) return send(res, 404, { error: 'not found' }), true;
    const m = load(mm[1]);
    if (!m) return send(res, 404, { error: 'That material is gone' }), true;
    const action = mm[2] || '';
    if (req.method === 'GET' && !action) return send(res, 200, publicView(m)), true;
    if (req.method === 'GET' && action === 'file') {
      if (m.kind === 'pdf') return serveFile(req, res, path.join(dirOf(m.id), 'file.pdf'), 'application/pdf'), true;
      if (m.kind === 'text') return serveFile(req, res, path.join(dirOf(m.id), m.file), 'text/plain; charset=utf-8'), true;
      return serveFile(req, res, path.join(dirOf(m.id), 'p0.jpg'), 'image/jpeg'), true;
    }
    const pg = action.match(/^page\/(\d+)\.jpg$/);
    if (req.method === 'GET' && pg) {
      const w = Math.max(120, Math.min(1600, Number(url.searchParams.get('w')) || 360));
      const f = await pageJpeg(m, Number(pg[1]), m.kind === 'pdf' ? (w <= 400 ? 360 : 1300) : w);
      if (!f) return send(res, 404, { error: 'no such page' }), true;
      return serveFile(req, res, f, 'image/jpeg'), true;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    const body = await readJson(req);
    if (!action) {
      if (body.title !== undefined) { const t = cleanTitle(body.title); if (!t) return send(res, 400, { error: 'Give it a name' }), true; m.title = t; }
      if (body.subject !== undefined) m.subject = cleanTitle(body.subject) || null;
      if (body.firstPage !== undefined) {
        if (body.firstPage === null || body.firstPage === '') { delete m.firstPageSet; m.firstPage = 1; }
        else {
          const n = Number(body.firstPage);
          if (!Number.isInteger(n) || n < 1 || n > (m.pages || 1)) return send(res, 400, { error: `Pick a PDF page from 1 to ${m.pages}` }), true;
          m.firstPage = n; m.firstPageSet = true;
        }
      }
      save(m);
      return send(res, 200, publicView(m)), true;
    }
    if (action === 'resolve') {
      const a = attachment({ id: m.id, pages: body.pages, role: body.role });
      return send(res, 200, { ...a, names: a.pages.map((i) => pageName(m, i)) }), true;
    }
    if (action === 'delete') {
      fs.rmSync(dirOf(m.id), { recursive: true, force: true });
      return send(res, 200, { ok: true }), true;
    }
    return send(res, 404, { error: 'unknown action' }), true;
  } catch (e) {
    if (!e.status) console.error('[materials]', e);
    send(res, e.status || 500, { error: e.message });
    return true;
  }
}

module.exports = {
  init(c) { ctx = c; },
  handle,
  // for teach.js
  attachment, blocksFor, markUsed, load, ROLE_LABEL, MAX_PAGES, pdfReady,
  // for tests
  parseSpec, resolvePages, rangeText,
};
