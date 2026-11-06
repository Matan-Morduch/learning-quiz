'use strict';
// Board answers: a whiteboard explanation the teacher sends when the learner asks for one.
// The teacher places elements on a coarse grid (12 units wide); this file checks and normalizes the
// board and works out each element's height, so the browser (ui/board.js) only draws.
//
// Board shape (as stored and sent to the browser):
//   { title, steps: [{ say, draw: [op, …] }] }
// Ops: box, code, table, text, arrow (they add an element), set, mark, remove (they change one).
// Every element op carries a computed `h` (grid units).
//
// strict: true  → every problem is an error (the teacher gets one chance to fix them).
// strict: false → problems are repaired or the op is dropped; the board is never fatal.

const COLS = 12;
const MAX_ROWS = 18;          // how tall the board may get (grid units)
const MAX_STEPS = 12, MIN_STEPS = 2;
const MAX_OPS = 10;           // per step
const MAX_ELEMENTS = 32;
const MAX_NARRATION = 800;    // characters of narration per board (strict only): aim for 500–600, voice is paid per character
const TONES = ['blue', 'green', 'orange', 'red', 'purple', 'teal', 'gray'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

// Sizes in grid units (the browser draws 1 unit = 100 px of the board's viewBox).
const S = { head: 0.56, row: 0.42, pad: 0.14, code: 0.36, text: 0.34 };
// Rough characters per grid unit of width, for overflow checks (the browser squeezes what still overflows).
const CPU = { row: 11, label: 9.5, code: 9.5, text: 11 };

const round = (n) => Math.round(n * 100) / 100;
const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

function wrapCount(text, w) {
  const per = Math.max(4, Math.floor(w * CPU.text));
  let lines = 0;
  for (const para of String(text).split('\n')) {
    let len = 0, n = 1;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (len && len + 1 + word.length > per) { n++; len = word.length; } else len += (len ? 1 : 0) + word.length;
    }
    lines += n;
  }
  return lines;
}

function heightOf(e) {
  switch (e.op) {
    case 'box': {
      const rows = e.rows ? e.rows.length : 0;
      if (!rows) return 0.8;
      return round((e.label ? S.head : S.pad) + rows * S.row + S.pad);
    }
    case 'code': return round(S.pad * 2 + e.lines.length * S.code);
    case 'table': return round((e.cols ? S.row : 0) + e.rows.length * S.row + 0.04);
    case 'text': return round(wrapCount(e.text, e.w) * S.text + 0.08);
    default: return 0;
  }
}

const describe = (e) => `${e.op} "${e.id}"`;
const overlaps = (a, b) => a.x < b.x + b.w - 0.04 && b.x < a.x + a.w - 0.04 && a.y < b.y + b.h - 0.04 && b.y < a.y + a.h - 0.04;

