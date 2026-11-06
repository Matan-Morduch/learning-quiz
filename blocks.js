// Building blocks: small, precise questions the AI grader writes when an answer shows a gap.
// They are saved in the vault, at the end of the same Questions/<Topic>.md file, under
// "# Building blocks", each linked to the big question with %% parent: <id> %%.
// A gap (gaps.js) ties them together: while it is open the blocks are asked more often and the big
// question less; once enough blocks are answered well the gap closes and the big question comes back.

const fs = require('fs');
const path = require('path');
const gaps = require('./gaps');

const { LEARNING_DIR, posixRel } = require('./config');   // QUIZ_LEARNING_DIR, else the folder above _quiz
const HEADING = '# Building blocks';
const MAX_OPEN_PER_PARENT = 3;   // unpassed blocks already waiting → don't pile on more

// The big question's file, inside Learning/<Subject>/Questions/ (never anywhere else).
function fileOf(question) {
  const full = path.resolve(LEARNING_DIR, question.file);
  const rel = posixRel(LEARNING_DIR, full);
  if (rel.startsWith('..') || !/^[^/]+\/Questions\/[^/]+\.md$/.test(rel)) throw new Error('unexpected question file');
  return full;
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

// Unanswered-well blocks of this question that are still waiting in its open gap.
function waiting(parentId, all) {
  const g = gaps.load().find((x) => x.status === 'open' && x.sourceId === parentId);
  if (!g) return [];
  const passed = new Set(g.passedIds || []);
  return all.filter((q) => q.parent === parentId && !passed.has(q.id));
}

// Saves the grader's building blocks for `question` and opens (or extends) its gap.
// Returns [{ id, question }] of what was added.
function add(question, bb, all) {
  if (!bb || !bb.questions || !bb.questions.length || question.parent) return [];
  const room = MAX_OPEN_PER_PARENT - waiting(question.id, all).length;
  if (room <= 0) return [];
  const file = fileOf(question);
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const ids = new Set(all.map((q) => q.id));
  const existing = new Set(all.filter((q) => q.parent === question.id).map((q) => oneLine(q.question).toLowerCase()));
  let n = 1;
  const added = [];
  let chunk = '';
  for (const b of bb.questions.slice(0, room)) {
    const qText = oneLine(b.question).replace(/^#+\s*/, '');
    if (!qText || existing.has(qText.toLowerCase())) continue;
    while (ids.has(`${question.id}-b${n}`)) n++;
    const id = `${question.id}-b${n}`;
    ids.add(id);
    const answer = String(b.answer).replace(/\r\n/g, '\n').trim().split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');
    chunk += `\n## ${qText}\n%% id: ${id} %%\n%% parent: ${question.id} %%\n> [!answer]-\n${answer}\n`;
    added.push({ id, question: qText });
  }
  if (!added.length) return [];
  if (!new RegExp(`^${HEADING}\\s*$`, 'm').test(text)) {
    text = `${text.replace(/\s*$/, '')}\n\n${HEADING}\n\n_Smaller questions the quiz wrote from gaps in your answers. Each is linked to the question it builds toward._\n`;
  }
  writeAtomic(file, `${text.replace(/\s*$/, '')}\n${chunk}`);
  gaps.addBlocks({ question, concept: bb.concept, ids: added.map((a) => a.id) });
  return added;
}

// Removes one building block from its file (and the heading once the last one is gone) and from its gap.
function remove(id, all) {
  const q = all.find((x) => x.id === id);
  if (!q || !q.parent) throw new Error('not a building block');
  const file = fileOf(q);
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const parts = text.split(/(?=^#{1,2} )/m);
  const keep = parts.filter((p) => !(p.startsWith('## ') && new RegExp(`%%\\s*id:\\s*${id}\\s*%%`).test(p)));
  if (keep.length === parts.length) throw new Error('block not found in its file');
  let out = keep.join('');
  if (!/%%\s*parent:/.test(out)) out = out.replace(new RegExp(`\\n*^${HEADING}\\s*\\n(?:\\n?_Smaller questions[^\\n]*_\\n?)?`, 'm'), '\n');
  writeAtomic(file, `${out.replace(/\s*$/, '')}\n`);
  gaps.removeRelated(q.parent, id);
}

module.exports = { add, remove };
