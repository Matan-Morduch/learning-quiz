// Topic map (front end). One card per study note; an arrow means "learn this first".
// Foundations sit at the BOTTOM, arrows point up to what builds on them.
// The map fills the whole content area (body.mode-map); chrome floats above it like Apple Maps:
// a quiet title top-left, a filter button + popover top-right, a zoom group bottom-right, a status
// chip while prerequisites update (with a real Cancel), and an inspector sheet for the selected topic.
// Data: GET api/map (topicmap.js). The layout function has no DOM dependencies, so `node` can require
// this file to test it.

(function () {
  // ---------- layout (pure) ----------

  const NODE_W = 236, NODE_H = 92, GAP_X = 28, GAP_Y = 36;

  // Layered layout: layer = longest chain of prerequisites below the node (0 = foundation).
  // Within a layer, nodes are ordered by a few barycenter sweeps (fewer crossings), keeping each
  // subject's nodes next to each other. A layer wider than maxPerRow wraps onto extra rows, all
  // still below the next layer, so every prerequisite arrow keeps pointing up.
  function layout(nodes, edges, opt = {}) {
    const W = opt.nodeW || NODE_W, H = opt.nodeH || NODE_H, GX = opt.gapX || GAP_X, GY = opt.gapY || GAP_Y;
    const maxPerRow = Math.max(1, opt.maxPerRow || 8);
    const ids = new Set(nodes.map((n) => n.id));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pre = edges.filter((e) => e.kind === 'prereq' && ids.has(e.from) && ids.has(e.to));
    const links = edges.filter((e) => e.kind === 'link' && ids.has(e.from) && ids.has(e.to));
    const parents = new Map(nodes.map((n) => [n.id, []]));
    const children = new Map(nodes.map((n) => [n.id, []]));
    for (const e of pre) { parents.get(e.to).push(e.from); children.get(e.from).push(e.to); }
    const linked = new Map(nodes.map((n) => [n.id, []]));
    for (const e of links) { linked.get(e.from).push(e.to); linked.get(e.to).push(e.from); }

    const depth = new Map();
    const visiting = new Set();
    const depthOf = (id) => {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0;            // cycle guard (the server already breaks cycles)
      visiting.add(id);
      const d = parents.get(id).reduce((m, p) => Math.max(m, depthOf(p) + 1), 0);
      visiting.delete(id);
      depth.set(id, d);
      return d;
    };
    nodes.forEach((n) => depthOf(n.id));
    const maxDepth = Math.max(0, ...depth.values());

    const subjects = [...new Set(nodes.map((n) => n.subject))].sort();
    const sIdx = (id) => subjects.indexOf(byId.get(id).subject);
    const layers = Array.from({ length: maxDepth + 1 }, () => []);
    for (const n of nodes) layers[depth.get(n.id)].push(n.id);
    for (const L of layers) L.sort((a, b) => sIdx(a) - sIdx(b) || byId.get(a).title.localeCompare(byId.get(b).title));

    // Normalised position (0..1) in its layer, so layers of different widths compare.
    const pos = new Map();
    const setPos = () => layers.forEach((L) => L.forEach((id, i) => pos.set(id, L.length > 1 ? i / (L.length - 1) : 0.5)));
    setPos();
    const sweep = (range, nbrs) => {
      for (const d of range) {
        const L = layers[d];
        const bary = new Map(L.map((id) => {
          let sum = 0, w = 0;
          for (const x of nbrs(id)) { sum += pos.get(x); w += 1; }
          for (const x of linked.get(id)) { sum += 0.3 * pos.get(x); w += 0.3; }
          return [id, w ? sum / w : pos.get(id)];
        }));
        // subject groups stay together: order groups by their mean barycenter, nodes inside by their own
        const group = {};
        for (const id of L) (group[sIdx(id)] ||= []).push(bary.get(id));
        const gKey = (id) => { const g = group[sIdx(id)]; return g.reduce((a, b) => a + b, 0) / g.length; };
        L.sort((a, b) => gKey(a) - gKey(b) || sIdx(a) - sIdx(b) || bary.get(a) - bary.get(b));
        L.forEach((id, i) => pos.set(id, L.length > 1 ? i / (L.length - 1) : 0.5));
      }
    };
    const up = [...Array(maxDepth + 1).keys()], down = [...up].reverse();
    for (let i = 0; i < 3; i++) { sweep(up.slice(1), (id) => parents.get(id)); sweep(down.slice(1), (id) => children.get(id)); }
    sweep(up, (id) => [...parents.get(id), ...children.get(id)]);

    // Rows, bottom-up: layer 0 rows first. Then y counted from the top.
    const rows = [];
    layers.forEach((L, d) => { for (let i = 0; i < L.length; i += maxPerRow) rows.push({ depth: d, ids: L.slice(i, i + maxPerRow) }); });
    const rowW = (r) => r.ids.length * W + (r.ids.length - 1) * GX;
    const width = Math.max(W, ...rows.map(rowW));
    const height = rows.length * H + Math.max(0, rows.length - 1) * GY;
    const box = new Map();
    rows.forEach((r, ri) => {
      const y = (rows.length - 1 - ri) * (H + GY);
      const x0 = (width - rowW(r)) / 2;
      r.ids.forEach((id, i) => box.set(id, { x: x0 + i * (W + GX), y, w: W, h: H, depth: r.depth }));
    });

    // Edge attach points spread along the node's edge (sorted by the other end's x) so arrows don't stack.
    const outs = new Map(), ins = new Map();
    const drawn = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    for (const e of drawn) {
      const a = box.get(e.from), b = box.get(e.to);
      const lower = a.y >= b.y ? e.from : e.to, upper = lower === e.from ? e.to : e.from;
      if (a.y === b.y) continue;
      (outs.get(lower) || outs.set(lower, []).get(lower)).push(e);
      (ins.get(upper) || ins.set(upper, []).get(upper)).push(e);
    }
    const attach = new Map();
    const spread = (map, key, otherEnd) => {
      for (const [id, list] of map) {
        const b = box.get(id);
        list.sort((p, q) => box.get(otherEnd(p, id)).x - box.get(otherEnd(q, id)).x);
        list.forEach((e, i) => attach.set(`${key}:${e.from}>${e.to}`, b.x + b.w * (0.2 + 0.6 * ((i + 1) / (list.length + 1)))));
      }
    };
    const other = (e, id) => (e.from === id ? e.to : e.from);
    spread(outs, 'lo', other);
    spread(ins, 'hi', other);
    const paths = drawn.map((e) => {
      const a = box.get(e.from), b = box.get(e.to);
      if (a.y === b.y) {   // same row (only wikilinks): arc above
        const x1 = a.x + a.w / 2, x2 = b.x + b.w / 2, y = a.y;
        const lift = 26 + Math.abs(x2 - x1) * 0.12;
        return { e, d: `M${x1},${y} C${x1},${y - lift} ${x2},${y - lift} ${x2},${y}` };
      }
      const lower = a.y > b.y ? a : b, upper = lower === a ? b : a;
      const lowId = lower === a ? e.from : e.to;
      const k = `${e.from}>${e.to}`;
      const x1 = attach.get(`lo:${k}`) ?? lower.x + lower.w / 2, y1 = lower.y;
      const x2 = attach.get(`hi:${k}`) ?? upper.x + upper.w / 2, y2 = upper.y + upper.h + (e.kind === 'prereq' ? 3 : 0);
      const dy = Math.max(24, (y1 - y2) * 0.5);
      // prereq edges always run from the prerequisite (lower) up to the dependent
      const d = lowId === e.from || e.kind !== 'prereq'
        ? `M${x1},${y1} C${x1},${y1 - dy} ${x2},${y2 + dy} ${x2},${y2}`
        : `M${x2},${y2} C${x2},${y2 + dy} ${x1},${y1 - dy} ${x1},${y1}`;
      return { e, d };
    });
    return { box, width, height, paths, depth, maxDepth };
  }

  if (typeof window === 'undefined') { module.exports = { layout }; return; }

  // ---------- page ----------

  const Q = window.Quiz;
  const esc = (s) => Q.esc(s ?? '');
  const icon = (n, cls) => (Q.icon ? Q.icon(n, cls) : '');
  // Smallest text on a card is 13px; first open fits the whole map only while that stays >= 12px on screen.
  const MIN_READ = 12 / 13;
  const SHEET_W = 380;

  const style = document.createElement('style');
  style.textContent = `
  .qm { position: relative; width: 100%; height: 100%; min-height: 360px; overflow: hidden; container-type: size;
    background: var(--window); color: var(--label); font: var(--body); }
  .qm [hidden] { display: none !important; }

  /* canvas: the whole area pans and zooms; a faint dot grid moves with it */
  .qm-canvas { position: absolute; inset: 0; overflow: hidden; touch-action: none; cursor: grab; outline: none;
    background-image: radial-gradient(circle at center, var(--separator) 1px, transparent 1.4px); background-size: 24px 24px; }
  .qm-canvas.panning { cursor: grabbing; }
  .qm-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .qm-world.glide { transition: transform .45s var(--ease); }
  .qm-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
  .qm-empty { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: var(--sp3);
    text-align: center; color: var(--label-2); font: var(--subhead); padding: var(--sp6); }
  .qm-empty .headline { color: var(--label); }

  /* nodes: clean cards */
  .qm-node { position: absolute; display: flex; flex-direction: column; gap: 6px; padding: 11px 14px 0; text-align: left;
    background: var(--surface); color: var(--label); border: 0; border-radius: var(--r-lg); box-shadow: var(--shadow-1);
    cursor: pointer; font: inherit; transition: transform .18s var(--ease), box-shadow .18s var(--ease), opacity .2s var(--ease); }
  /* beat the app's global button rules (centred content, hover fill) */
  .qm .qm-node { justify-content: flex-start; align-items: stretch; margin: 0; }
  .qm .qm-node:hover:not(:disabled) { background: var(--surface); border: 0; }
  .qm .qm-node.noq:hover:not(:disabled) { background: color-mix(in srgb, var(--surface) 55%, transparent); }
  .qm .qm-fab:hover:not(:disabled) { background: var(--material-thick); border: 0; }
  .qm .qm-zoom button:hover:not(:disabled) { background: var(--fill); border: 0; }
  .qm-node:hover { transform: translateY(-2px); box-shadow: var(--shadow-2); }
  .qm-node.sel { box-shadow: 0 0 0 2px var(--accent), var(--shadow-2); }
  .qm-node:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent), var(--shadow-2); }
  .qm-n-top { display: flex; align-items: center; gap: 6px; height: 16px; min-width: 0; }
  .qm-n-top .tag { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: block; line-height: 16px; }
  .qm-n-top .tag::before { display: inline-block; margin-right: 6px; vertical-align: 0; }
  .qm-n-b { display: inline-flex; align-items: center; gap: 2px; font: 600 13px/16px var(--font); color: var(--label-2); flex: none; }
  .qm-n-b svg { width: 14px; height: 14px; stroke-width: 2; }
  .qm-n-b.ready { color: var(--green); }
  .qm-n-b.due { color: var(--orange); }
  .qm-n-b.gaps { color: var(--purple); }
  .qm-n-pct { font: 500 13px/16px var(--font); color: var(--label-2); flex: none; font-variant-numeric: tabular-nums; }
  .qm-n-title { font: 600 15px/18px var(--font); letter-spacing: -0.01em; display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden; }
  /* title, then the note's subtitle if the title leaves room (a 2-line title pushes it out of view) */
  .qm-n-text { display: block; height: 36px; overflow: hidden; }
  .qm-n-sub { display: block; font: 400 13px/18px var(--font); color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qm-node.compact { padding: 11px 12px 0; }
  .qm-node.compact .qm-n-bar { left: 12px; right: 12px; }
  .qm-n-bar { position: absolute; left: 14px; right: 14px; bottom: 11px; height: 4px; border-radius: 2px; background: var(--fill); overflow: hidden; }
  .qm-n-bar > span { display: block; height: 100%; border-radius: inherit; }
  .qm-node.noq { background: color-mix(in srgb, var(--surface) 55%, transparent); box-shadow: inset 0 0 0 1px var(--separator); }
  .qm-node.noq .qm-n-bar { display: none; }

  /* edges */
  .qm-edge { fill: none; stroke: var(--label-3); stroke-width: 1.25; transition: opacity .2s var(--ease); }
  .qm-edge.redundant { opacity: .35; }
  .qm-edge.link { stroke-dasharray: 1 4; stroke-linecap: round; stroke-width: 1.25; opacity: 0; }
  .qm-arrow { fill: var(--label-3); }
  .qm-arrow.up { fill: var(--accent); }
  .qm-arrow.down { fill: var(--green); }

  /* focus: hover or selection shows the chain, everything else steps back */
  .qm.focus .qm-node:not(.hl) { opacity: .32; }
  .qm.focus .qm-edge:not(.hl) { opacity: .08; }
  .qm.focus .qm-edge.hl { opacity: 1; }
  .qm.focus .qm-edge.hl.up { stroke: var(--accent); stroke-width: 2; }
  .qm.focus .qm-edge.hl.down { stroke: var(--green); stroke-width: 2; }
  .qm.focus .qm-edge.hl.link { opacity: .9; }
  .qm.ready-only:not(.focus) .qm-node:not(.front) { opacity: .28; }
  .qm.ready-only:not(.focus) .qm-edge { opacity: .14; }

  /* floating chrome */
  .qm-float { position: absolute; z-index: 10; background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
    box-shadow: var(--shadow-2), inset 0 0 0 .5px var(--separator); }
  .qm-title { top: var(--sp4); left: var(--sp4); padding: 8px 14px 9px; border-radius: var(--r); max-width: calc(100% - 120px); }
  .qm-title h2 { margin: 0; font: var(--headline); letter-spacing: -0.01em; }
  .qm-title p { margin: 1px 0 0; font: var(--footnote); color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qm-tr { position: absolute; z-index: 12; top: var(--sp4); right: var(--sp4); transition: right .28s var(--spring); }
  .qm-fab { position: relative; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: var(--r);
    color: var(--label); cursor: pointer; transition: background var(--dur), color var(--dur); }
  .qm-fab:hover { color: var(--accent); }
  .qm-fab[aria-expanded="true"] { color: var(--accent); }
  .qm-fab svg { width: 20px; height: 20px; }
  .qm-fab-badge { position: absolute; top: 6px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent);
    box-shadow: 0 0 0 2px var(--surface); }
  .qm-zoom { right: var(--sp4); bottom: var(--sp4); display: flex; flex-direction: column; border-radius: var(--r); overflow: hidden;
    transition: right .28s var(--spring); }
  .qm-zoom button { display: grid; place-items: center; width: 40px; height: 40px; border: 0; background: transparent; color: var(--label); cursor: pointer; }
  .qm-zoom button + button { border-top: 1px solid var(--separator); }
  .qm-zoom button:hover { background: var(--fill); }
  .qm-zoom svg { width: 18px; height: 18px; }
  .qm.sheet-open .qm-tr, .qm.sheet-open .qm-zoom { right: calc(${SHEET_W}px + var(--sp6)); }
  .qm.sheet-open .qm-chip { left: calc((100% - ${SHEET_W}px - var(--sp6)) / 2); }
  .qm-chip { top: var(--sp4); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
    height: 40px; padding: 0 6px 0 14px; border-radius: var(--r-pill); font: var(--subhead); white-space: nowrap;
    animation: qm-drop .25s var(--spring); }
  .qm-chip .btn { height: 28px; }
  .qm-chip.err { color: var(--label); }
  .qm-chip.err svg.icon { color: var(--orange); width: 18px; height: 18px; }
  @keyframes qm-drop { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }

  /* filter popover */
  .qm-pop { top: calc(var(--sp4) + 48px); right: var(--sp4); width: 340px; max-width: calc(100% - 32px); padding: 0;
    max-height: calc(100% - 80px); overflow-y: auto; overscroll-behavior: contain; }
  .qm-pop section { padding: var(--sp4); }
  .qm-pop section + section { border-top: 1px solid var(--separator); }
  .qm-pop h3 { margin: 0 0 var(--sp2); font: 600 13px/18px var(--font); color: var(--label-2); }
  .qm-pop .row { display: flex; align-items: center; gap: var(--sp3); }
  .qm-pop .row .grow { flex: 1; font: var(--subhead); }
  .qm-pop .note { margin: 6px 0 0; font: var(--footnote); color: var(--label-2); }
  .qm-pop .multiselect-trigger { width: 100%; }
  /* A blurred menu inside a blurred popover can't blur again, so give it a solid surface (nothing shows through). */
  .qm-pop .multiselect-menu { background: var(--surface); }
  .qm-pop .multiselect-trigger svg { width: 14px; height: 14px; color: var(--label-3); }
  .qm-pop .reset { margin-top: var(--sp3); }
  .qm-pop details summary { list-style: none; display: flex; align-items: center; justify-content: space-between; cursor: pointer;
    font: 600 13px/18px var(--font); color: var(--label-2); }
  .qm-pop details summary::-webkit-details-marker { display: none; }
  .qm-pop details summary svg { width: 14px; height: 14px; transition: transform var(--dur) var(--ease); }
  .qm-pop details:not([open]) summary svg { transform: rotate(-90deg); }
  .qm-legend { display: grid; gap: 10px; margin-top: var(--sp3); font: var(--footnote); color: var(--label); }
  .qm-legend > div { display: grid; grid-template-columns: 36px 1fr; align-items: center; gap: 10px; }
  .qm-legend .k { display: flex; justify-content: center; }
  .qm-legend .k svg.icon { width: 16px; height: 16px; stroke-width: 2; }
  .qm-legend .grad { width: 36px; height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--red), var(--orange), var(--green)); }
  .qm-pop .prq p { margin: 0 0 6px; font: var(--subhead); }
  .qm-pop .prq p.secondary { font: var(--footnote); color: var(--label-2); }
  .qm-pop .prq .btn { margin-top: var(--sp2); }
  .qm-ms-menu { z-index: 50; }
  .qm-ms-menu .multiselect-option .tag { flex: 1; font: var(--subhead); color: var(--label); }
  .qm-ms-menu .multiselect-option .n { font: var(--footnote); color: var(--label-3); }
  .qm-ms-menu .none { padding: 10px 8px; font: var(--footnote); color: var(--label-2); }

  /* inspector */
  .qm-sheet { width: min(${SHEET_W}px, calc(100% - 24px)); }
  .qm-sheet .sheet-body { padding: var(--sp5) var(--sp5) var(--sp6); }
  .qm-sh-x { position: absolute; top: 12px; right: 12px; z-index: 1; background: var(--fill); }
  .qm-sh-x svg { width: 14px; height: 14px; stroke-width: 2.2; }
  .qm-sheet .tag { margin-right: 40px; }
  .qm-sheet h2 { margin: 10px 0 0; font: var(--title2); letter-spacing: -0.015em; }
  .qm-sheet .sub { margin: 4px 0 0; font: var(--subhead); color: var(--label-2); }
  .qm-mastery { margin-top: var(--sp5); }
  .qm-mastery .big { display: flex; align-items: baseline; gap: var(--sp2); flex-wrap: wrap; }
  .qm-mastery .big b { font: var(--title1); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .qm-mastery .big span { font: var(--subhead); color: var(--label-2); }
  .qm-mastery .big .badge { margin-left: auto; align-self: center; height: 24px; padding: 0 10px; font-size: 13px; }
  .qm-mastery .badge svg { width: 13px; height: 13px; stroke-width: 2.2; }
  .qm-mastery .progress { height: 6px; margin-top: var(--sp2); }
  .qm-mastery .stats { margin: var(--sp2) 0 0; font: var(--footnote); color: var(--label-2); }
  .qm-mastery .hint { margin: var(--sp3) 0 0; font: var(--footnote); color: var(--label-2); }
  .qm-acts { display: grid; gap: var(--sp2); margin-top: var(--sp5); }
  .qm-acts .pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp2); }
  .qm-acts .pair .btn { height: 38px; }
  .qm-acts .btn-plain svg { width: 15px; height: 15px; }
  .qm-sheet .list-header { margin-top: var(--sp6); padding-left: var(--sp4); display: flex; align-items: center; gap: 6px; }
  .qm-sheet .list-header i { width: 8px; height: 8px; border-radius: 50%; }
  .qm-sheet .list { box-shadow: inset 0 0 0 .5px var(--separator); }
  .qm-sheet .list-row { align-items: center; padding: 10px 12px 10px var(--sp4); min-height: 52px; }
  .qm-sheet .list-row .t { font: var(--subhead); font-size: 15px; font-weight: 500; color: var(--label); }
  .qm-sheet .list-row .r { font: var(--footnote); color: var(--label-2); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden; }
  .qm-sheet .list-row .pct { font: var(--footnote); color: var(--label-2); font-variant-numeric: tabular-nums; flex: none; }
  .qm-sheet .list-row .chevron { width: 14px; height: 14px; }
  .qm-sheet .list-row.static { cursor: default; }
  .qm-sheet .list-empty { padding: 12px var(--sp4); font: var(--subhead); color: var(--label-2); }
  .qm-ring { flex: none; width: 28px; height: 28px; }
  .qm-ring circle { fill: none; stroke-width: 3.5; }
  .qm-ring .trk { stroke: var(--fill-hover); }
  .qm-gap-dot { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%;
    background: color-mix(in srgb, var(--purple) 14%, transparent); color: var(--purple); }
  .qm-gap-dot svg { width: 15px; height: 15px; stroke-width: 2; }

  /* phones and narrow windows: compact chrome, the inspector becomes a bottom sheet */
  @container (max-width: 640px) {
    .qm-title { top: var(--sp3); left: var(--sp3); padding: 6px 12px 7px; }
    .qm-tr { top: var(--sp3); right: var(--sp3); }
    .qm-zoom { right: var(--sp3); bottom: var(--sp3); }
    .qm-chip { top: 70px; }
    .qm-pop { top: 64px; right: var(--sp3); left: var(--sp3); width: auto; max-width: none; }
    .qm.sheet-open .qm-tr, .qm.sheet-open .qm-zoom { right: var(--sp3); }
    .qm.sheet-open .qm-zoom { opacity: 0; pointer-events: none; }
    .qm.sheet-open .qm-chip { left: 50%; }
    .qm-sheet { top: auto; left: var(--sp2); right: var(--sp2); bottom: var(--sp2); width: auto; max-height: 72%;
      border-width: 1px; border-radius: var(--r-xl); animation: qm-sheet-up .3s var(--spring); }
    .qm-sheet::before { content: ""; position: absolute; top: 6px; left: 50%; width: 36px; height: 5px; margin-left: -18px;
      border-radius: 3px; background: var(--label-4); }
    .qm-sheet .sheet-body { padding-top: var(--sp6); }
    .qm-sh-x { top: 14px; }
  }
  @keyframes qm-sheet-up { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .qm-world.glide { transition: none; } .qm-node:hover { transform: none; } }`;
  document.head.appendChild(style);

  // Mastery 0..100 → red (0) through orange (50) to green (100), the system colours.
  const mColor = (m) => (m <= 50
    ? `color-mix(in srgb, var(--orange) ${Math.round(m * 2)}%, var(--red))`
    : `color-mix(in srgb, var(--green) ${Math.round((m - 50) * 2)}%, var(--orange))`);
  // "Pulse Trains - Identifying the Components…" → title "Pulse Trains", subtitle "Identifying the Components…"
  const splitTitle = (t) => { const i = t.indexOf(' - '); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 3)]; };
  const shortTitle = (t) => splitTitle(t)[0];
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} minutes ago` : s < 129600 ? `${Math.round(s / 3600)} hours ago` : `${Math.round(s / 86400)} days ago`;
  };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const ring = (m) => {
    const C = 2 * Math.PI * 11;
    if (m === null) return `<svg class="qm-ring" viewBox="0 0 28 28" aria-hidden="true"><circle class="trk" cx="14" cy="14" r="11" stroke-dasharray="2 3"/></svg>`;
    return `<svg class="qm-ring" viewBox="0 0 28 28" aria-hidden="true"><circle class="trk" cx="14" cy="14" r="11"/>
      <circle cx="14" cy="14" r="11" stroke="${mColor(m)}" stroke-linecap="round" stroke-dasharray="${C * m / 100} ${C}" ${m ? '' : 'stroke-opacity="0"'} transform="rotate(-90 14 14)"/></svg>`;
  };

  class MapView {
    constructor(el) {
      this.el = el;
      this.data = null; this.sel = null; this.hover = null; this.L = null;
      this.view = { x: 0, y: 0, k: 1 };
      this.hidden = new Set(store.get('mapHiddenSubjects', []));
      this.readyOnly = !!store.get('mapFrontierOnly', false);
      this.el.innerHTML = `<div class="qm">
        <div class="qm-canvas" tabindex="-1" aria-label="Topic map. Drag or scroll to move, pinch or use plus and minus to zoom.">
          <div class="qm-world"><svg class="qm-edges" aria-hidden="true"></svg><div class="qm-nodes"></div></div>
          <div class="qm-empty"><span class="activity"></span><span>Loading your map…</span></div>
        </div>
        <div class="qm-float qm-title"><h2>Topic map</h2><p class="qm-status">&nbsp;</p></div>
        <div class="qm-float qm-chip" role="status" hidden></div>
        <div class="qm-tr"><button class="qm-float qm-fab" type="button" aria-haspopup="dialog" aria-expanded="false"
          aria-label="Filters, legend and prerequisites" title="Filters">${icon('filter')}<span class="qm-fab-badge" hidden></span></button></div>
        <div class="popover qm-pop" role="dialog" aria-label="Map options" hidden></div>
        <div class="qm-float qm-zoom" role="group" aria-label="Zoom">
          <button type="button" data-z="in" aria-label="Zoom in" title="Zoom in (+)">${icon('plus')}</button>
          <button type="button" data-z="out" aria-label="Zoom out" title="Zoom out (−)">${icon('minus')}</button>
          <button type="button" data-z="fit" aria-label="Show the whole map" title="Show the whole map (0)">${icon('fit')}</button>
        </div>
        <aside class="sheet qm-sheet" role="dialog" aria-label="Topic details" hidden></aside>
      </div>`;
      const $ = (s) => this.el.querySelector(s);
      this.root = $('.qm'); this.canvas = $('.qm-canvas'); this.world = $('.qm-world');
      this.edgesEl = $('.qm-edges'); this.nodesEl = $('.qm-nodes'); this.emptyEl = $('.qm-empty');
      this.statusEl = $('.qm-status'); this.chip = $('.qm-chip'); this.fab = $('.qm-fab'); this.pop = $('.qm-pop');
      this.sheet = $('.qm-sheet');
      this.fab.addEventListener('click', () => (this.pop.hidden ? this.openPop() : this.closePop()));
      this.root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => this.zoomButton(b.dataset.z)));
      this.wire();
      // Re-layout when the width changes how many cards fit side by side.
      this.ro = new ResizeObserver(() => {
        if (!this.data || !this.canvas.clientWidth) return;
        if (this.perRow() !== this.lastPerRow) this.draw(true); else if (!this.touched) this.home();
      });
      this.ro.observe(this.canvas);
    }

    isVisible() { return this.el.isConnected && this.el.offsetParent !== null; }
    narrow() { return this.root.clientWidth <= 640; }
    // Phones get narrower cards so two fit side by side at full size (a single column hides the graph).
    dims() { return this.root.clientWidth <= 480 ? { nodeW: 168, gapX: 14 } : { nodeW: NODE_W, gapX: GAP_X }; }

    // Space the cards can use: the canvas minus the floating title on top and an open inspector on the right.
    insets() {
      const n = this.narrow();
      const top = (this.root.querySelector('.qm-title').offsetHeight || 52) + (n ? 20 : 28);
      const right = (this.sel && !n ? SHEET_W + 28 : 0) + (n ? 12 : 20);
      const bottom = this.sel && n ? this.sheet.offsetHeight + 16 : (n ? 12 : 20);
      return { top, right, bottom, left: n ? 12 : 20 };
    }

    // How many cards fit side by side at a readable zoom; wider layers wrap.
    perRow() {
      const { left } = this.insets();
      const w = (this.canvas.clientWidth || 900) - left - (this.narrow() ? 12 : 20);
      const { nodeW, gapX } = this.dims();
      return Math.max(1, Math.floor((w / MIN_READ + gapX) / (nodeW + gapX)));
    }

    async load() {
      let d;
      try { d = await Q.api('api/map'); } catch (e) {
        this.emptyEl.hidden = false;
        this.emptyEl.innerHTML = `<span class="headline">Couldn't load the map</span><span>${esc(e.message)}</span>`;
        return;
      }
      const was = this.data;
      this.data = d;
      if (was?.building && !d.building && !this.cancelling) {
        Q.showToast(d.error ? "Couldn't update prerequisites. The map shows the last saved ones." : 'Prerequisites updated');
      }
      const changed = !was || JSON.stringify(was.edges) !== JSON.stringify(d.edges) || was.nodes.length !== d.nodes.length;
      this.renderStatus();
      if (changed) this.draw(!this.drawnOnce); else this.refreshNodes();
      this.drawnOnce = true;
      if (!this.pop.hidden) {
        const top = this.pop.scrollTop, open = !!this.menu;
        this.renderPop();
        this.pop.scrollTop = top;
        if (open) this.pop.querySelector('.multiselect-trigger')?.setAttribute('aria-expanded', 'true');
      }
      if (this.sel) {
        const top = this.sheet.querySelector('.sheet-body')?.scrollTop || 0;
        this.openSheet(this.sel, { keepView: true });
        const body = this.sheet.querySelector('.sheet-body');
        if (body) body.scrollTop = top;
      }
      clearTimeout(this.poll);
      if (d.building) this.poll = setTimeout(() => this.isVisible() && this.load(), 2000);
    }

    subjects() { return [...new Set(this.data.nodes.map((n) => n.subject))].sort(); }
    tint(subject) { return `var(--tint-${Math.max(0, this.subjects().indexOf(subject)) % 8})`; }
    filtersOn() { return this.readyOnly || this.subjects().some((s) => this.hidden.has(s)); }

    renderStatus() {
      const d = this.data;
      const shown = this.visible().nodes;
      const ready = shown.filter((n) => d.frontier.includes(n.id)).length;
      const topics = shown.length === d.nodes.length ? plural(d.nodes.length, 'topic') : `${shown.length} of ${plural(d.nodes.length, 'topic')}`;
      this.statusEl.textContent = `${topics} · ${ready} ready to learn`;
      this.fab.querySelector('.qm-fab-badge').hidden = !this.filtersOn();
      this.root.classList.toggle('ready-only', this.readyOnly);
      // Status chip: a running update (with Cancel), or a failed one.
      if (d.building) {
        this.chip.hidden = false;
        this.chip.classList.remove('err');
        this.chip.innerHTML = `<span class="activity"></span><span>Updating prerequisites…</span>
          <button class="btn btn-plain btn-sm" type="button" data-chip="cancel">Cancel</button>`;
      } else if (d.error && this.errSeen !== d.error) {
        this.chip.hidden = false;
        this.chip.classList.add('err');
        this.chip.innerHTML = `${icon('warning')}<span>Couldn't update prerequisites</span>
          <button class="btn btn-plain btn-sm" type="button" data-chip="details">Details</button>
          <button class="icon-btn" type="button" data-chip="dismiss" aria-label="Dismiss">${icon('close')}</button>`;
      } else this.chip.hidden = true;
      this.chip.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.chip;
        if (a === 'cancel') this.cancelBuild(b);
        if (a === 'dismiss') { this.errSeen = d.error; this.chip.hidden = true; }
        if (a === 'details') { this.errSeen = d.error; this.chip.hidden = true; this.openPop('prq'); }
      }));
    }

    async cancelBuild(btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }
      this.cancelling = true;
      try {
        await Q.api('api/map/rebuild/cancel', {});
        Q.showToast('Stopped. Your previous prerequisites are kept.');
      } catch (e) { Q.showToast(`Couldn't stop it: ${e.message}`); }
      await this.load();
      this.cancelling = false;
    }

    confirmRebuild() {
      this.closePop();
      const scrim = document.createElement('div');
      scrim.className = 'scrim qm-alert-scrim';
      scrim.innerHTML = `<div class="alert" role="alertdialog" aria-modal="true" aria-labelledby="qmAlertT" aria-describedby="qmAlertP">
        <h3 id="qmAlertT">Re-check prerequisites?</h3>
        <p id="qmAlertP">The AI reads all your notes again to decide which topic comes before which. Takes about 30 seconds and uses your AI plan.</p>
        <div class="actions"><button class="btn" type="button" data-a="no">Cancel</button><button class="btn btn-primary" type="button" data-a="yes">Re-check</button></div>
      </div>`;
      const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); this.fab.focus(); };
      const onKey = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
        if (ev.key === 'Tab') {   // keep focus inside the alert
          const bs = [...scrim.querySelectorAll('button')];
          const i = bs.indexOf(document.activeElement);
          ev.preventDefault();
          bs[(i + (ev.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
        }
      };
      scrim.addEventListener('click', (ev) => { if (ev.target === scrim) close(); });
      scrim.querySelector('[data-a=no]').addEventListener('click', close);
      scrim.querySelector('[data-a=yes]').addEventListener('click', async () => {
        close();
        try { await Q.api('api/map/rebuild', {}); } catch (e) { Q.showToast(`Couldn't start: ${e.message}`); return; }
        this.load();
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(scrim);
      scrim.querySelector('[data-a=yes]').focus();
    }

    // ---------- filter popover ----------

    openPop(focusSection) {
      if (this.sel) this.closeSheet();
      this.renderPop();
      this.pop.hidden = false;
      this.fab.setAttribute('aria-expanded', 'true');
      if (focusSection === 'prq') this.pop.querySelector('.prq')?.scrollIntoView({ block: 'nearest' });
    }
    closePop() {
      this.closeMenu();
      if (this.pop.hidden) return;
      this.pop.hidden = true;
      this.fab.setAttribute('aria-expanded', 'false');
    }

    renderPop() {
      const d = this.data;
      if (!d) return;
      const subs = this.subjects();
      const on = subs.filter((s) => !this.hidden.has(s)).length;
      const legendOpen = store.get('mapLegendOpen', false);
      const counts = { claude: 0, path: 0 };   // an arrow in both counts once, as the learner's own Study Path
      for (const e of d.edges) if (e.kind === 'prereq') e.source?.includes('path') ? counts.path++ : counts.claude++;
      const arrows = d.edges.filter((e) => e.kind === 'prereq').length;
      let updated;
      if (d.building) updated = 'Updating now…';
      else if (!d.aiAvailable) updated = "The AI isn't available on this computer, so only your Study Path notes are used.";
      else if (d.paused) updated = `You stopped the last update. It will run again when you add or edit notes.${d.builtAt ? ` Last updated ${ago(d.builtAt)}.` : ''}`;
      else if (d.error) updated = `The last update didn't finish (${d.error.slice(0, 90)}). Showing the saved prerequisites.`;
      else updated = d.builtAt ? `Last updated ${ago(d.builtAt)}.` : 'Not checked by the AI yet.';
      this.pop.innerHTML = `
        <section>
          <h3>Show</h3>
          <label class="row"><span class="grow">Ready to learn only</span>
            <input type="checkbox" class="switch" role="switch" data-f="ready" ${this.readyOnly ? 'checked' : ''}></label>
          <p class="note">Topics you can start now — what they build on is already solid.</p>
        </section>
        <section>
          <h3>Subjects</h3>
          <div class="multiselect">
            <button class="multiselect-trigger field" type="button" aria-haspopup="listbox" aria-expanded="false">
              <span>${on === subs.length ? 'All subjects' : `${on} of ${plural(subs.length, 'subject')}`}</span>${icon('chevron-down')}</button>
          </div>
          <button class="btn btn-plain btn-sm reset" type="button" data-f="reset" ${this.filtersOn() ? '' : 'disabled'}>Reset filters</button>
        </section>
        <section>
          <details data-f="legend" ${legendOpen ? 'open' : ''}><summary>Legend ${icon('chevron-down')}</summary>
            <div class="qm-legend">
              <div><span class="k"><svg width="32" height="12" aria-hidden="true"><path d="M2 6h22" stroke="var(--label-3)" stroke-width="1.4"/><path d="M23 2.5 30 6l-7 3.5z" fill="var(--label-3)"/></svg></span>Learn this first. The arrow points to what builds on it.</div>
              <div><span class="k"><span class="grad"></span></span>Mastery, from new (red) to solid (green).</div>
              <div><span class="k"><svg width="32" height="12" aria-hidden="true"><path d="M2 6h28" stroke="var(--accent)" stroke-width="2"/></svg></span>On hover or select: what to learn before it.</div>
              <div><span class="k"><svg width="32" height="12" aria-hidden="true"><path d="M2 6h28" stroke="var(--green)" stroke-width="2"/></svg></span>…and what it unlocks.</div>
              <div><span class="k"><svg width="32" height="12" aria-hidden="true"><path d="M2 6h28" stroke="var(--label-3)" stroke-width="1.4" stroke-dasharray="1 4" stroke-linecap="round"/></svg></span>Related notes (your links). Shown for the selected topic.</div>
              <div><span class="k" style="color:var(--green)">${icon('leaf')}</span>Ready to learn.</div>
              <div><span class="k" style="color:var(--orange)">${icon('clock')}</span>Reviews due.</div>
              <div><span class="k" style="color:var(--purple)">${icon('book')}</span>Open gaps: things that confused you.</div>
            </div>
          </details>
        </section>
        <section class="prq">
          <h3>Prerequisites</h3>
          <p>An arrow means: learn this first.</p>
          <p class="secondary">They come from your Study Path notes, plus the AI reading your notes. This updates automatically when you add or edit notes.</p>
          <p class="secondary">${esc(updated)}${arrows ? ` ${plural(arrows, 'arrow')}: ${counts.path} from your Study Paths, ${counts.claude} from the AI.` : ''}</p>
          ${d.building
            ? '<button class="btn btn-block" type="button" data-f="cancel">Stop updating</button>'
            : `<button class="btn btn-block" type="button" data-f="recheck" ${d.aiAvailable ? '' : 'disabled'}>Re-check with the AI…</button>`}
        </section>`;
      const P = this.pop;
      P.querySelector('[data-f=ready]').addEventListener('change', (ev) => {
        this.readyOnly = ev.target.checked;
        store.set('mapFrontierOnly', this.readyOnly);
        this.renderStatus();
        P.querySelector('[data-f=reset]').disabled = !this.filtersOn();
      });
      P.querySelector('.multiselect-trigger').addEventListener('click', (ev) => (this.menu ? this.closeMenu() : this.openMenu(ev.currentTarget)));
      P.querySelector('[data-f=reset]').addEventListener('click', () => {
        this.readyOnly = false; this.hidden.clear();
        store.set('mapFrontierOnly', false); store.set('mapHiddenSubjects', []);
        this.closeMenu(); this.renderPop(); this.renderStatus(); this.draw(true);
      });
      P.querySelector('[data-f=legend]').addEventListener('toggle', (ev) => store.set('mapLegendOpen', ev.target.open));
      P.querySelector('[data-f=recheck]')?.addEventListener('click', () => this.confirmRebuild());
      P.querySelector('[data-f=cancel]')?.addEventListener('click', (ev) => this.cancelBuild(ev.currentTarget));
    }

    // Subject multi-select: its menu lives on the map root (not inside the scrolling popover, which would clip it).
    openMenu(trigger) {
      this.closeMenu();
      const subs = this.subjects();
      const n = (s) => this.data.nodes.filter((x) => x.subject === s).length;
      const m = document.createElement('div');
      m.className = 'popover multiselect-menu qm-ms-menu';
      m.setAttribute('role', 'listbox');
      m.setAttribute('aria-multiselectable', 'true');
      m.innerHTML = `<input class="field multiselect-search" type="search" placeholder="Search subjects" aria-label="Search subjects">
        <div class="multiselect-actions"><button class="btn btn-plain btn-sm" type="button" data-m="all">Select all</button>
          <button class="btn btn-plain btn-sm" type="button" data-m="none">None</button></div>
        <div class="multiselect-options">${subs.map((s) => `<label class="multiselect-option" data-s="${esc(s)}">
          <input type="checkbox" class="check" ${this.hidden.has(s) ? '' : 'checked'}><span class="tag" style="--tag:${this.tint(s)}">${esc(s)}</span><span class="n">${n(s)}</span></label>`).join('')}
          <div class="none" hidden>No subjects match.</div></div>`;
      const r = trigger.getBoundingClientRect(), R = this.root.getBoundingClientRect();
      Object.assign(m.style, { left: `${r.left - R.left}px`, top: `${r.bottom - R.top + 6}px`, width: `${r.width}px`, right: 'auto' });
      const apply = () => {
        store.set('mapHiddenSubjects', [...this.hidden]);
        const on = subs.filter((s) => !this.hidden.has(s)).length;
        // the popover may have re-rendered (polling) since the menu opened: use the live trigger
        const trig = this.pop.querySelector('.multiselect-trigger');
        if (trig) trig.querySelector('span').textContent = on === subs.length ? 'All subjects' : `${on} of ${plural(subs.length, 'subject')}`;
        const reset = this.pop.querySelector('[data-f=reset]');
        if (reset) reset.disabled = !this.filtersOn();
        m.querySelectorAll('.multiselect-option').forEach((o) => (o.querySelector('input').checked = !this.hidden.has(o.dataset.s)));
        this.renderStatus();
        this.draw(true);
      };
      m.querySelectorAll('.multiselect-option input').forEach((c) => c.addEventListener('change', () => {
        const s = c.closest('[data-s]').dataset.s;
        c.checked ? this.hidden.delete(s) : this.hidden.add(s);
        apply();
      }));
      m.querySelector('[data-m=all]').addEventListener('click', () => { this.hidden.clear(); apply(); });
      m.querySelector('[data-m=none]').addEventListener('click', () => { subs.forEach((s) => this.hidden.add(s)); apply(); });
      const search = m.querySelector('input[type=search]');
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let any = false;
        m.querySelectorAll('.multiselect-option').forEach((o) => { const hit = o.dataset.s.toLowerCase().includes(q); o.hidden = !hit; any ||= hit; });
        m.querySelector('.none').hidden = any;
      });
      this.root.appendChild(m);
      // keep the menu inside the map: open upwards when there's no room below
      const room = R.bottom - r.bottom - 12;
      if (m.offsetHeight > room && r.top - R.top > room) m.style.top = `${r.top - R.top - m.offsetHeight - 6}px`;
      this.menu = m;
      trigger.setAttribute('aria-expanded', 'true');
      search.focus();
    }
    closeMenu() {
      if (!this.menu) return;
      this.menu.remove();
      this.menu = null;
      this.pop.querySelector('.multiselect-trigger')?.setAttribute('aria-expanded', 'false');
    }

    // ---------- drawing ----------

    visible() {
      const nodes = this.data.nodes.filter((n) => !this.hidden.has(n.subject));
      const ids = new Set(nodes.map((n) => n.id));
      return { nodes, edges: this.data.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
    }

    nodeInner(n) {
      const s = n.stats, front = this.data.frontier.includes(n.id);
      const noQ = !s.total, fresh = !noQ && !s.seen;
      const badges = [
        front ? `<span class="qm-n-b ready" title="Ready to learn">${icon('leaf')}</span>` : '',
        s.dueSeen ? `<span class="qm-n-b due" title="${plural(s.dueSeen, 'review')} due">${icon('clock')}${s.dueSeen}</span>` : '',
        n.gaps.length ? `<span class="qm-n-b gaps" title="${plural(n.gaps.length, 'open gap')}">${icon('book')}${n.gaps.length}</span>` : '',
      ].join('');
      const pct = noQ ? 'No quiz' : fresh ? 'New' : `${s.mastery}%`;
      return `<span class="qm-n-top"><span class="tag" style="--tag:${this.tint(n.subject)}">${esc(n.subject)}</span>${badges}<span class="qm-n-pct">${pct}</span></span>
        <span class="qm-n-text"><span class="qm-n-title">${esc(shortTitle(n.title))}</span>${splitTitle(n.title)[1] ? `<span class="qm-n-sub">${esc(splitTitle(n.title)[1])}</span>` : ''}</span>
        ${noQ ? '' : `<span class="qm-n-bar"><span style="width:${fresh ? 0 : Math.max(3, s.mastery)}%;background:${mColor(s.mastery)}"></span></span>`}`;
    }
    nodeLabel(n) {
      const s = n.stats;
      return `${n.title}. ${n.subject}. ${s.total ? `Mastery ${s.mastery}%, ${s.seen} of ${s.total} questions seen` : 'No questions yet'}${this.data.frontier.includes(n.id) ? '. Ready to learn' : ''}`;
    }
    // Stats changed but the graph didn't: update the cards in place (keeps the view still).
    refreshNodes() {
      for (const el of this.nodesEl.querySelectorAll('.qm-node')) {
        const n = this.data.nodes.find((x) => x.id === el.dataset.id);
        if (!n) continue;
        el.innerHTML = this.nodeInner(n);
        el.classList.toggle('front', this.data.frontier.includes(n.id));
        el.setAttribute('aria-label', this.nodeLabel(n));
      }
    }

    draw(refit) {
      const { nodes, edges } = this.visible();
      this.renderStatus();
      if (!nodes.length) {
        this.nodesEl.innerHTML = ''; this.edgesEl.innerHTML = ''; this.L = null;
        this.emptyEl.hidden = false;
        this.emptyEl.innerHTML = this.data.nodes.length
          ? `<span class="headline">No subjects selected</span><span>Choose subjects in the filter menu to see their topics.</span>
             <button class="btn btn-tinted" type="button" data-e="all">Show all subjects</button>`
          : `<span class="headline">No study notes yet</span><span>Notes you write under Learning/&lt;Subject&gt;/ appear here.</span>`;
        this.emptyEl.querySelector('[data-e=all]')?.addEventListener('click', () => {
          this.hidden.clear(); store.set('mapHiddenSubjects', []); this.closeMenu(); if (!this.pop.hidden) this.renderPop(); this.draw(true);
        });
        if (this.sel) this.closeSheet();
        return;
      }
      this.emptyEl.hidden = true;
      this.lastPerRow = this.perRow();
      const L = layout(nodes, edges, { maxPerRow: this.lastPerRow, ...this.dims() });
      this.L = L;
      const front = new Set(this.data.frontier);
      this.edgesEl.setAttribute('width', L.width);
      this.edgesEl.setAttribute('height', L.height);
      this.edgesEl.innerHTML = `<defs>${['', 'up', 'down'].map((c) => `<marker id="qm-arr${c && '-' + c}" viewBox="0 0 10 10" refX="8.5" refY="5"
          markerWidth="6.5" markerHeight="6.5" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="qm-arrow ${c}" d="M0,1 L9,5 L0,9 z"/></marker>`).join('')}</defs>` +
        L.paths.map(({ e, d }) => `<path class="qm-edge ${e.kind}${e.redundant ? ' redundant' : ''}" data-f="${esc(e.from)}" data-t="${esc(e.to)}" d="${d}"
          ${e.kind === 'prereq' ? 'marker-end="url(#qm-arr)"' : ''}/>`).join('');
      this.nodesEl.innerHTML = nodes.map((n) => {
        const b = L.box.get(n.id);
        return `<button type="button" class="qm-node${b.w < NODE_W ? ' compact' : ''}${front.has(n.id) ? ' front' : ''}${n.stats.total ? '' : ' noq'}" data-id="${esc(n.id)}"
          style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px" aria-label="${esc(this.nodeLabel(n))}">${this.nodeInner(n)}</button>`;
      }).join('');
      if (this.sel && !nodes.some((n) => n.id === this.sel)) this.closeSheet();
      if (refit || !this.fitted) { this.home(); this.fitted = true; } else this.apply();
      this.highlight();
    }

    // First view: the whole map if its text stays readable (>= 12px), else readable and centred on the foundations.
    home() {
      if (!this.L) return;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight, I = this.insets(), L = this.L;
      const aw = w - I.left - I.right, ah = h - I.top - I.bottom;
      const kFit = Math.min(1, aw / L.width, ah / L.height);
      if (kFit >= MIN_READ) return this.setView(I.left + (aw - L.width * kFit) / 2, I.top + (ah - L.height * kFit) / 2, kFit);
      const k = Math.max(MIN_READ, Math.min(1, aw / L.width));
      this.setView(I.left + (aw - L.width * k) / 2, h - I.bottom - L.height * k, k);
    }
    // The fit button: always show everything, however small.
    fitAll(glide = true) {
      if (!this.L) return;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight, I = this.insets(), L = this.L;
      const aw = w - I.left - I.right, ah = h - I.top - I.bottom;
      const k = Math.max(0.2, Math.min(1.25, aw / L.width, ah / L.height));
      this.setView(I.left + (aw - L.width * k) / 2, I.top + (ah - L.height * k) / 2, k, glide);
    }
    setView(x, y, k, glide = false) {
      this.view = { x, y, k };
      this.apply(glide);
    }
    apply(glide = false) {
      const v = this.view;
      if (glide) {
        this.world.classList.add('glide');
        clearTimeout(this.glideT);
        this.glideT = setTimeout(() => this.world.classList.remove('glide'), 480);
      }
      this.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
      const g = 24 * Math.min(2, Math.max(0.5, v.k));
      this.canvas.style.backgroundSize = `${g}px ${g}px`;
      this.canvas.style.backgroundPosition = `${v.x}px ${v.y}px`;
    }
    zoomAt(px, py, f, glide = false) {
      const v = this.view, k = Math.min(2.5, Math.max(0.2, v.k * f));
      this.touched = true;
      this.setView(px - (px - v.x) * (k / v.k), py - (py - v.y) * (k / v.k), k, glide);
    }
    zoomButton(z) {
      const I = this.insets();
      const cx = I.left + (this.canvas.clientWidth - I.left - I.right) / 2, cy = I.top + (this.canvas.clientHeight - I.top - I.bottom) / 2;
      if (z === 'fit') { this.touched = true; this.fitAll(); } else this.zoomAt(cx, cy, z === 'in' ? 1.25 : 0.8, true);
    }
    // Bring a card to the middle of the free space (beside the inspector / above the bottom sheet).
    centreOn(id) {
      const b = this.L?.box.get(id);
      if (!b) return;
      const I = this.insets(), k = Math.max(this.view.k, MIN_READ);
      const cx = I.left + (this.canvas.clientWidth - I.left - I.right) / 2, cy = I.top + (this.canvas.clientHeight - I.top - I.bottom) / 2;
      this.touched = true;
      this.setView(cx - (b.x + b.w / 2) * k, cy - (b.y + b.h / 2) * k, k, true);
    }

    wire() {
      const c = this.canvas;
      const pts = new Map();
      let drag = null;
      const local = (ev) => { const r = c.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
      // Trackpad: pinch arrives as ctrl+wheel (zoom); two-finger scroll pans. A mouse wheel pans too.
      c.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? c.clientHeight : 1;
        if (ev.ctrlKey) { const [x, y] = local(ev); this.zoomAt(x, y, Math.exp(-ev.deltaY * unit * 0.01)); return; }
        this.touched = true;
        this.setView(this.view.x - ev.deltaX * unit, this.view.y - ev.deltaY * unit, this.view.k);
      }, { passive: false });
      // Safari reports trackpad pinch as gesture events instead.
      let g0 = null;
      c.addEventListener('gesturestart', (ev) => { ev.preventDefault(); g0 = this.view.k; });
      c.addEventListener('gesturechange', (ev) => {
        ev.preventDefault();
        if (g0 === null) return;
        const [x, y] = local(ev);
        this.zoomAt(x, y, (g0 * ev.scale) / this.view.k);
      });
      c.addEventListener('gestureend', () => { g0 = null; });
      c.addEventListener('pointerdown', (ev) => {
        if (ev.button > 0) return;
        pts.set(ev.pointerId, local(ev));
        if (pts.size === 1) drag = { start: local(ev), view: { ...this.view }, moved: false };
        else drag = null;
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: this.view.k };
        }
      });
      c.addEventListener('pointermove', (ev) => {
        if (!pts.has(ev.pointerId)) return;
        pts.set(ev.pointerId, local(ev));
        if (pts.size === 2 && this.pinch) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          this.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (this.pinch.k * d / this.pinch.d) / this.view.k);
          this.panEnd = Date.now();
          return;
        }
        if (!drag) return;
        const [x, y] = local(ev);
        if (!drag.moved && Math.hypot(x - drag.start[0], y - drag.start[1]) < 4) return;
        if (!drag.moved) { drag.moved = true; c.setPointerCapture(ev.pointerId); c.classList.add('panning'); }
        this.touched = true;
        this.setView(drag.view.x + x - drag.start[0], drag.view.y + y - drag.start[1], this.view.k);
      });
      const end = (ev) => {
        pts.delete(ev.pointerId);
        if (pts.size < 2) this.pinch = null;
        c.classList.remove('panning');
        if (drag?.moved) this.panEnd = Date.now();   // the click that ends a pan isn't a selection
        drag = null;
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      // A click (not the end of a pan) on a card selects it; on empty canvas it clears the selection.
      c.addEventListener('click', (ev) => {
        if (Date.now() - (this.panEnd || 0) < 80) return;
        const node = ev.target.closest('.qm-node');
        if (node) this.openSheet(node.dataset.id);
        else if (ev.target.closest('.qm-empty button')) return;
        else { this.closePop(); if (this.sel) this.closeSheet(); }
      });
      c.addEventListener('pointerover', (ev) => {
        if (ev.pointerType !== 'mouse') return;
        const n = ev.target.closest('.qm-node');
        if (n && n.dataset.id !== this.hover) { this.hover = n.dataset.id; this.highlight(); }
      });
      c.addEventListener('pointerout', (ev) => {
        const n = ev.target.closest('.qm-node');
        if (n && !n.contains(ev.relatedTarget)) { this.hover = null; this.highlight(); }
      });
      c.addEventListener('focusin', (ev) => {
        const n = ev.target.closest('.qm-node');
        if (n && n.matches(':focus-visible')) { this.hover = n.dataset.id; this.highlight(); }
      });
      c.addEventListener('focusout', () => { this.hover = null; this.highlight(); });
      // Clicks outside the popover (and its subject menu) close it, like a native popover.
      document.addEventListener('pointerdown', (ev) => {
        if (this.menu && !this.menu.contains(ev.target) && !ev.target.closest('.multiselect-trigger')) this.closeMenu();
        if (!this.pop.hidden && !this.pop.contains(ev.target) && !this.fab.contains(ev.target) && !this.menu?.contains(ev.target)
          && !ev.target.closest('.qm-ms-menu')) this.closePop();
      }, true);
    }

    // Everything below that leads here (learn first) and everything above it unlocks.
    chain(id) {
      const pre = this.data.edges.filter((e) => e.kind === 'prereq');
      const walk = (start, next) => {
        const seen = new Set(), stack = [start];
        while (stack.length) for (const x of next(stack.pop())) if (!seen.has(x)) { seen.add(x); stack.push(x); }
        return seen;
      };
      return {
        up: walk(id, (x) => pre.filter((e) => e.to === x).map((e) => e.from)),
        down: walk(id, (x) => pre.filter((e) => e.from === x).map((e) => e.to)),
      };
    }

    highlight() {
      const id = this.hover || this.sel;
      this.root.classList.toggle('focus', !!id);
      this.nodesEl.querySelectorAll('.qm-node').forEach((g) => g.classList.toggle('sel', g.dataset.id === this.sel));
      const { up, down } = id ? this.chain(id) : { up: new Set(), down: new Set() };
      this.nodesEl.querySelectorAll('.qm-node').forEach((g) => {
        const x = g.dataset.id;
        g.classList.toggle('hl', !!id && (x === id || up.has(x) || down.has(x)));
      });
      this.edgesEl.querySelectorAll('.qm-edge').forEach((p) => {
        const f = p.dataset.f, t = p.dataset.t, prereq = p.classList.contains('prereq');
        const isUp = !!id && prereq && up.has(f) && (up.has(t) || t === id);
        const isDown = !!id && prereq && down.has(t) && (down.has(f) || f === id);
        const isLink = !!id && !prereq && (f === id || t === id);
        p.classList.toggle('hl', isUp || isDown || isLink);
        p.classList.toggle('up', isUp);
        p.classList.toggle('down', isDown);
        if (prereq) p.setAttribute('marker-end', `url(#qm-arr${isUp ? '-up' : isDown ? '-down' : ''})`);
      });
    }

    // ---------- inspector ----------

    closeSheet({ refocus = false } = {}) {
      const had = this.sel;
      this.sel = null;
      this.sheet.hidden = true;
      this.sheet.innerHTML = '';
      this.root.classList.remove('sheet-open');
      this.highlight();
      if (had && refocus) this.nodesEl.querySelector(`.qm-node[data-id="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
    }

    openSheet(id, { keepView = false, centre = false } = {}) {
      const d = this.data;
      const n = d.nodes.find((x) => x.id === id);
      if (!n) return this.closeSheet();
      this.closePop();
      const wasOpen = !!this.sel;
      this.sel = id;
      this.highlight();
      const byId = new Map(d.nodes.map((x) => [x.id, x]));
      const s = n.stats;
      const front = d.frontier.includes(id);
      const [title, sub] = splitTitle(n.title);
      const pres = d.edges.filter((e) => e.kind === 'prereq' && e.to === id).map((e) => ({ e, x: byId.get(e.from) })).filter((p) => p.x);
      const unl = d.edges.filter((e) => e.kind === 'prereq' && e.from === id).map((e) => ({ e, x: byId.get(e.to) })).filter((p) => p.x);
      const lnk = d.edges.filter((e) => e.kind === 'link' && (e.from === id || e.to === id)).map((e) => byId.get(e.from === id ? e.to : e.from)).filter(Boolean);
      const blocking = pres.filter((p) => p.x.stats.mastery !== null && p.x.stats.mastery < d.solidAt);
      const reason = (e) => (e.source === 'path' ? 'From your study path' : e.why || '');
      const pctOf = (x) => (x.stats.total ? (x.stats.seen ? `${x.stats.mastery}%` : 'New') : 'No quiz');
      const row = (x, why) => `<button class="list-row" type="button" data-go="${esc(x.id)}">${ring(x.stats.total ? (x.stats.seen ? x.stats.mastery : 0) : null)}
          <span class="grow"><span class="t">${esc(shortTitle(x.title))}</span>${why ? `<span class="r">${esc(why)}</span>` : ''}</span>
          <span class="pct">${pctOf(x)}</span>${icon('chevron-right', 'chevron')}</button>`;
      const group = (label, dot, rows, empty) => (rows.length || empty
        ? `<div class="list-header">${dot ? `<i style="background:${dot}"></i>` : ''}${label}</div><div class="list">${rows.join('') || `<div class="list-empty">${empty}</div>`}</div>` : '');
      this.sheet.innerHTML = `<button class="icon-btn qm-sh-x" type="button" aria-label="Close" title="Close (Esc)">${icon('close')}</button>
        <div class="sheet-body">
          <span class="tag" style="--tag:${this.tint(n.subject)}">${esc(n.subject)}</span>
          <h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
          <div class="qm-mastery">
            ${s.total ? `<div class="big"><b>${s.mastery}%</b><span>mastery</span>
                ${front ? `<span class="badge green">${icon('leaf')}Ready to learn</span>` : ''}</div>
              <div class="progress"><span style="width:${s.seen ? Math.max(2, s.mastery) : 0}%;background:${mColor(s.mastery)}"></span></div>
              <p class="stats">${plural(s.total, 'question')} · ${s.seen} seen · ${s.dueSeen} due</p>`
              : `<div class="big"><b>No questions yet</b></div><p class="stats">Learn it with Teach me, or write questions for this note.</p>`}
            ${!front && blocking.length && s.mastery !== null && s.mastery < d.solidAt
              ? `<p class="hint">Firm up ${blocking.map((p) => esc(shortTitle(p.x.title))).join(', ')} first — ${blocking.length === 1 ? 'it is' : 'they are'} under ${d.solidAt}%.</p>` : ''}
          </div>
          <div class="qm-acts">
            <button class="btn btn-primary btn-lg btn-block" type="button" data-a="quiz" ${n.topics.length ? '' : 'disabled'}>Quiz this topic</button>
            <div class="pair">
              <button class="btn btn-tinted" type="button" data-a="teach">Teach me</button>
              ${n.url ? `<a class="btn btn-plain" href="${esc(n.url)}">Open in Obsidian ${icon('external')}</a>` : ''}
            </div>
          </div>
          ${group('Learn first', 'var(--accent)', pres.map(({ e, x }) => row(x, reason(e))), 'Nothing — this is a foundation.')}
          ${group('Unlocks', 'var(--green)', unl.map(({ e, x }) => row(x, reason(e))))}
          ${group('Related notes', '', lnk.map((x) => row(x, '')))}
          ${group('Open gaps', '', n.gaps.map((g) => `<button class="list-row" type="button" data-gap="${esc(g.id)}">
              <span class="qm-gap-dot">${icon('book')}</span>
              <span class="grow"><span class="t">${esc(g.concept)}</span>${g.question ? `<span class="r">From “${esc(g.question)}”</span>` : ''}</span>
              ${icon('chevron-right', 'chevron')}</button>`))}
        </div>`;
      this.sheet.hidden = false;
      this.root.classList.add('sheet-open');
      if (keepView) this.sheet.style.animation = 'none'; else this.sheet.style.animation = '';
      const S = this.sheet;
      S.querySelector('.qm-sh-x').addEventListener('click', () => this.closeSheet());
      S.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => this.openSheet(a.dataset.go, { centre: true })));
      S.querySelector('[data-a=quiz]').addEventListener('click', () => Q.startSmart(n.topics));
      S.querySelector('[data-a=teach]').addEventListener('click', () =>
        // A quiz topic with no study note yet: the lesson is built from that topic's questions.
        window.dispatchEvent(new CustomEvent('quiz:teach', { detail: n.topicOnly
          ? { goal: n.title, subject: n.subject, topic: n.title }
          : { goal: n.title, subject: n.subject, noteTitle: n.title } })));
      S.querySelectorAll('[data-gap]').forEach((b) => b.addEventListener('click', () => {
        const g = n.gaps.find((x) => x.id === b.dataset.gap);
        window.dispatchEvent(new CustomEvent('quiz:teach', { detail: { goal: g?.concept || n.title, subject: n.subject, noteTitle: n.title, gapId: b.dataset.gap } }));
      }));
      if (keepView) return;
      // Keep the selected card in view: centre it when asked, or when the sheet now covers it.
      const el = this.nodesEl.querySelector(`.qm-node[data-id="${CSS.escape(id)}"]`);
      const r = el?.getBoundingClientRect(), C = this.canvas.getBoundingClientRect(), I = this.insets();
      const covered = r && (r.right > C.right - I.right + 8 || r.bottom > C.bottom - I.bottom + 8 || r.left < C.left || r.top < C.top + 8);
      if (centre || covered) this.centreOn(id);
      if (!wasOpen) S.querySelector('.qm-sh-x').focus({ preventScroll: true });
    }
  }

  // ---------- wiring into the app ----------

  let view = null;
  function showTab() {
    const el = Q.$('tab-map');
    if (!el) return;
    if (!view || !el.contains(view.root)) view = new MapView(el);
    view.load();
  }
  const active = () => view && document.body.classList.contains('mode-map') && view.isVisible();
  document.addEventListener('keydown', (ev) => {
    if (!active() || document.querySelector('.qm-alert-scrim')) return;
    const typing = ev.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (ev.key === 'Escape') {
      if (view.menu) view.closeMenu();
      else if (!view.pop.hidden) { view.closePop(); view.fab.focus(); }
      else if (view.sel) view.closeSheet({ refocus: true });
      else return;
      ev.preventDefault();
      return;
    }
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;   // cmd + / − stays browser zoom
    if (ev.key === '+' || ev.key === '=') { view.zoomButton('in'); ev.preventDefault(); }
    else if (ev.key === '-' || ev.key === '_') { view.zoomButton('out'); ev.preventDefault(); }
    else if (ev.key === '0') { view.zoomButton('fit'); ev.preventDefault(); }
  });
  // The map owns the whole content area while its tab is active (index.html styles body.mode-map).
  Q.on('tab', (t) => {
    document.body.classList.toggle('mode-map', t === 'map');
    if (t === 'map') showTab();
    else if (view) { view.closePop(); clearTimeout(view.poll); }
  });
  if (Q.tab === 'map') { document.body.classList.add('mode-map'); showTab(); }
})();