function validateBoard(raw, { strict = true } = {}) {
  const errs = [];
  const bad = (msg) => { errs.push(msg); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['board must be an object {"title", "steps": [{"say", "draw": [...]}]}'] };
  if (!Array.isArray(raw.steps) || !raw.steps.length) return { errors: ['board.steps must be a non-empty array of {"say", "draw": [...]}'] };
  let steps = raw.steps;
  if (steps.length > MAX_STEPS) { bad(`board has ${steps.length} steps; use at most ${MAX_STEPS}`); steps = steps.slice(0, MAX_STEPS); }
  if (steps.length < MIN_STEPS) bad(`board needs at least ${MIN_STEPS} steps (build the picture up one idea at a time)`);

  const scene = new Map();   // id → element (as it stands after the steps so far)
  const out = { title: str(raw.title).slice(0, 80), steps: [] };
  let total = 0;

  steps.forEach((st, si) => {
    const where = `board.steps[${si}]`;
    const say = str(st && st.say).replace(/[*_`#]/g, '');
    if (!say) bad(`${where}.say is empty (the narration for this step)`);
    const step = { say: say.slice(0, 400), draw: [] };
    if (say.length > 400) bad(`${where}.say is ${say.length} characters; keep narration to one or two spoken sentences (under 400)`);
    let ops = Array.isArray(st && st.draw) ? st.draw : [];
    if (!Array.isArray(st && st.draw)) bad(`${where}.draw must be an array of ops (it may be empty)`);
    if (ops.length > MAX_OPS) { bad(`${where} has ${ops.length} ops; at most ${MAX_OPS} per step (split it)`); ops = ops.slice(0, MAX_OPS); }

    for (const [oi, o] of ops.entries()) {
      const w0 = `${where}.draw[${oi}]`;
      if (!o || typeof o !== 'object') { bad(`${w0} must be an object`); continue; }
      const op = str(o.op);
      const id = str(o.id);
      if (['box', 'code', 'table', 'text', 'arrow'].includes(op)) {
        if (!ID_RE.test(id)) { bad(`${w0}: id "${id}" must be a short slug (a-z, 0-9, -)`); continue; }
        if (scene.has(id)) { bad(`${w0}: id "${id}" is already on the board (use "set"/"remove", or a new id)`); continue; }
        if (total >= MAX_ELEMENTS) { bad(`board has more than ${MAX_ELEMENTS} elements; simplify it`); continue; }
        const e = { op, id };
        if (op === 'arrow') {
          e.from = str(o.from); e.to = str(o.to);
          const a = scene.get(e.from), b = scene.get(e.to);
          if (!a || !b || a.op === 'arrow' || b.op === 'arrow') { bad(`${w0}: arrow "${id}" must go between elements already on the board (from "${e.from}" to "${e.to}")`); continue; }
          if (e.from === e.to) { bad(`${w0}: arrow "${id}" goes from "${e.from}" to itself`); continue; }
          if (str(o.label)) e.label = str(o.label).slice(0, 40);
          if (o.dashed) e.dashed = true;
          e.tone = TONES.includes(o.tone) ? o.tone : 'gray';
        } else {
          let x = num(o.x), y = num(o.y), w = num(o.w);
          if (![x, y, w].every(Number.isFinite)) { bad(`${w0}: ${op} "${id}" needs numeric x, y and w (grid units)`); if (!strict) { x = Number.isFinite(x) ? x : 0; y = Number.isFinite(y) ? y : 0; w = Number.isFinite(w) ? w : 3; } else continue; }
          if (x < 0 || w < 1 || x + w > COLS || y < 0) {
            bad(`${w0}: ${op} "${id}" is off the board (x ${x}, w ${w}, y ${y}); the board is ${COLS} units wide, x + w ≤ ${COLS}, w ≥ 1, y ≥ 0`);
            w = Math.max(1, Math.min(COLS, w)); x = Math.max(0, Math.min(COLS - w, x)); y = Math.max(0, y);
          }
          Object.assign(e, { x: round(x), y: round(y), w: round(w) });
          e.tone = TONES.includes(o.tone) ? o.tone : 'gray';
          if (op === 'box') {
            e.label = str(o.label).slice(0, 60);
            if (o.rows !== undefined && o.rows !== null) {
              if (!Array.isArray(o.rows)) bad(`${w0}: box "${id}" rows must be an array of strings`);
              else e.rows = o.rows.slice(0, 12).map((r) => str(r).slice(0, 80));
            }
            if (!e.label && !(e.rows && e.rows.length)) { bad(`${w0}: box "${id}" needs a label or rows`); continue; }
            if (e.label.length > w * CPU.label * 1.15) bad(`${w0}: box "${id}" label is too long for w ${w} (about ${Math.floor(w * CPU.label)} characters fit); widen the box or shorten the label`);
            for (const r of e.rows || []) if (r.length > w * CPU.row * 1.15) { bad(`${w0}: box "${id}" row "${r}" is too long for w ${w} (about ${Math.floor(w * CPU.row)} characters fit)`); break; }
          } else if (op === 'code') {
            const lines = Array.isArray(o.lines) ? o.lines : typeof o.lines === 'string' ? o.lines.split('\n') : null;
            if (!lines || !lines.length) { bad(`${w0}: code "${id}" needs "lines": ["…"]`); continue; }
            e.lines = lines.slice(0, 24).map((l) => String(l).replace(/\t/g, '  ').replace(/\s+$/, '').slice(0, 100));
            for (const l of e.lines) if (l.length > w * CPU.code * 1.1) { bad(`${w0}: code "${id}" line "${l.trim()}" is too long for w ${w} (about ${Math.floor(w * CPU.code)} characters fit)`); break; }
          } else if (op === 'table') {
            const rows = Array.isArray(o.rows) ? o.rows.filter(Array.isArray) : [];
            if (!rows.length) { bad(`${w0}: table "${id}" needs "rows": [["…", "…"]]`); continue; }
            const ncol = Math.max(Array.isArray(o.cols) ? o.cols.length : 0, ...rows.map((r) => r.length));
            if (ncol < 1 || ncol > 8) { bad(`${w0}: table "${id}" needs 1 to 8 columns`); continue; }
            if (Array.isArray(o.cols) && o.cols.length) e.cols = Array.from({ length: ncol }, (_, i) => str(o.cols[i]).slice(0, 30));
            e.rows = rows.slice(0, 14).map((r) => Array.from({ length: ncol }, (_, i) => str(r[i]).slice(0, 40)));
            const per = (w / ncol) * CPU.row * 1.15;
            const cells = [...(e.cols || []), ...e.rows.flat()];
            const long = cells.find((c) => c.length > per);
            if (long) bad(`${w0}: table "${id}" cell "${long}" is too long for a column ${round(w / ncol)} units wide; widen the table or shorten it`);
          } else if (op === 'text') {
            e.text = str(o.text).replace(/[*_`#]/g, '').slice(0, 240);
            if (!e.text) { bad(`${w0}: text "${id}" is empty`); continue; }
          }
          e.h = heightOf(e);
          if (e.y + e.h > MAX_ROWS) { bad(`${w0}: ${describe(e)} reaches y ${round(e.y + e.h)}; keep the board under ${MAX_ROWS} units tall`); if (strict) continue; }
          const hit = [...scene.values()].find((b) => b.op !== 'arrow' && overlaps(e, b));
          if (hit) bad(`${w0}: ${describe(e)} (x ${e.x}–${round(e.x + e.w)}, y ${e.y}–${round(e.y + e.h)}) overlaps ${describe(hit)} (x ${hit.x}–${round(hit.x + hit.w)}, y ${hit.y}–${round(hit.y + hit.h)}); move one, or remove the other first`);
        }
        scene.set(id, e); total++;
        step.draw.push(JSON.parse(JSON.stringify(e)));   // a snapshot: later set ops change the scene, not this step
      } else if (op === 'set') {
        const e = scene.get(id);
        if (!e || !['table', 'box'].includes(e.op)) { bad(`${w0}: set needs the id of a table or box on the board (got "${id}")`); continue; }
        const row = Math.round(num(o.row)), value = str(o.value).slice(0, 80);
        if (e.op === 'table') {
          const col = Math.round(num(o.col));
          if (!(row >= 0 && row < e.rows.length && col >= 0 && col < e.rows[0].length)) { bad(`${w0}: set on table "${id}" needs row 0–${e.rows.length - 1} and col 0–${e.rows[0].length - 1} (0-based)`); continue; }
          e.rows = e.rows.map((r) => r.slice()); e.rows[row][col] = value;
          step.draw.push({ op, id, row, col, value });
        } else {
          const n = e.rows ? e.rows.length : 0;
          if (!(row >= 0 && row <= n && row < 12)) { bad(`${w0}: set on box "${id}" needs row 0–${n} (0-based; ${n} adds a row)`); continue; }
          const rows = (e.rows || []).slice(); rows[row] = value;
          const grown = { ...e, rows };
          grown.h = heightOf(grown);
          const hit = grown.h > e.h && [...scene.values()].find((b) => b.op !== 'arrow' && b.id !== id && overlaps(grown, b));
          if (hit) bad(`${w0}: adding a row makes box "${id}" overlap ${describe(hit)}; leave room below it`);
          e.rows = rows; e.h = grown.h;
          step.draw.push({ op, id, row, value, h: e.h });
        }
      } else if (op === 'mark') {
        const e = scene.get(id);
        if (!e) { bad(`${w0}: mark needs the id of an element on the board (got "${id}")`); continue; }
        const m = { op, id };
        if (o.line !== undefined && o.line !== null) {
          const line = Math.round(num(o.line));
          if (e.op !== 'code' || !(line >= 1 && line <= e.lines.length)) { bad(`${w0}: mark "line" is for code elements, 1–${e.op === 'code' ? e.lines.length : 'n'} (1-based)`); continue; }
          m.line = line;
        }
        step.draw.push(m);
      } else if (op === 'remove') {
        if (!scene.has(id)) { bad(`${w0}: remove needs the id of an element on the board (got "${id}")`); continue; }
        scene.delete(id);
        for (const [k, v] of scene) if (v.op === 'arrow' && (v.from === id || v.to === id)) scene.delete(k);
        step.draw.push({ op, id });
      } else {
        bad(`${w0}: unknown op "${op}" (box, code, table, text, arrow, set, mark, remove)`);
      }
    }
    out.steps.push(step);
  });

  if (!total) bad('the board draws nothing; add elements (box, code, table, text, arrow)');
  const spoken = out.steps.reduce((n, st) => n + st.say.length, 0);
  if (strict && spoken > MAX_NARRATION) bad(`the narration is ${spoken} characters in total; shorten it to about 500–600 (one or two short sentences per step; the drawing and its labels carry the detail)`);
  if (strict && errs.length) return { errors: errs.map((e) => `board: ${e}`) };
  if (!total) return { board: null, repaired: errs };
  return { board: out, repaired: errs };
}

