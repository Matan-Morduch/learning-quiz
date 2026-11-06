'use strict';
// 🗄️ Data tools for Settings → Data: what's stored, a backup you can download, restoring one, and
// clearing the voice audio cache.
//   GET  /api/data/summary          → { files: [{ name, bytes }], tts: { files, bytes }, teach: { files, bytes }, total }
//   GET  /api/data/export           → a JSON backup download (progress, history, gaps, lessons, prefs, …)
//   POST /api/data/import {backup}  → restores it; the current files are copied to data/backups/<time>/ first
//   POST /api/data/tts-clear        → deletes cached narration audio (it's made again when needed; local audio is free,
//                                     ElevenLabs audio costs again, so the popup says so)
// Never exported or overwritten: data/voice.json (the ElevenLabs key), audio, drawings, backups.
// Writes need the `x-quiz-settings: 1` header (see prefs.js).
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const SKIP = new Set(['voice.json']);                  // holds the API key
const NAME_RE = /^(?:teach\/)?[a-z0-9][a-z0-9._-]*\.(?:json|jsonl)$/i;
const MAX_IMPORT = 50 * 1024 * 1024;

function dirStats(dir, filter = () => true) {
  let files = 0, bytes = 0;
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !filter(f.name)) continue;
      files++; bytes += fs.statSync(path.join(dir, f.name)).size;
    }
  } catch {}
  return { files, bytes };
}

// The files a backup carries: data/*.json(l) and data/teach/*.json(l), minus the key file.
function backupNames() {
  const out = [];
  const add = (dir, prefix) => {
    try {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = prefix + f.name;
        if (f.isFile() && NAME_RE.test(name) && !SKIP.has(name) && !name.endsWith('.tmp')) out.push(name);
      }
    } catch {}
  };
  add(DATA, '');
  add(path.join(DATA, 'teach'), 'teach/');
  return out.sort();
}

function summary() {
  const files = backupNames().filter((n) => !n.startsWith('teach/')).map((name) => ({ name, bytes: fs.statSync(path.join(DATA, name)).size }));
  const tts = dirStats(path.join(DATA, 'tts'), (n) => n.endsWith('.mp3'));
  const teach = dirStats(path.join(DATA, 'teach'));
  const total = files.reduce((s, f) => s + f.bytes, 0) + tts.bytes + teach.bytes;
  return { files, tts, teach, total };
}

function exportBackup() {
  const files = {};
  for (const name of backupNames()) files[name] = fs.readFileSync(path.join(DATA, name), 'utf8');
  return { app: 'learning-quiz', version: 1, exportedAt: new Date().toISOString(), files };
}

function importBackup(b) {
  if (!b || b.app !== 'learning-quiz' || typeof b.files !== 'object') throw Object.assign(new Error('Not a Learning Quiz backup file.'), { status: 400 });
  const names = Object.keys(b.files);
  const bad = names.filter((n) => !NAME_RE.test(n) || SKIP.has(n) || n.includes('..') || typeof b.files[n] !== 'string');
  if (bad.length) throw Object.assign(new Error(`The backup has files it shouldn't: ${bad.slice(0, 3).join(', ')}`), { status: 400 });
  for (const n of names) if (n.endsWith('.json')) {
    try { JSON.parse(b.files[n]); } catch { throw Object.assign(new Error(`${n} in the backup is not valid JSON.`), { status: 400 }); }
  }
  // Keep what's here now, then write the backup's files (files not in the backup are left alone).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const keep = path.join(DATA, 'backups', stamp);
  fs.mkdirSync(path.join(keep, 'teach'), { recursive: true });
  for (const n of backupNames()) fs.copyFileSync(path.join(DATA, n), path.join(keep, n));
  fs.mkdirSync(path.join(DATA, 'teach'), { recursive: true });
  for (const n of names) {
    const dest = path.join(DATA, n);
    fs.writeFileSync(dest + '.tmp', b.files[n]);
    fs.renameSync(dest + '.tmp', dest);
  }
  return { restored: names.length, savedTo: path.relative(__dirname, keep) };
}

function clearTts() {
  const dir = path.join(DATA, 'tts');
  let files = 0, bytes = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.mp3')) continue;
      const p = path.join(dir, f);
      bytes += fs.statSync(p).size; fs.unlinkSync(p); files++;
    }
  } catch {}
  return { files, bytes };
}

function readLimited(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('backup too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith('/api/data/')) return false;
  try {
    if (req.method === 'GET' && p === '/api/data/summary') return ctx.send(res, 200, summary()), true;
    if (req.method === 'GET' && p === '/api/data/export') {
      // A download, so it needs the header too (it holds his whole history).
      if (req.headers['x-quiz-settings'] !== '1') return ctx.send(res, 403, { error: 'missing settings header' }), true;
      const day = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="learning-quiz-backup-${day}.json"` });
      res.end(JSON.stringify(exportBackup()));
      return true;
    }
    if (req.method !== 'POST') return ctx.send(res, 405, { error: 'method not allowed' }), true;
    if (req.headers['x-quiz-settings'] !== '1') return ctx.send(res, 403, { error: 'missing settings header' }), true;
    if (p === '/api/data/tts-clear') return ctx.send(res, 200, clearTts()), true;
    if (p === '/api/data/import') {
      const body = await readLimited(req, MAX_IMPORT);
      const r = importBackup(body.backup);
      ctx.send(res, 200, { ...r, restarting: true });
      // Lessons and progress are cached in memory, so the app restarts to load the restored files.
      // Under systemd (homebox: Restart=always) exiting is enough; with `node --watch` (a Mac), touching
      // this file makes it restart.
      setTimeout(() => {
        if (process.env.INVOCATION_ID) process.exit(0);
        try { const t = new Date(); fs.utimesSync(__filename, t, t); } catch {}
      }, 300);
      return true;
    }
    return ctx.send(res, 404, { error: 'not found' }), true;
  } catch (e) {
    return ctx.send(res, e.status || 500, { error: e.message }), true;
  }
}

module.exports = { handle, summary, exportBackup, importBackup, backupNames };
