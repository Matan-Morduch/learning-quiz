'use strict';
// Safe reads and writes for the data files. Every module saves through here so that:
//  - a crash or power cut mid-write never leaves a half-written file (write a temp file, then rename:
//    the rename is atomic, so the file is either the old version or the new one);
//  - a file that can't be parsed is never silently treated as empty and then overwritten (that would
//    reset all progress). It's copied to <file>.corrupt-<time> first and the error is logged;
//  - one bad line in a .jsonl log doesn't break everything that reads the log.
const fs = require('fs');
const path = require('path');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

// Write text atomically. The temp name includes the pid: LifeOS and a standalone server may share data/.
function writeText(file, text, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, opts);
  fs.renameSync(tmp, file);
}

function writeJson(file, value, opts) {
  writeText(file, JSON.stringify(value, null, 2), opts);
}

// The parsed file, or `fallback` when it doesn't exist (or is empty). A file that exists but doesn't
// parse is kept aside as <file>.corrupt-<time> (once per bad version) before the fallback is returned.
const quarantined = new Set();
function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return fallback; }
  if (!text.trim()) return fallback;
  try { return JSON.parse(text); } catch (e) {
    const key = `${file}:${text.length}`;
    if (!quarantined.has(key)) {
      quarantined.add(key);
      const copy = `${file}.corrupt-${stamp()}`;
      try { fs.copyFileSync(file, copy); } catch {}
      console.error(`[quiz] ${path.basename(file)} is not valid JSON (${e.message}); kept a copy as ${path.basename(copy)}`);
    }
    return fallback;
  }
}

// Every parseable line of a .jsonl log. Bad lines (e.g. a write cut off by a crash) are skipped.
function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { bad++; }
  }
  if (bad) console.error(`[quiz] ${path.basename(file)}: skipped ${bad} unreadable line(s)`);
  return out;
}

module.exports = { writeText, writeJson, readJson, readJsonl };