// What the teacher sees of an earlier board when the transcript is replayed: the narration only.
function boardBrief(b) {
  if (!b) return null;
  return { title: b.title, narration: b.steps.map((s) => s.say) };
}

const PROMPT = `## Board answers (only when he asks for one)
When his \`message\` has "board": true, he wants this explanation drawn on a whiteboard while a voice narrates it, like a video lesson. ("about" quotes the reply he wants redrawn, when he pressed the button under one.) Reply with a top-level \`board\` next to \`say\` and the card:
{"title": "short title", "steps": [{"say": "what the narrator says while this step is drawn", "draw": [ops]}]}
- 3 to 10 steps. One idea per step: the picture grows as the narration goes. Say what to look at ("the new arrow"), not "as you can see".
- Keep narration short: about 500–600 characters for the whole board (one or two short sentences per step, about 80–100 words in all). The drawing, its labels and notes carry the detail; the voice says what to look at and why it matters, it doesn't read the board out.
- Narration is spoken aloud by a natural voice, so write it for the ear, like a good teacher talking: short sentences, plain words, no markdown, symbols or parentheses to read out. Vary the rhythm. Before the key point, pause (a comma, a full stop, or "..."), then land the word that matters at the end of the sentence. Spell numbers and code the way you'd say them ("x plus equals one"). The voice may understand a few audio tags in square brackets, such as [thoughtful] or [short pause]: use one only where a real teacher would change tone, at most two per board.
- The board is a grid 12 units wide, y grows downward; use up to about 10 units of height. You place each element; the app sizes and draws it. A box is 0.8 tall with only a label; each row adds about 0.42, a code line 0.36. Leave a gap of at least 0.5 between elements and room for arrows.
- Ops that add an element (ids: short lowercase slugs, unique on the board):
  - {"op":"box","id":"pa","x":0,"y":0,"w":3,"label":"Process A","rows":["PID 41","state: running"],"tone":"blue"}: a box; rows (top-down) make it a record or a stack. About 9 label characters and 11 row characters fit per unit of width.
  - {"op":"code","id":"src","x":6,"y":0,"w":6,"lines":["x = 1","x += 1"]}: a code listing, about 9 characters per unit of width.
  - {"op":"table","id":"regs","x":0,"y":4,"w":4,"cols":["reg","value"],"rows":[["rax","0"]]}: a small table (registers, memory, a queue's slots).
  - {"op":"text","id":"n1","x":0,"y":7,"w":5,"text":"a short note"}: a plain note, wraps inside w.
  - {"op":"arrow","id":"a1","from":"pa","to":"mem","label":"points to","dashed":false,"tone":"gray"}: between two elements already on the board.
- Ops that change one: {"op":"set","id":"regs","row":0,"col":1,"value":"1"} (a table cell, 0-based; on a box: "row" sets that row, one past the end adds a row); {"op":"mark","id":"src","line":2} (move the code highlight to line 2, 1-based, as a program runs); {"op":"mark","id":"pa"} (highlight an element during this step); {"op":"remove","id":"a1"} (also removes its arrows).
- tone: blue, green, orange, red, purple, teal, gray (the default). Use colour for meaning (the same thing keeps its colour), not decoration.
- Draw the real mechanism: the actual structures, values and pointers. A trace (code highlight moving while a table's values change) teaches better than labelled boxes.
- With a board, \`say\` is a short written recap (2 to 4 sentences) of what the board showed; the card rules are unchanged. If the idea truly doesn't fit a drawing, send a board anyway with what can be drawn, and say what it leaves out.`;

// ---------- live boards: ops one at a time ----------
// A live board (teach.js) arrives op by op while the teacher talks. liveBoard() checks each op against
// what is already drawn, with validateBoard's own rules (non-strict): an element that overlaps is
// moved down below what's in its columns (once), an op that can't be repaired (unknown id, a
// duplicate id, an arrow to nothing) is dropped. Accepted ops come back normalized (with `h`).
//   const lb = liveBoard(); const { op, problems } = lb.add(raw); lb.ops → every accepted op, in order
function liveBoard() {
  const ops = [];
  const scene = new Map();     // id → { x, y, w, h } of elements on the board now (not arrows)
  const steps = (list) => { const out = []; for (let i = 0; i < list.length; i += MAX_OPS) out.push({ say: '.', draw: list.slice(i, i + MAX_OPS) }); return out; };
  function attempt(o) {
    const n = ops.length, si = Math.floor(n / MAX_OPS), oi = n % MAX_OPS;
    if (si >= MAX_STEPS) return { op: null, problems: ['the board is full'] };
    const r = validateBoard({ steps: steps([...ops, o]) }, { strict: false });
    const where = `board.steps[${si}].draw[${oi}]`;
    const problems = (r.repaired || []).filter((m) => m.startsWith(where)).map((m) => m.slice(where.length + 2));
    const st = r.board && r.board.steps[si];
    return { op: st && st.draw.length === oi + 1 ? st.draw[oi] : null, problems };
  }
  function add(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { op: null, problems: ['not an object'] };
    let { op, problems } = attempt(raw);
    // Overlap: move it below whatever already sits in its columns, and try once more.
    if (op && op.y !== undefined && problems.some((m) => m.includes(' overlaps '))) {
      const below = [...scene.values()].filter((b) => b.x < op.x + op.w - 0.04 && op.x < b.x + b.w - 0.04).reduce((m, b) => Math.max(m, b.y + b.h), 0);
      const moved = attempt({ ...raw, y: round(below + 0.5) });
      if (moved.op && !moved.problems.some((m) => m.includes(' overlaps '))) { op = moved.op; problems = [...problems, `moved down to y ${moved.op.y}`]; }
    }
    if (!op) return { op: null, problems };
    ops.push(op);
    if (op.op === 'remove') {
      scene.delete(op.id);
    } else if (op.op === 'set' && op.h !== undefined && scene.has(op.id)) scene.get(op.id).h = op.h;
    else if (op.y !== undefined) scene.set(op.id, { x: op.x, y: op.y, w: op.w, h: op.h });
    return { op, problems };
  }
  return { add, get ops() { return ops.slice(); } };
}

module.exports = { validateBoard, boardBrief, liveBoard, PROMPT, COLS, TONES };
