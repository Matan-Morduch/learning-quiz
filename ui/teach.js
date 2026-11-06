// Teach mode front end: the #tab-teach panel (goal field, note picker, recent lessons) and the
// lesson screen (a reading column with the teacher's prose and cards, a plan inspector on the right).
// Server side: teach.js. Turns take 20–60 s, so every action POSTs, then polls the session until the
// turn is done; a reload finds the turn still pending and keeps polling.
// Look: Apple HIG on the tokens and controls in ui/base.css; icons from Quiz.icon (ui/icons.js).
(() => {
  const Q = window.Quiz;
  if (!Q) return;

  const css = `
  /* ---------- shared bits ---------- */
  .tc-kbd { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 5px;
    font: 500 12px/1 var(--font); color: var(--label-3); background: var(--fill); flex: none; }
  .btn-primary .tc-kbd { background: rgb(255 255 255 / .2); color: rgb(255 255 255 / .85); }
  .tc-banner { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--orange) 12%, var(--surface)); font: var(--subhead); color: var(--label); }
  .tc-banner > svg { width: 20px; height: 20px; flex: none; color: var(--orange); margin-top: 0; }
  .tc-banner.error { background: color-mix(in srgb, var(--red) 10%, var(--surface)); }
  .tc-banner.error > svg { color: var(--red); }
  .tc-banner .grow { flex: 1; min-width: 0; }
  .tc-banner .t { font: var(--headline); font-size: 15px; }
  .tc-banner .btn { align-self: center; }
  .tc-banner.hidden { display: none; }
  /* think.js's dictation strip, moved into our bars: a plain icon button, no floating chip look */
  .tc-micwrap { position: static !important; margin: 0 !important; display: inline-flex; }
  .tc-micwrap .tm-btn { box-shadow: none !important; background: transparent !important; width: 34px !important; height: 34px !important; }
  .tc-micwrap .tm-btn:hover:not(:disabled) { background: var(--fill) !important; }
  .tc-micwrap .tm-btn.rec { background: var(--red) !important; color: #fff; }

  /* ---------- start screen ---------- */
  #setup:has(> #tab-teach:not(.hidden)) { background: none; border: 0; box-shadow: none; padding: 0; }
  .tc-setup { max-width: var(--read-w); }
  .tc-compose { background: var(--surface); border-radius: var(--r-xl); box-shadow: var(--shadow-2);
    border: 1px solid var(--separator); padding: 18px 20px 14px; transition: box-shadow var(--dur), border-color var(--dur); }
  .tc-compose:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, transparent); box-shadow: var(--shadow-2), 0 0 0 4px var(--accent-tint); }
  .tc-compose textarea { display: block; width: 100%; min-height: 64px !important; max-height: 240px; resize: none; border: 0; outline: 0; padding: 0; background: none;
    font: 400 22px/1.36 var(--font); letter-spacing: -0.015em; color: var(--label); }
  .tc-compose textarea::placeholder { color: var(--label-3); }
  .tc-compose-bar { display: flex; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .tc-compose-bar .spacer { flex: 1; }
  .tc-pop { position: relative; display: inline-flex; align-items: center; min-width: 0; }
  .tc-pop > svg { position: absolute; left: 10px; width: 15px; height: 15px; color: var(--label-2); pointer-events: none; }
  .tc-pop select.field { width: auto; max-width: 260px; height: 32px; padding-left: 31px; border-radius: var(--r-pill); background-color: var(--fill); font: 500 14px/1 var(--font); text-overflow: ellipsis; }
  .tc-pop select.field:hover { background-color: var(--fill-hover); }
  .tc-pop select.field:focus { background-color: var(--fill); }
  .tc-start { height: 36px; padding: 0 8px 0 16px; border-radius: var(--r-pill); font-size: 15px; font-weight: 600; gap: 10px; }
  #tcSource:empty { display: none; }
  #tcSource { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
  .tc-attach { height: 32px; border-radius: var(--r-pill); background: var(--fill); color: var(--label-2); font: 500 14px/1 var(--font); gap: 6px; padding: 0 12px 0 10px; }
  .tc-attach:hover { background: var(--fill-hover); }
  .tc-attach svg { width: 15px; height: 15px; }
  .tc-compose.over { border-color: var(--accent); box-shadow: var(--shadow-2), 0 0 0 4px var(--accent-tint); }
  .tc-matchips { display: flex; flex-wrap: wrap; gap: 6px; position: sticky; bottom: calc(var(--tc-bottom) + 76px); z-index: 10; margin-top: 24px; }
  .tc-matchips[hidden] { display: none; }
  .tc-matchips + .tc-composer { margin-top: 8px; }
  .tc-clip { width: 34px; height: 34px; flex: none; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; background: none; color: var(--label-2); }
  .tc-clip:hover { background: var(--fill); color: var(--label); }
  .tc-clip svg { width: 19px; height: 19px; }
  .tc-composer.over { border-color: var(--accent); box-shadow: var(--shadow-2), 0 0 0 4px var(--accent-tint); }
  .tc-me .tc-mats { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-top: 6px; }
  .tc-head .sub a.tc-mat { color: inherit; text-decoration: none; }
  .tc-head .sub a.tc-mat:hover { color: var(--accent); }
  .tc-token { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 4px 0 12px; border-radius: var(--r-pill);
    background: var(--accent-tint); color: var(--accent); font: 500 14px/1 var(--font); }
  .tc-token svg { width: 15px; height: 15px; }
  .tc-token .icon-btn { width: 24px; height: 24px; color: inherit; }
  .tc-token .icon-btn svg { width: 13px; height: 13px; }
  #tcNoAi { margin-top: 12px; }
  .tc-how { list-style: none; margin: 28px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
  .tc-how li { display: grid; grid-template-columns: 32px 1fr; gap: 4px 12px; align-items: start; }
  .tc-how .tc-ic { grid-row: span 2; width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--accent-tint); color: var(--accent); }
  .tc-how .tc-ic svg { width: 18px; height: 18px; }
  .tc-how b { font: var(--headline); font-size: 15px; }
  .tc-how span { font: var(--footnote); color: var(--label-2); }
  .tc-lessons { margin-top: 40px; }
  .tc-lessons .list-header { padding-left: 16px; font: var(--title3); font-size: 20px; color: var(--label); padding-bottom: 10px; }
  .tc-list { box-shadow: var(--shadow-1); }
  .tc-lrow { cursor: pointer; padding: 12px 8px 12px 16px; transition: background var(--dur); align-items: center; }
  .tc-lrow:hover { background: var(--fill); }
  .tc-lrow:focus-visible { outline-offset: -3px; border-radius: var(--r-lg); }
  .tc-lrow .tc-lt { font: var(--body); line-height: 22px; color: var(--label); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .tc-lrow .tc-lm { display: flex; align-items: center; gap: 8px; margin-top: 4px; font: var(--footnote); color: var(--label-2); min-width: 0; }
  .tc-lrow .tc-lm .src { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .tc-lrow .tc-lm .activity { width: 12px; height: 12px; border-width: 1.5px; }
  .tc-lrow .when { font: var(--subhead); color: var(--label-2); white-space: nowrap; align-self: flex-start; padding-top: 1px; }
  .tc-lrow .tc-more { opacity: 0; transition: opacity var(--dur); flex: none; }
  .tc-lrow:hover .tc-more, .tc-lrow .tc-more:focus-visible, .tc-lrow .tc-more[aria-expanded="true"] { opacity: 1; }
  @media (hover: none) { .tc-lrow .tc-more { opacity: 1; } }
  .tc-lrow .chevron { margin-left: -2px; }
  .tc-empty { padding: 40px 24px 36px; text-align: center; }
  .tc-empty .tc-ic { width: 52px; height: 52px; margin: 0 auto 14px; border-radius: 14px; display: grid; place-items: center; background: var(--fill); color: var(--label-2); }
  .tc-empty .tc-ic svg { width: 28px; height: 28px; }
  .tc-empty h3 { font: var(--headline); margin: 0 0 4px; }
  .tc-empty p { font: var(--subhead); color: var(--label-2); margin: 0 auto 14px; max-width: 380px; }
  .tc-list > .tc-msg { padding: 16px; font: var(--subhead); color: var(--label-2); }
  @media (max-width: 640px) {
    .tc-compose { padding: 16px 16px 12px; }
    .tc-compose textarea { font-size: 20px; }
    .tc-compose-bar .spacer { display: none; }
    .tc-compose-bar .tc-pop { flex: 1 1 140px; }
    .tc-compose-bar .tc-pop select.field { max-width: none; width: 100%; }
    .tc-start { margin-left: auto; }
    .tc-how { grid-template-columns: 1fr; gap: 14px; }
    .tc-lrow .when { display: none; }
  }

  /* ---------- menus + modals ---------- */
  .tc-menu { position: fixed; min-width: 220px; padding: 6px; }
  .tc-menu-item { display: flex; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; height: 34px; padding: 0 10px; border: 0; border-radius: var(--r-xs);
    background: none; color: var(--label); font: 400 15px/1 var(--font); text-align: left; cursor: pointer; }
  .tc-menu-item svg { width: 17px; height: 17px; color: var(--label-2); }
  .tc-menu-item:hover { background: var(--accent); color: var(--on-accent); }
  .tc-menu-item:hover svg { color: var(--on-accent); }
  .tc-menu-item.danger, .tc-menu-item.danger svg { color: var(--red); }
  .tc-menu-item.danger:hover { background: var(--red); color: #fff; }
  .tc-menu-item.danger:hover svg { color: #fff; }
  .tc-menu-item:disabled { opacity: .4; pointer-events: none; }
  .tc-menu-sep { height: 1px; background: var(--separator); margin: 5px 10px; }
  .tc-scrim { z-index: 95; }
  .tc-modal { width: min(600px, 100%); max-height: min(86vh, 900px); display: flex; flex-direction: column; overflow: hidden;
    background: var(--surface); border-radius: var(--r-xl); box-shadow: var(--shadow-3); animation: pop-in .22s var(--spring); }
  .tc-modal.small { width: min(440px, 100%); }
  .tc-modal-head { padding: 22px 24px 6px; }
  .tc-modal-head h2 { font: var(--title2); letter-spacing: -0.015em; margin: 0; }
  .tc-modal-head p { font: var(--subhead); color: var(--label-2); margin: 6px 0 0; }
  .tc-modal-body { padding: 14px 24px 8px; overflow-y: auto; flex: 1; }
  .tc-modal-body > * + * { margin-top: 14px; }
  .tc-modal-body .list { background: var(--surface-2); }
  .tc-modal-body .list-row { font: var(--subhead); min-height: 52px; align-items: flex-start; }
  .tc-modal-body .list-row > svg { width: 20px; height: 20px; color: var(--accent); margin-top: 1px; flex: none; }
  .tc-modal-body .list-row .path { color: var(--label); overflow-wrap: anywhere; font-weight: 500; }
  .tc-modal-body .list-row .footnote { color: var(--label-2); margin-top: 2px; }
  .tc-modal-foot { display: flex; align-items: center; gap: 8px; padding: 14px 24px 20px; border-top: 1px solid var(--separator); flex-wrap: wrap; }
  .tc-modal-foot .spacer { flex: 1; }
  .tc-modal-foot .btn { height: 34px; }
  .tc-modal textarea.field { min-height: 110px; }
  .tc-disc { background: var(--surface-2); border-radius: var(--r-lg); }
  .tc-disc > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 12px 16px; font: 500 15px/20px var(--font); }
  .tc-disc > summary::-webkit-details-marker { display: none; }
  .tc-disc > summary svg { width: 14px; height: 14px; color: var(--label-3); transition: transform var(--dur) var(--ease); }
  .tc-disc[open] > summary svg { transform: rotate(90deg); }
  .tc-disc > summary .n { margin-left: auto; font: var(--footnote); color: var(--label-2); }
  .tc-disc pre { margin: 0; padding: 0 16px 16px; max-height: 340px; overflow: auto; white-space: pre-wrap; font: 400 12.5px/1.55 var(--font-mono); color: var(--label-2); }
  @media (max-width: 700px) {
    /* phone: a bottom sheet with a grabber (same breakpoint as the shared sheets in ui/base.css) */
    .tc-scrim { place-items: end center; padding: 0; }
    .tc-modal { position: relative; width: 100%; max-height: 92vh; max-height: 92dvh; border-radius: var(--r-xl) var(--r-xl) 0 0; animation: sheet-up .32s var(--spring); }
    .tc-modal::before { content: ""; position: absolute; top: 6px; left: 50%; width: 36px; height: 5px; margin-left: -18px; border-radius: 3px; background: var(--label-4); }
    .tc-modal-head, .tc-modal-body, .tc-modal-foot { padding-left: 16px; padding-right: 16px; }
    .tc-modal-foot { flex-direction: column-reverse; align-items: stretch; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
    .tc-modal-foot .spacer { display: none; }
    .tc-modal-foot .btn { height: 44px; font-size: 16px; }
  }

  /* ---------- lesson screen ---------- */
  body.teach-on .wrap { max-width: none; padding: 0 0 16px; }
  .tc-screen { --tc-top: 0px; --tc-bottom: 0px; position: relative; }
  .tc-toolbar { position: sticky; top: var(--tc-top); z-index: 25; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px;
    height: 52px; padding: 0 16px; background: var(--material); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
    border-bottom: 1px solid transparent; transition: border-color var(--dur); }
  .tc-toolbar.scrolled { border-bottom-color: var(--separator); }
  .tc-toolbar .lead { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .tc-back { padding: 0 8px 0 2px; gap: 2px; font-size: 15px; flex: none; }
  .tc-back svg { width: 20px; height: 20px; }
  .tc-tb-title { font: var(--headline); font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
    opacity: 0; transform: translateY(4px); transition: opacity var(--dur), transform var(--dur) var(--ease); }
  .tc-toolbar.scrolled .tc-tb-title { opacity: 1; transform: none; }
  .tc-tb-actions { display: flex; justify-content: flex-end; gap: 4px; }
  .tc-phases { display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px; background: var(--fill); }
  .tc-phases span { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 12px; border-radius: 7px;
    font: 500 13px/1 var(--font); color: var(--label-3); white-space: nowrap; }
  .tc-phases span svg { width: 13px; height: 13px; }
  .tc-phases span.tc-past { color: var(--label-2); }
  .tc-phases span.tc-past svg { color: var(--green); }
  .tc-phases span.tc-on { background: var(--surface); color: var(--label); box-shadow: var(--shadow-1); font-weight: 600; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .tc-phases span.tc-on { background: var(--surface-3); } }
  :root[data-theme="dark"] .tc-phases span.tc-on { background: var(--surface-3); }
  .tc-phases span.tc-fin { background: color-mix(in srgb, var(--green) 18%, transparent); color: color-mix(in srgb, var(--green) 80%, var(--label)); }

  .tc-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; align-items: start; }
  .tc-screen.docked.ins-open .tc-body { grid-template-columns: minmax(0, 1fr) 340px; }
  .tc-main { min-width: 0; padding: 0 24px 48px; }
  .tc-read { max-width: var(--read-w); margin: 0 auto; }
  .tc-head { padding: 36px 0 8px; }
  .tc-head h1 { font: var(--large-title); letter-spacing: -0.022em; margin: 0; text-wrap: balance; }
  .tc-head .sub { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font: var(--subhead); color: var(--label-2); }
  .tc-head .sub span { display: inline-flex; align-items: center; gap: 6px; }
  .tc-head .sub svg { width: 15px; height: 15px; color: var(--label-3); }

  /* the reading column */
  .tc-stream { display: flex; flex-direction: column; gap: 32px; padding-top: 24px; }
  .tc-turn { scroll-margin-top: calc(var(--tc-top) + 68px); }
  .tc-say { font: var(--body); line-height: 1.55; color: var(--label); }
  .tc-say p, .tc-say ul, .tc-say ol, .tc-say pre { margin: 0 0 .85em; }
  .tc-say > :last-child { margin-bottom: 0; }
  .tc-say ul, .tc-say ol, .tc-card ul, .tc-card ol { padding-left: 1.3em; }
  .tc-say li + li, .tc-card li + li { margin-top: .3em; }
  .tc-say strong { font-weight: 600; }
  .tc-screen pre { background: var(--surface-2); border-radius: var(--r); padding: 14px 16px; overflow-x: auto;
    font: 400 14px/1.5 var(--font-mono); color: var(--label); }
  .tc-screen :not(pre) > code { font: 400 .86em/1 var(--font-mono); background: var(--fill); padding: 2px 5px; border-radius: 5px; overflow-wrap: anywhere; }
  .tc-screen pre code { background: none; padding: 0; font: inherit; }
  .tc-note { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; font: var(--footnote); color: var(--label-2); background: none; border: 0; padding: 0; cursor: pointer; }
  .tc-note svg { width: 15px; height: 15px; color: var(--accent); }
  .tc-note:hover { color: var(--accent); }
  .tc-divider { display: flex; align-items: center; gap: 14px; font: 600 13px/18px var(--font); color: var(--label-2); margin: 8px 0 -8px; }
  .tc-divider::before, .tc-divider::after { content: ''; flex: 1; height: 1px; background: var(--separator); }
  .tc-me { align-self: flex-end; max-width: min(80%, 520px); display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .tc-me small { font: var(--caption); color: var(--label-2); padding-right: 4px; }
  button.tc-answered { border: 0; background: none; padding: 0; cursor: pointer; text-align: right; font: inherit; }
  .tc-answered .bubble { background: var(--fill); color: var(--label); }
  .tc-answered:hover .bubble { background: color-mix(in srgb, var(--accent) 18%, var(--fill)); }
  .tc-me .bubble { background: var(--accent); color: var(--on-accent); padding: 9px 14px; border-radius: 19px 19px 6px 19px; font: var(--body); line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }

  /* cards */
  .tc-card { margin-top: 24px; background: var(--surface); border-radius: var(--r-xl); padding: 22px 24px 20px;
    box-shadow: var(--shadow-1); border: 1px solid var(--separator); }
  .tc-turn > .tc-card:first-child, .tc-gate + .tc-card { margin-top: 0; }
  .tc-gate + .tc-card { margin-top: 16px; }
  .tc-card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .tc-card-head .footnote { color: var(--label-2); }
  .tc-card-head .badge { height: 22px; padding: 0 9px; font-size: 12.5px; }
  .tc-q { font: 600 19px/1.4 var(--font); letter-spacing: -0.012em; color: var(--label); }
  .tc-q p { margin: 0 0 .5em; } .tc-q > :last-child { margin-bottom: 0; }
  .tc-q pre { font-size: 14px; font-weight: 400; margin: .6em 0; }
  .tc-q code { font-weight: 500; }
  .tc-opts { display: flex; flex-direction: column; gap: 8px; margin: 18px 0 0; }
  .tc-opt { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 14px; align-items: start; width: 100%; min-height: 52px;
    padding: 14px 14px 14px 16px; border: 0; border-radius: var(--r-lg); background: var(--surface-2); color: var(--label);
    font: var(--body); line-height: 1.4; text-align: left; cursor: pointer; box-shadow: inset 0 0 0 1px transparent;
    transition: background var(--dur), box-shadow var(--dur), transform .1s var(--ease); }
  .tc-opt:hover { background: var(--surface-3); }
  .tc-opt:active { transform: scale(.995); }
  .tc-radio { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--separator-strong); background: var(--surface); display: grid; place-items: center; margin-top: 0; transition: border-color var(--dur), background var(--dur); }
  .tc-opt.sel { background: var(--accent-tint); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .tc-opt.sel .tc-radio { border-color: var(--accent); background: var(--accent); }
  .tc-opt.sel .tc-radio::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
  .tc-opt .tc-kbd { margin-top: 1px; }
  .tc-opt.sel .tc-kbd { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
  .tc-opt.tc-idk { background: none; box-shadow: inset 0 0 0 1px var(--separator); color: var(--label-2); min-height: 48px; padding-top: 12px; padding-bottom: 12px; }
  .tc-opt.tc-idk:hover { background: var(--fill); }
  .tc-opt.tc-idk.sel { background: color-mix(in srgb, var(--orange) 12%, transparent); box-shadow: inset 0 0 0 1.5px var(--orange); color: var(--label); }
  .tc-opt.tc-idk.sel .tc-radio { border-color: var(--orange); background: var(--orange); }
  .tc-opt.tc-idk.sel .tc-kbd { background: color-mix(in srgb, var(--orange) 18%, transparent); color: var(--orange); }
  .tc-free { margin-top: 18px; }
  .tc-free textarea.field { min-height: 110px; }
  .tc-free textarea.field { padding-bottom: 44px; }
  /* answered options */
  .tc-opt.static { cursor: default; grid-template-columns: 22px minmax(0, 1fr) auto; background: none; box-shadow: inset 0 0 0 1px var(--separator); }
  .tc-opt.static:active { transform: none; }
  .tc-opt.static > svg { width: 22px; height: 22px; color: var(--label-4); }
  .tc-opt.static.dim { color: var(--label-2); }
  .tc-opt.static.right { background: color-mix(in srgb, var(--green) 10%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--green) 70%, transparent); }
  .tc-opt.static.right > svg { color: var(--green); }
  .tc-opt.static.wrong { background: color-mix(in srgb, var(--red) 8%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--red) 60%, transparent); }
  .tc-opt.static.wrong > svg { color: var(--red); }
  .tc-opt .mis { display: block; margin-top: 4px; font: var(--subhead); color: var(--label-2); }
  .tc-opt .badge { margin-top: 1px; }
  .tc-result { display: flex; align-items: center; gap: 8px; margin-top: 18px; font: var(--headline); }
  .tc-result svg { width: 22px; height: 22px; flex: none; }
  .tc-result.ok { color: color-mix(in srgb, var(--green) 85%, var(--label)); }
  .tc-result.bad { color: var(--red); }
  .tc-result.idk { color: color-mix(in srgb, var(--orange) 90%, var(--label)); }
  .tc-result .score { margin-left: auto; font: var(--subhead); font-weight: 600; color: var(--label-2); }
  .tc-expl { margin-top: 10px; padding: 14px 16px; border-radius: var(--r-lg); background: var(--surface-2); font: var(--body); line-height: 1.5; }
  .tc-expl p { margin: 0 0 .7em; } .tc-expl > :last-child { margin-bottom: 0; }
  .tc-expl .lbl, .tc-quote .lbl, .tc-yours .lbl { display: block; font: 600 13px/18px var(--font); color: var(--label-2); margin-bottom: 4px; }
  .tc-gotmiss { display: grid; gap: 8px; margin-top: 10px; font: var(--subhead); }
  .tc-gotmiss div { display: grid; grid-template-columns: 18px 1fr; gap: 10px; }
  .tc-gotmiss svg { width: 18px; height: 18px; margin-top: 1px; }
  .tc-gotmiss .g svg { color: var(--green); } .tc-gotmiss .m svg { color: var(--red); }
  .tc-quote { margin-top: 16px; padding: 12px 16px; border-radius: var(--r-lg); background: var(--surface-2); font: var(--body); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .tc-yours { display: grid; gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--separator); font: var(--subhead); color: var(--label); white-space: pre-wrap; overflow-wrap: anywhere; }
  .tc-yours .conf { display: inline-flex; align-items: center; gap: 6px; color: var(--label-2); }
  .tc-yours .conf svg { width: 15px; height: 15px; }
  .tc-card.stale { opacity: .6; }
  .tc-card.stale .tc-q { font: var(--headline); }
  .tc-stale { margin-top: 10px; font: var(--footnote); color: var(--label-3); }
  /* confidence + thinking (think.js widgets): their own look, our spacing */
  .tc-card .think-conf { margin-top: 20px; }
  .tc-card details.think-field { margin-top: 14px; }
  .tc-gate details.think-field { margin-top: 8px; }
  .tc-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 22px; flex-wrap: wrap; }
  .tc-foot .hint { font: var(--footnote); color: var(--label-3); display: inline-flex; gap: 6px; align-items: center; }
  .tc-foot .btn { height: 36px; padding: 0 18px; font-weight: 600; }
  .tc-foot .lead { margin-right: auto; }
  /* the check gate: thinking while reading, then the card */
  .tc-gate { margin-top: 28px; padding: 18px 20px; border-radius: var(--r-xl); background: var(--surface); border: 1px solid var(--separator); box-shadow: var(--shadow-1); }
  .tc-gate > p { margin: 0; font: var(--subhead); color: var(--label-2); }
  .tc-gate details.think-field { margin-top: 6px; }
  .tc-gate .btn { margin-top: 14px; height: 44px; padding: 0 20px; font-size: 16px; font-weight: 600; border-radius: var(--r); }
  .tc-gate .btn svg { width: 18px; height: 18px; }
  /* plan card */
  .tc-plan-goal { font: var(--title3); margin: 0 0 6px; }
  .tc-plan-sum { font: var(--body); color: var(--label-2); line-height: 1.45; }
  .tc-steps { list-style: none; counter-reset: s; margin: 18px 0 0; padding: 0; border-radius: var(--r-lg); background: var(--surface-2); }
  .tc-steps li { counter-increment: s; display: grid; grid-template-columns: 26px 1fr auto; gap: 12px; align-items: center; min-height: 46px; padding: 9px 14px; position: relative; font: var(--body); }
  .tc-steps li + li::before { content: ''; position: absolute; top: 0; left: 52px; right: 0; border-top: 1px solid var(--separator); }
  .tc-steps li > i { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 600 13px/1 var(--font); font-style: normal; background: var(--accent-tint); color: var(--accent); }
  .tc-steps li > i::before { content: counter(s); }
  .tc-steps li.known { color: var(--label-2); }
  .tc-steps li.known > i { background: var(--fill); color: var(--label-2); }
  .tc-steps li.goal > i { background: var(--accent); color: var(--on-accent); }
  .tc-card .tc-map-svg { margin-top: 16px; }
  .tc-screen.docked.ins-open .tc-card .tc-map-svg { display: none; }   /* the inspector shows it */
  .tc-approved { display: flex; align-items: center; gap: 8px; margin-top: 16px; font: var(--subhead); color: var(--label-2); }
  .tc-approved svg { width: 18px; height: 18px; color: var(--green); flex: none; }
  .tc-change { margin-top: 16px; }
  .tc-change.hidden { display: none; }
  /* done card */
  .tc-card.done .tc-done-sum { font: var(--body); line-height: 1.5; }
  .tc-card.done h4 { font: 600 15px/20px var(--font); margin: 18px 0 6px; }
  .tc-card.done ul { margin: 0; font: var(--body); }

  /* board answers: the player sits above the reply's recap; small tools under each reply */
  .tc-board { margin-bottom: 14px; }
  .tc-tools { display: flex; flex-wrap: wrap; gap: 2px; margin: 8px 0 0 -8px; }
  .tc-tool { border: 0; background: none; color: var(--label-2); font: var(--footnote); display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 14px; cursor: pointer; }
  .tc-tool svg { width: 15px; height: 15px; }
  .tc-tool:hover { background: var(--fill); color: var(--label); }
  .tc-tool.on { color: var(--accent); }
  .tc-tool:disabled { color: var(--label-4); background: none; cursor: default; }
  .tc-boardnote { display: flex; gap: 8px; align-items: center; font: var(--footnote); color: var(--label-2); margin-bottom: 10px; }
  .tc-boardnote svg { width: 15px; height: 15px; color: var(--orange); }
  .tc-boardtog { width: 34px; height: 34px; flex: none; border: 0; border-radius: 50%; background: none; color: var(--label-2); display: grid; place-items: center; cursor: pointer; transition: background var(--dur), color var(--dur); }
  .tc-boardtog svg { width: 19px; height: 19px; }
  .tc-boardtog:hover { background: var(--fill); }
  .tc-boardtog[aria-pressed="true"] { background: var(--accent-tint); color: var(--accent); }
  .tc-boardtog:disabled { color: var(--label-4); background: none; cursor: default; }
  /* hands-free button and its status pill above the composer */
  .tc-hf { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 50%; background: none; color: var(--label-2); cursor: pointer; }
  .tc-hf:hover { background: var(--fill); }
  .tc-hf svg { width: 19px; height: 19px; }
  .tc-hf.on { background: var(--accent); color: #fff; }
  .tc-hf[hidden] { display: none; }
  .tc-hf-pill { position: absolute; left: 50%; top: -34px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px;
    border-radius: var(--r-pill); background: var(--surface); box-shadow: var(--shadow-1), 0 0 0 .5px var(--separator); font: 600 13px/18px var(--font); color: var(--label-2); white-space: nowrap; pointer-events: none; }
  .tc-hf-pill i { width: 9px; height: 9px; border-radius: 50%; background: var(--green); transform: scale(calc(.7 + var(--lv, 0) * .8)); transition: transform .08s linear; }
  .tc-hf-pill[data-state="hearing"] { background: var(--red); color: #fff; }
  .tc-hf-pill[data-state="hearing"] i { background: #fff; }
  .tc-hf-pill[data-state="transcribing"] i { background: var(--accent); }
  body.tc-holding .tc-hf-pill { display: none; }
  /* a question asked while the teacher was still writing (sent the moment it finishes) */
  .tc-queued { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 8px; padding: 10px 12px; border-radius: var(--r); background: var(--accent-tint); font: var(--subhead); }
  .tc-queued .activity { flex: none; margin-top: 4px; }
  .tc-queued > span:nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .tc-queued .secondary { color: var(--label-2); font: var(--footnote); }
  .tc-queued button { flex: none; border: 0; background: none; color: var(--label-2); cursor: pointer; padding: 2px; }
  .tc-queued button svg { width: 16px; height: 16px; }
  /* holding Space: a clear "listening" state on the composer */
  body.tc-holding .tc-composer { box-shadow: 0 0 0 2px var(--red), var(--shadow-1); }
  body.tc-holding .tc-composer::before { content: "Listening… let go of Space to send"; position: absolute; left: 50%; top: -34px; transform: translateX(-50%);
    padding: 5px 12px; border-radius: var(--r-pill); background: var(--red); color: #fff; font: 600 13px/18px var(--font); white-space: nowrap; pointer-events: none; }
  /* his drawing on a board rides along with the next message */
  .tc-drawchip { position: absolute; left: 14px; bottom: calc(100% + 8px); display: inline-flex; align-items: center; gap: 7px; max-width: calc(100% - 28px);
    padding: 5px 5px 5px 11px; border-radius: var(--r-pill); background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
    border: 1px solid var(--separator); box-shadow: var(--shadow-1); font: var(--footnote); color: var(--label); animation: fade-in .18s var(--ease); }
  .tc-drawchip[hidden] { display: none; }
  .tc-drawchip > svg { width: 15px; height: 15px; color: var(--accent); flex: none; }
  .tc-drawchip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tc-drawchip button { width: 22px; height: 22px; flex: none; border: 0; border-radius: 50%; background: none; color: var(--label-2); display: grid; place-items: center; cursor: pointer; }
  .tc-drawchip button:hover { background: var(--fill); color: var(--label); }
  .tc-drawchip button svg { width: 13px; height: 13px; }
  .tc-drew { display: inline-flex; align-items: center; gap: 4px; }
  .tc-drew svg { width: 12px; height: 12px; }
  .tc-drewnote { display: flex; align-items: center; gap: 6px; margin-top: 12px; font: var(--footnote); color: var(--label-2); }
  .tc-drewnote svg { width: 14px; height: 14px; }

  /* the auto-prepared save at the end of a lesson (renderAutoSave) */
  .tc-autosave { margin-top: 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 12px 14px; border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--accent) 8%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); font: var(--subhead); color: var(--label); }
  .tc-autosave[hidden] { display: none; }
  .tc-autosave > svg, .tc-autosave > .activity { width: 18px; height: 18px; flex: none; color: var(--accent); align-self: flex-start; margin-top: 1px; }
  .tc-autosave.saved { background: color-mix(in srgb, var(--green) 9%, var(--surface)); border-color: color-mix(in srgb, var(--green) 26%, transparent); }
  .tc-autosave.saved > svg { color: var(--green); }
  .tc-autosave.failed { background: color-mix(in srgb, var(--red) 8%, var(--surface)); border-color: color-mix(in srgb, var(--red) 22%, transparent); }
  .tc-autosave.failed > svg { color: var(--red); }
  .tc-autosave .msg { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
  .tc-autosave .msg .t { font-weight: 600; }
  .tc-autosave .msg .d { color: var(--label-2); font: var(--footnote); margin-top: 2px; }
  .tc-autosave .msg a { color: var(--accent); text-decoration: none; }
  .tc-autosave .msg a:hover { text-decoration: underline; }
  .tc-autosave .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  .tc-autosave .x { width: 26px; height: 26px; border: 0; border-radius: 50%; background: none; color: var(--label-2); display: grid; place-items: center; cursor: pointer; flex: none; }
  .tc-autosave .x:hover { background: var(--fill); color: var(--label); }
  .tc-autosave .x svg { width: 13px; height: 13px; }
  @media (max-width: 520px) { .tc-autosave .acts { margin-left: 30px; } }

  /* status + composer */
  .tc-status:empty { display: none; }
  .tc-status { margin-top: 28px; }
  .tc-busy { display: flex; align-items: center; gap: 10px; font: var(--subhead); color: var(--label-2); min-height: 32px; }
  .tc-busy .secs { font: var(--footnote); color: var(--label-3); font-variant-numeric: tabular-nums; }
  .tc-wait { display: flex; align-items: center; gap: 12px; padding: 20px 0; font: var(--body); color: var(--label-2); }
  .tc-composer { position: sticky; bottom: calc(var(--tc-bottom) + 16px); z-index: 10; margin-top: 36px; display: flex; align-items: flex-end; gap: 6px;
    padding: 6px 6px 6px 18px; border-radius: 24px; border: 1px solid var(--separator);
    background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); box-shadow: var(--shadow-2);
    transition: border-color var(--dur), box-shadow var(--dur); }
  .tc-composer:focus-within { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .tc-composer textarea { flex: 1; min-width: 0; height: 36px; min-height: 0; max-height: 180px; resize: none; border: 0; outline: 0; background: none; padding: 7px 0;
    font: var(--body); line-height: 22px; color: var(--label); }
  .tc-composer textarea::placeholder { color: var(--label-3); }
  .tc-composer .tc-micwrap .msg { max-width: 180px; }
  .tc-send { width: 34px; height: 34px; flex: none; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer;
    background: var(--accent); color: var(--on-accent); transition: background var(--dur), opacity var(--dur), transform .1s; }
  .tc-send:active { transform: scale(.94); }
  .tc-send svg { width: 18px; height: 18px; }
  .tc-send:disabled { background: var(--fill-hover); color: var(--label-3); cursor: default; }

  /* inspector: the plan map, what the probe found, what was saved */
  .tc-inspector { display: none; }
  .tc-screen.docked.ins-open .tc-inspector { display: flex; position: sticky; top: calc(var(--tc-top) + 64px); margin: 12px 16px 0 0;
    max-height: calc(100vh - var(--tc-top) - var(--tc-bottom) - 88px); }
  .tc-inspector { flex-direction: column; overflow: hidden; background: var(--surface); border: 1px solid var(--separator); border-radius: var(--r-xl); box-shadow: var(--shadow-1); }
  .tc-screen:not(.docked) .tc-inspector.open { display: flex; position: fixed; z-index: 96; top: 12px; right: 12px; bottom: 12px; width: min(380px, calc(100vw - 24px));
    background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); box-shadow: var(--shadow-3); animation: sheet-in .28s var(--spring); }
  .tc-ins-scrim { position: fixed; inset: 0; z-index: 95; background: rgb(0 0 0 / .28); animation: fade-in .18s var(--ease); }
  .tc-ins-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 6px 18px; }
  .tc-ins-head h2 { font: var(--headline); margin: 0; }
  .tc-screen.docked .tc-ins-head .icon-btn { display: none; }
  .tc-ins-body { overflow-y: auto; padding: 0 18px 18px; }
  .tc-ins-sec + .tc-ins-sec { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--separator); }
  .tc-ins-sec h3 { font: 600 13px/18px var(--font); color: var(--label-2); margin: 0 0 8px; }
  .tc-ins-sec.hidden { display: none; }
  .tc-ins-sum { font: var(--footnote); color: var(--label-2); margin: 0 0 12px; }
  .tc-map-svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
  .tc-map-svg .edge { fill: none; stroke: var(--label-4); stroke-width: 1.4; }
  .tc-map-svg .arrow { fill: var(--label-4); }
  .tc-map-svg .node rect { fill: var(--surface); stroke: var(--separator-strong); stroke-width: 1; }
  .tc-map-svg .node text { fill: var(--label); font: 500 12px var(--font); }
  .tc-map-svg .node.known rect { fill: none; stroke-dasharray: 3 3; }
  .tc-map-svg .node.known text { fill: var(--label-2); font-weight: 400; }
  .tc-map-svg .node.visited rect { fill: var(--surface-2); stroke: color-mix(in srgb, var(--green) 55%, transparent); }
  .tc-map-svg .node.goal rect { stroke: var(--label); stroke-width: 1.6; }
  .tc-map-svg .node.goal text { font-weight: 700; }
  .tc-map-svg .node.current rect { fill: var(--accent); stroke: var(--accent); }
  .tc-map-svg .node.current text { fill: var(--on-accent); font-weight: 600; }
  .tc-map-svg .tick circle { fill: var(--green); } .tc-map-svg .tick path { stroke: #fff; stroke-width: 1.6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .tc-inspector .tc-map-svg .node text { font-size: 11.5px; }
  .tc-map-svg .node { cursor: default; }
  .tc-tip { position: fixed; z-index: 1000; max-width: 280px; padding: 8px 12px; border-radius: var(--r-sm, 8px); pointer-events: none;
    background: var(--material-thick, var(--surface)); -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
    box-shadow: var(--shadow-2), 0 0 0 .5px var(--separator); font: 500 13px/18px var(--font); color: var(--label);
    opacity: 0; transform: translateY(2px); transition: opacity .12s, transform .12s; }
  .tc-tip.show { opacity: 1; transform: none; }
  .tc-tip small { display: block; font: 400 12px/16px var(--font); color: var(--label-2); margin-top: 2px; }
  .tc-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-top: 14px; font: var(--footnote); color: var(--label-2); }
  .tc-legend span { display: inline-flex; align-items: center; gap: 8px; }
  .tc-legend i { width: 18px; height: 12px; border-radius: 4px; flex: none; border: 1px solid var(--separator-strong); background: var(--surface); }
  .tc-legend i.cur { background: var(--accent); border-color: var(--accent); }
  .tc-legend i.vis { background: var(--surface-2); border-color: color-mix(in srgb, var(--green) 55%, transparent); }
  .tc-legend i.kn { background: none; border-style: dashed; }
  .tc-legend i.goal { border: 1.6px solid var(--label); }
  .tc-legend-note { margin: 10px 0 0; font: var(--footnote); color: var(--label-3); }
  .tc-ins-empty { font: var(--subhead); color: var(--label-2); margin: 4px 0 0; }
  .tc-assess { display: grid; gap: 14px; }
  .tc-assess .s { font: 600 14px/19px var(--font); margin-bottom: 4px; }
  .tc-assess .r { display: grid; grid-template-columns: 16px 1fr; gap: 8px; font: 400 14px/19px var(--font); color: var(--label-2); margin-top: 4px; }
  .tc-assess .r svg { width: 16px; height: 16px; margin-top: 1px; }
  .tc-assess .r.f svg { color: var(--green); } .tc-assess .r.c svg { color: var(--accent); } .tc-assess .r.m svg { color: var(--orange); }
  .tc-saved { display: grid; gap: 8px; font: 400 14px/19px var(--font); }
  .tc-saved div { display: grid; grid-template-columns: 16px 1fr; gap: 8px; overflow-wrap: anywhere; }
  .tc-saved svg { width: 16px; height: 16px; color: var(--green); margin-top: 1px; }
  .tc-ins-actions { display: flex; gap: 8px; margin-top: 14px; }

  /* ---------- lab: terminal column, task cards, labs list ---------- */
  .tc-termcol { display: none; }
  .tc-screen.term-open .tc-body { grid-template-columns: minmax(0, 1fr) var(--term-w, 48%); }
  /* drag handle: the terminal's left edge (column) or top edge (bottom sheet) */
  .tc-termgrip { position: absolute; z-index: 5; left: -10px; top: 12px; bottom: 16px; width: 14px; cursor: col-resize; touch-action: none; display: grid; place-items: center; outline: none; }
  .tc-termgrip::before { content: ''; width: 4px; height: 44px; border-radius: 2px; background: var(--separator-strong); opacity: .7; transition: opacity var(--dur), background var(--dur), height var(--dur); }
  .tc-termgrip:hover::before, .tc-termgrip:focus-visible::before, body.tc-dragging .tc-termgrip::before { opacity: 1; background: var(--accent); height: 72px; }
  .tc-screen.narrow .tc-termgrip { left: 0; right: 0; top: -7px; bottom: auto; width: auto; height: 14px; cursor: row-resize; }
  .tc-screen.narrow .tc-termgrip::before { width: 44px; height: 4px; }
  .tc-screen.narrow .tc-termgrip:hover::before, body.tc-dragging .tc-screen.narrow .tc-termgrip::before { width: 72px; height: 4px; }
  body.tc-dragging { user-select: none; -webkit-user-select: none; }
  body.tc-dragging.tc-drag-x, body.tc-dragging.tc-drag-x * { cursor: col-resize !important; }
  body.tc-dragging.tc-drag-y, body.tc-dragging.tc-drag-y * { cursor: row-resize !important; }
  body.tc-dragging .lab-pane { pointer-events: none; }
  .tc-screen.term-open .tc-termcol { display: block; position: sticky; top: calc(var(--tc-top) + 52px); padding: 12px 16px 16px 0;
    height: calc(100vh - var(--tc-top) - 52px - var(--tc-sb, 0px)); }
  .tc-screen.term-open.narrow .tc-body { grid-template-columns: minmax(0, 1fr); }
  .tc-screen.term-open.narrow .tc-termcol { position: fixed; z-index: 30; left: 0; right: 0; top: auto; bottom: var(--tc-sb, 0px); height: var(--tc-sheet, 46vh); padding: 0; }
  .tc-screen.term-open.narrow .tc-termcol .lab-pane { border-radius: var(--r-xl) var(--r-xl) 0 0; box-shadow: var(--shadow-3); }
  .tc-screen.term-open.narrow .tc-main { padding-bottom: var(--tc-sheet, 46vh); }
  #tcTermBtn.hidden { display: none; }
  #tcTermBtn[aria-pressed="true"] { color: var(--accent); background: var(--accent-tint); }
  .tc-ran { align-self: flex-end; display: inline-flex; align-items: center; gap: 8px; max-width: min(90%, 560px); padding: 7px 12px; border: 1px solid var(--separator); border-radius: var(--r-pill);
    background: var(--surface); color: var(--label-2); font: var(--footnote); cursor: pointer; text-align: left; }
  .tc-ran:hover { background: var(--fill); color: var(--label); }
  .tc-ran svg { width: 15px; height: 15px; flex: none; color: var(--label-3); }
  .tc-ran code { font: 500 12px/1 var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; display: inline-block; vertical-align: middle; }
  .tc-ran .bad { color: var(--red); }
  .tc-hint { margin-top: 14px; background: var(--surface-2); border-radius: var(--r-lg); }
  .tc-hint > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 10px 14px; font: 500 14px/20px var(--font); color: var(--label-2); }
  .tc-hint > summary::-webkit-details-marker { display: none; }
  .tc-hint > summary svg { width: 16px; height: 16px; color: var(--orange); }
  .tc-hint > div { padding: 0 14px 12px; font: var(--body); line-height: 1.5; }
  .tc-hint > div p { margin: 0 0 .5em; } .tc-hint > div > :last-child { margin-bottom: 0; }
  .tc-hint pre { margin: 6px 0 0; }
  .tc-askq { margin-top: 18px; font: 600 16px/1.4 var(--font); }
  .tc-askq p { margin: 0; }
  .tc-askq .lbl { display: block; font: 600 13px/18px var(--font); color: var(--label-2); margin-bottom: 2px; }
  .tc-taskterm { margin-top: 14px; }
  .tc-prep { margin-top: 14px; border-radius: var(--r-lg); background: color-mix(in srgb, var(--green) 9%, var(--surface-2)); padding: 10px 14px 12px; }
  .tc-prep.bad { background: color-mix(in srgb, var(--red) 10%, var(--surface-2)); }
  .tc-prep .hd { display: flex; align-items: center; gap: 8px; font: 500 14px/20px var(--font); color: var(--label-2); }
  .tc-prep .hd svg { width: 16px; height: 16px; flex: none; color: var(--green); }
  .tc-prep.bad .hd svg { color: var(--red); }
  .tc-prep .hd code { font: 500 13px/1 var(--font-mono); color: var(--label); }
  .tc-prep .hd .cp { margin-left: auto; }
  .tc-prep details { margin-top: 6px; }
  .tc-prep summary { cursor: pointer; font: 500 13px/20px var(--font-mono); color: var(--label); list-style: none; display: flex; align-items: center; gap: 6px; }
  .tc-prep summary::-webkit-details-marker { display: none; }
  .tc-prep summary svg { width: 12px; height: 12px; color: var(--label-3); transition: transform var(--dur) var(--ease); }
  .tc-prep details[open] summary svg { transform: rotate(90deg); }
  .tc-prep summary .x { font: var(--footnote); color: var(--label-3); }
  .tc-prep pre { margin: 6px 0 0; max-height: 320px; overflow: auto; }
  .tc-taskterm .btn svg { width: 16px; height: 16px; }
  .tc-checkres { margin-top: 12px; }
  .tc-checkres .lbl { display: block; font: 600 13px/18px var(--font); color: var(--label-2); margin-bottom: 4px; }
  .tc-checkres pre { margin: 0; font-size: 12.5px; max-height: 220px; overflow: auto; }
  .tc-checkres .ex { font: 600 12px var(--font-mono); margin-left: 6px; }
  .tc-steps-lab li.done > i { background: var(--green); color: #fff; }
  .tc-steps-lab li.done > i::before { content: '✓'; }
  .tc-steps-lab li.done { color: var(--label-2); }
  /* start screen: labs */
  .tc-labs { margin-top: 40px; }
  .tc-labs .list-header { display: flex; align-items: baseline; gap: 12px; padding-left: 16px; padding-bottom: 10px; font: var(--title3); font-size: 20px; color: var(--label); }
  .tc-vm { display: inline-flex; align-items: center; gap: 6px; font: var(--footnote); color: var(--label-2); margin-left: auto; padding-right: 4px; }
  .tc-vm .lab-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--label-4); }
  .tc-vm .lab-dot.on { background: var(--green); }
  .tc-vm button { border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; padding: 0 2px; }
  .tc-labrow { cursor: pointer; padding: 12px 8px 12px 16px; align-items: center; transition: background var(--dur); }
  .tc-labrow:hover { background: var(--fill); }
  .tc-labrow > .tc-labic { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: color-mix(in srgb, var(--green) 14%, transparent); color: color-mix(in srgb, var(--green) 80%, var(--label)); flex: none; }
  .tc-labrow > .tc-labic svg { width: 19px; height: 19px; }
  .tc-labrow .tc-lt { font: var(--body); color: var(--label); }
  .tc-labrow .tc-lm { font: var(--footnote); color: var(--label-2); margin-top: 2px; }
  .tc-labrow .tc-prog { display: inline-flex; gap: 3px; vertical-align: middle; margin-left: 4px; }
  .tc-labrow .tc-prog i { width: 14px; height: 4px; border-radius: 2px; background: var(--fill-hover); }
  .tc-labrow .tc-prog i.on { background: var(--green); }
  .tc-labs .tc-msg { padding: 14px 16px; font: var(--subhead); color: var(--label-2); }
  .tc-labs .tc-msg code { font: 500 12.5px var(--font-mono); }

  @media (max-width: 640px) {
    .tc-toolbar { grid-template-columns: auto 1fr auto; gap: 6px; padding: 0 8px; }
    .tc-tb-title { display: none; }
    .tc-phases { justify-self: center; }
    .tc-phases span { padding: 0 8px; font-size: 12.5px; }
    .tc-back span { display: none; }
    .tc-main { padding: 0 16px; }
    .tc-head { padding-top: 22px; }
    .tc-head h1 { font: var(--title1); }
    .tc-card { padding: 18px 16px 16px; border-radius: var(--r-lg); }
    .tc-gate { padding: 16px; }
    .tc-q { font-size: 18px; line-height: 1.36; }
    .tc-opt { padding: 12px 12px 12px 14px; gap: 12px; }
    .tc-opt .tc-kbd { display: none; }
    .tc-opt { grid-template-columns: 22px minmax(0, 1fr) auto; }
    .tc-card .think-conf .seg { width: 100%; grid-template-columns: repeat(6, 1fr); }
    .tc-card .think-conf .seg button { padding: 0; }
    .tc-foot .hint { display: none; }
    .tc-foot .btn { flex: 1; height: 44px; font-size: 16px; }
    .tc-foot .lead { flex-basis: 100%; }
    .tc-composer { bottom: calc(var(--tc-bottom) + 10px); margin-top: 28px; }
    /* phone: the toolbar clears the notch; past phases shrink to their check mark so Back stays visible */
    .tc-toolbar { height: calc(52px + env(safe-area-inset-top)); padding-top: env(safe-area-inset-top);
      padding-left: max(8px, env(safe-area-inset-left)); padding-right: max(8px, env(safe-area-inset-right)); }
    .tc-phases { min-width: 0; overflow: hidden; }
    .tc-phases span { padding: 0 7px; }
    .tc-phases span.tc-past { font-size: 0; gap: 0; padding: 0 6px; }
    .tc-phases span.tc-past svg { width: 14px; height: 14px; }
    .tc-back { min-width: 44px; min-height: 44px; }
    .tc-main { padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
    /* composer: above the home bar, and above the on-screen keyboard (--kb, set in index.html) */
    .tc-composer { bottom: calc(var(--tc-bottom) + 10px + max(env(safe-area-inset-bottom), var(--kb, 0px))); }
    .tc-composer textarea { font-size: 16px; }
    .tc-composer textarea::placeholder { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tc-send, .tc-boardtog { width: 40px; height: 40px; }
    .tc-micwrap .tm-btn { width: 40px !important; height: 40px !important; }
    .tc-tool { padding: 8px 10px; }
    .tc-later-chip { min-height: 36px; }
    .tc-menu-item { height: 44px; font-size: 16px; }
    .tc-screen:not(.docked) .tc-inspector.open { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: 85vh;
      border-radius: var(--r-xl) var(--r-xl) 0 0; padding-bottom: env(safe-area-inset-bottom); animation: sheet-up .32s var(--spring); }
    .tc-capture { width: calc(100vw - 24px); }
  }

  /* ---------- save for later: selection toolbar, save popover, marks, the teacher's "later" chips ---------- */
  .tc-selbar { position: fixed; z-index: 45; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 12px;
    background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
    border: 1px solid var(--separator); box-shadow: var(--shadow-3); animation: pop-in .14s var(--spring); }
  .tc-selbar[hidden] { display: none; }
  .tc-selbar button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: none;
    font: 500 13px/1 var(--font); color: var(--label); cursor: pointer; white-space: nowrap; }
  .tc-selbar button:hover:not(:disabled) { background: var(--fill); }
  .tc-selbar button:disabled { opacity: .4; cursor: default; }
  .tc-selbar button svg { width: 16px; height: 16px; color: var(--label-2); }
  .tc-selbar button[data-a=learn] svg { color: var(--accent); }
  .tc-selbar .tc-kbd { min-width: 18px; height: 18px; font-size: 11px; }
  .tc-selbar .sep { width: 1px; height: 18px; background: var(--separator); flex: none; }
  .tc-selbar .short { display: none; }
  .tc-capture { position: fixed; z-index: 46; width: min(340px, calc(100vw - 24px)); display: flex; flex-direction: column; gap: 10px; padding: 14px;
    border-radius: var(--r-lg); background: var(--material-thick); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
    border: 1px solid var(--separator); box-shadow: var(--shadow-3); animation: pop-in .18s var(--spring); }
  .tc-cap-head { display: flex; align-items: center; gap: 8px; font: var(--headline); font-size: 15px; }
  .tc-cap-head svg { width: 17px; height: 17px; color: var(--accent); }
  .tc-capture input.field { font: var(--subhead); padding: 8px 10px; }
  .tc-cap-note { display: flex; align-items: flex-start; gap: 8px; font: var(--footnote); color: var(--label-2); min-height: 18px; }
  .tc-cap-note .activity { flex: none; margin-top: 2px; }
  .tc-cap-list { display: flex; align-items: center; gap: 10px; font: var(--subhead); color: var(--label-2); }
  .tc-cap-list select.field { flex: 1; min-width: 0; height: 32px; }
  .tc-cap-foot { display: flex; justify-content: flex-end; gap: 8px; }
  mark.tc-cap { background: none; color: inherit; text-decoration: underline 2px color-mix(in srgb, var(--accent) 55%, transparent); text-underline-offset: 3px; }
  .tc-inlearn { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding: 1px 7px 1px 5px; border: 0; border-radius: var(--r-pill); vertical-align: 1px;
    background: var(--accent-tint); color: var(--accent); font: 600 11px/16px var(--font); cursor: pointer; white-space: nowrap; }
  .tc-inlearn svg { width: 12px; height: 12px; }
  .tc-later { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .tc-later-chip { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 5px 12px 5px 10px; border-radius: var(--r-pill); text-align: left;
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent); background: none; color: var(--accent); font: 500 13px/1.3 var(--font); cursor: pointer; }
  .tc-later-chip:hover:not(:disabled) { background: var(--accent-tint); }
  .tc-later-chip svg { width: 15px; height: 15px; flex: none; }
  .tc-later-chip.saved { border-style: solid; border-color: transparent; background: color-mix(in srgb, var(--green) 14%, transparent);
    color: color-mix(in srgb, var(--green) 80%, var(--label)); }
  .tc-later-chip:disabled { opacity: .6; cursor: default; }
  .tc-toastlink { margin-left: 12px; padding: 0; border: 0; background: none; color: var(--accent); font: 600 15px/1 var(--font); cursor: pointer; }
  @media (max-width: 560px) {
    .tc-selbar .long { display: none; }
    .tc-selbar .short { display: inline; }
    .tc-selbar .tc-kbd { display: none; }
    .tc-selbar button { height: 36px; }
  }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const esc = Q.esc;
  const icon = (n) => (Q.icon ? Q.icon(n) : '');
  const ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>';
  // Quiz.md handles paragraphs, lists and code; fold headings into bold lines and drop quote markers.
  const md = (s) => Q.md(String(s || '').replace(/^#{1,6}\s+(.*)$/gm, '**$1**').replace(/^>\s?/gm, ''));
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const CMD_ENTER = isMac ? '⌘↩' : 'Ctrl ↩';
  const PHASES = { probe: 'Probe', plan: 'Plan', teach: 'Teach', done: 'Done' };
  // Recent-lessons badge per phase: [label, badge colour]
  const PHASE_BADGE = { probe: ['Probing', ''], plan: ['Plan ready', 'orange'], teach: ['Teaching', 'accent'], done: ['Done', 'green'] };
  const KIND = {
    ask: ['Question', ''], probe: ['Quick check', ''], predict: ['Your prediction', 'orange'],
    check: ['Check your understanding', 'accent'], plan: ['The plan', 'accent'], done: ['Lesson complete', 'green'],
    task: ['Lab task', 'green'],
  };
  const badge = (kind) => `<span class="badge ${KIND[kind][1]}">${KIND[kind][0]}</span>`;

  const T = {
    view: null,           // the session on screen (server view)
    poll: null, tick: null,
    active: null,         // the open card's controller { submit(), pick(i), count, reveal? }
    lastCount: 0,
    prefill: null,        // { gapId, topic, ... } from a 'quiz:teach' event
    notes: null,
    menu: null,           // open popover menu { el, close }
    modal: null,          // open modal { kind, close }
    insOpen: null,        // inspector shown (docked: remembered; sheet: false until asked)
  };

  // Apple-style relative time: today → time, yesterday, weekday within a week, else a short date.
  function when(t) {
    const d = new Date(t), now = new Date();
    if (isNaN(d)) return '';
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day(now) - day(d)) / 864e5);
    if (days <= 0) return (now - d) < 60e3 ? 'Just now' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }

  // ---------- think.js widgets (degrade without it) ----------
  const think = () => Q.think || null;

  // Dictation (think.js): a mic button right after the textarea. With a `slot`, its strip (button,
  // status text, level meter) moves into our own bar instead.
  function micFor(ta, hint, slot) {
    if (!think()) return null;
    try { think().mic(ta, { hint }); } catch { return null; }
    const m = ta._thinkMic;
    const wrap = m && m.btn && m.btn.parentElement;
    if (!wrap) return null;
    if (slot) { wrap.classList.add('tc-micwrap'); slot.appendChild(wrap); }
    return wrap;
  }
  function thinkField(container, opts) {
    if (think()) {
      return think().field(container, opts);
    }
    const d = el(`<details class="think-field"><summary>${esc(opts.label)}</summary><textarea placeholder="${esc(opts.placeholder || '')}"></textarea></details>`);
    d.open = !!opts.open;
    container.appendChild(d);
    const ta = d.querySelector('textarea');
    return { el: d, get value() { return ta.value.trim(); }, set value(v) { ta.value = v || ''; } };
  }
  function confidence(container) {
    if (think()) return think().confidence(container, {});
    return { value: null };
  }
  // A textarea that grows with its text (the goal field and the composer).
  function autoGrow(ta, max) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, max) + 'px'; };
    ta.addEventListener('input', fit);
    return fit;
  }

  // ---------- menus + modals ----------

  function closeMenu() { if (T.menu) { T.menu.close(); T.menu = null; } }
  // Popover menu anchored under a button. items: [{ label, icon, run, danger, disabled } | '-']
  function menu(anchor, items) {
    const again = T.menu && T.menu.anchor === anchor;
    closeMenu();
    if (again) return;   // a second click on the same button closes it
    const m = el('<div class="popover tc-menu" role="menu"></div>');
    for (const it of items) {
      if (it === '-') { m.appendChild(el('<div class="tc-menu-sep"></div>')); continue; }
      const b = el(`<button type="button" role="menuitem" class="tc-menu-item${it.danger ? ' danger' : ''}"${it.id ? ` id="${it.id}"` : ''}${it.disabled ? ' disabled' : ''}>${icon(it.icon)}<span>${esc(it.label)}</span></button>`);
      b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.run(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth;
    m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    const outside = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    T.menu = { anchor, close() { m.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); } };
    const first = m.querySelector('button:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }

  function closeModal() { if (T.modal) { const m = T.modal; T.modal = null; m.close(); } }
  // A centred sheet (bottom sheet on phones). Returns the panel element.
  function modal(kind, html, cls = '') {
    closeModal();
    const s = el(`<div class="scrim tc-scrim"><div class="tc-modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`);
    document.body.appendChild(s);
    s.addEventListener('pointerdown', (e) => { if (e.target === s) closeModal(); });
    T.modal = { kind, close() { s.remove(); } };
    return s.firstElementChild;
  }
  // Apple alert: title, message, Cancel + one action.
  function confirmAlert({ title, message, action, destructive }) {
    return new Promise((resolve) => {
      closeModal();
      const s = el(`<div class="scrim tc-scrim"><div class="alert" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(message)}</p>
        <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn ${destructive ? 'btn-danger' : 'btn-primary'}" data-a="yes">${esc(action)}</button></div></div></div>`);
      document.body.appendChild(s);
      const done = (v) => { if (T.modal && T.modal.el === s) T.modal = null; s.remove(); resolve(v); };
      T.modal = { kind: 'alert', el: s, close: () => done(false) };
      s.querySelector('[data-a=no]').onclick = () => done(false);
      s.querySelector('[data-a=yes]').onclick = () => done(true);
      s.querySelector('[data-a=yes]').focus();
    });
  }

  // ---------- start screen ----------

  async function renderPanel() {
    const box = Q.$('tab-teach');
    if (!box) return;
    if (!box.querySelector('.tc-setup')) {
      box.innerHTML = `<div class="tc-setup">
        <div class="tc-compose">
          <textarea id="tcGoal" rows="2" placeholder="What do you want to understand?" aria-label="What do you want to understand?"></textarea>
          <div class="tc-compose-bar">
            <label class="tc-pop" title="Base the lesson on one of your study notes">${icon('note')}<select id="tcNote" class="field" aria-label="Based on a note"><option value="">Based on a note</option></select></label>
            <label class="tc-pop" title="Subject">${icon('book')}<select id="tcSubject" class="field" aria-label="Subject"><option value="">Any subject</option></select></label>
            <button class="btn tc-attach" id="tcAttach" type="button" title="Attach pages from your materials (or drop / paste a file)">${icon('paperclip')}Add material</button>
            <span class="spacer"></span>
            <span class="tc-mic-slot"></span>
            <button class="btn btn-primary tc-start" id="tcStart" title="Start lesson (${CMD_ENTER})">Start lesson <span class="tc-kbd">${CMD_ENTER}</span></button>
          </div>
        </div>
        <div id="tcSource"></div>
        <div class="tc-banner hidden" id="tcNoAi">${icon('warning')}<div class="grow"><div class="t">The AI isn't available</div><span id="tcNoAiWhy">Teach mode runs on the AI engine chosen in Settings → AI, and it can't start on the computer that serves this app.</span> <a href="#" id="tcNoAiFix">Open Settings → AI</a></div></div>
        <ol class="tc-how">
          <li><span class="tc-ic">${icon('target')}</span><b>Find where you are</b><span>A few quick questions show what you already know and where it stops.</span></li>
          <li><span class="tc-ic">${icon('map')}</span><b>Agree on a plan</b><span>A short path from what you know to your goal. Change it if you like.</span></li>
          <li><span class="tc-ic">${icon('thought')}</span><b>Learn step by step</b><span>Predict, read, then check. Thinking out loud steers the teacher.</span></li>
        </ol>
        <section id="tcMats"></section>
        <section class="tc-labs" id="tcLabs"></section>
        <section class="tc-lessons">
          <div class="list-header">In progress</div>
          <div class="list tc-list" id="tcList"><div class="tc-msg"><span class="activity"></span></div></div>
        </section>
        <section class="tc-lessons hidden" id="tcDoneSec">
          <div class="list-header">Recently finished</div>
          <div class="list tc-list" id="tcDoneList"></div>
        </section>
      </div>`;
      const goal = Q.$('tcGoal');
      micFor(goal, 'Teach me', box.querySelector('.tc-mic-slot'));
      autoGrow(goal, 240);
      Q.$('tcStart').onclick = () => start();
      Q.$('tcSubject').onchange = () => fillNotes();
      Q.$('tcNote').onchange = () => syncPop();
      Q.$('tcAttach').onclick = () => attachStart();
      goal.addEventListener('paste', (e) => { const f = Q.materials && Q.materials.pastedFiles(e); if (f && f.length) { e.preventDefault(); attachStart(f); } });
      if (Q.materials) Q.materials.dropZone(box.querySelector('.tc-compose'), (f) => attachStart([...f]));
      Q.$('tcAttach').hidden = !Q.materials;
      goal.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); start(); } });
    }
    try {
      if (!T.notes) T.notes = await Q.api('api/teach/notes');
      const sel = Q.$('tcSubject');
      if (sel.options.length <= 1) {
        sel.innerHTML = '<option value="">Any subject</option>' + T.notes.subjects.map((s) => `<option>${esc(s)}</option>`).join('');
        sel.value = localStorage.getItem('teach.subject') || '';
        fillNotes();
      }
    } catch {}
    renderSource();
    loadList();
    loadLabs();
    if (Q.materials) Q.materials.library(Q.$('tcMats'), { onUse: (a) => { addStartMat(a); Q.$('tcGoal').focus(); scrollTo({ top: 0, behavior: 'smooth' }); } });
  }

  // Materials attached to the lesson about to start (T.startMats).
  async function attachStart(files) {
    if (!Q.materials) return;
    const a = await Q.materials.pick({ goal: Q.$('tcGoal').value, subject: Q.$('tcSubject').value, files });
    if (a) addStartMat(a);
    if (files && Q.$('tcMats')) Q.materials.library(Q.$('tcMats'), { onUse: (x) => addStartMat(x) });
  }
  function addStartMat(a) {
    T.startMats = (T.startMats || []).filter((x) => !(x.id === a.id && x.pages === a.pages)).concat(a).slice(-4);
    renderSource();
  }
  const matRef = (a) => ({ id: a.id, pages: a.pages, role: a.role });
  // A goal when he only attached pages: what the role implies.
  function matGoal(list) {
    const a = list[0];
    const what = `${a.range ? `pages ${a.range} of ` : ''}“${a.title}”`;
    return a.role === 'practice' ? `Get me ready for the practice from ${what}` : a.role === 'reference' ? `Teach me from ${what}` : `Teach me what ${what} cover${a.range ? '' : 's'}`;
  }

  // The pickers read as quiet pills until set; a chosen value reads in the label colour.
  function syncPop() {
    for (const id of ['tcNote', 'tcSubject']) { const s = Q.$(id); if (s) s.style.color = s.value ? 'var(--label)' : 'var(--label-2)'; }
  }

  function fillNotes(selected) {
    const subj = Q.$('tcSubject').value;
    localStorage.setItem('teach.subject', subj);
    const notes = (T.notes ? T.notes.notes : []).filter((n) => !subj || n.subject === subj);
    Q.$('tcNote').innerHTML = '<option value="">Based on a note</option>' + notes.map((n) =>
      `<option value="${esc(n.title)}" data-subject="${esc(n.subject)}">${esc(subj ? n.title : `${n.subject}: ${n.title}`)}</option>`).join('');
    if (selected) Q.$('tcNote').value = selected;
    syncPop();
  }

  function renderSource() {
    const box = Q.$('tcSource');
    if (!box) return;
    const p = T.prefill;
    box.innerHTML = '';
    if (p && (p.gapId || p.topic)) {
      const t = el(`<span class="tc-token">${icon(p.gapId ? 'flag' : 'map')}${p.gapId ? 'From a Study next gap' : `Topic: ${esc(p.topic)}`}<button class="icon-btn" type="button" aria-label="Remove">${icon('close')}</button></span>`);
      t.querySelector('button').onclick = () => { T.prefill = null; renderSource(); };
      box.appendChild(t);
    }
    for (const a of T.startMats || []) {
      const c = el(Q.materials.chip(a, { removable: true }));
      c.querySelector('button').onclick = () => { T.startMats = T.startMats.filter((x) => x !== a); renderSource(); };
      box.appendChild(c);
    }
    const g = Q.$('tcGoal');
    if (g) g.placeholder = (T.startMats || []).length ? `${matGoal(T.startMats)} (or say what to focus on)` : 'What do you want to understand?';
  }

  async function loadList() {
    const box = Q.$('tcList');
    if (!box) return;
    try {
      const { sessions, available, why } = await Q.api('api/teach/sessions');
      Q.$('tcNoAi').classList.toggle('hidden', available);
      if (!available && why) Q.$('tcNoAiWhy').textContent = `${why}.`;
      Q.$('tcNoAiFix').onclick = (e) => { e.preventDefault(); if (Q.settings) Q.settings.open('ai'); };
      Q.$('tcStart').disabled = !available;
      box.innerHTML = '';
      if (!sessions.length) {
        box.innerHTML = `<div class="tc-empty"><div class="tc-ic">${icon('teach')}</div><h3>No lessons yet</h3>
          <p>Ask about anything you're studying. Lessons you start show up here, so you can pick one up where you left off.</p>
          <button class="btn btn-tinted" type="button">${icon('sparkles')}Try an example</button></div>`;
        box.querySelector('button').onclick = () => {
          const g = Q.$('tcGoal');
          g.value = 'Why does a zombie process exist, and why can’t kill -9 remove it?';
          g.dispatchEvent(new Event('input')); g.focus();
        };
        return;
      }
      // Two lists, newest first: lessons still going, then finished or ended ones.
      const finished = (s) => s.phase === 'done' || s.status === 'closed';
      const doneBox = Q.$('tcDoneList');
      const done = sessions.filter(finished);
      const going = sessions.filter((s) => !finished(s));
      Q.$('tcDoneSec').classList.toggle('hidden', !done.length);
      doneBox.innerHTML = '';
      if (!going.length) box.innerHTML = '<div class="tc-msg">Nothing in progress. Start a lesson above.</div>';
      for (const s of sessions) {
        const target = finished(s) ? doneBox : box;
        const [label, color] = s.status === 'closed' && s.phase !== 'done' ? ['Ended', ''] : PHASE_BADGE[s.phase] || [PHASES[s.phase] || s.phase, ''];
        const src = s.source && s.source.title ? `From “${esc(s.source.title)}”` : (s.materials || []).length ? `From ${esc(s.materials[0])}${s.materials.length > 1 ? ` +${s.materials.length - 1}` : ''}` : '';
        const meta = [s.subject ? esc(s.subject) : '', src].filter(Boolean).join(' · ');
        const row = el(`<div class="list-row tc-lrow" role="button" tabindex="0" data-id="${esc(s.id)}">
          <div class="grow"><div class="tc-lt">${esc(s.goal)}</div>
            <div class="tc-lm">${s.busy ? '<span class="activity" title="The teacher is working"></span>' : ''}<span class="badge ${color}">${esc(label)}</span>${meta ? `<span class="src">${meta}</span>` : ''}</div></div>
          <span class="when">${esc(when(s.updated))}</span>
          <button class="icon-btn tc-more" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false">${icon('ellipsis')}</button>
          <svg class="chevron" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5-5 5"/></svg>
        </div>`);
        row.onclick = (e) => { if (!e.target.closest('.tc-more')) openSession(s.id); };
        row.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openSession(s.id); } };
        const more = row.querySelector('.tc-more');
        more.onclick = (e) => {
          e.stopPropagation();
          menu(more, [
            { label: 'Open lesson', icon: 'play', run: () => openSession(s.id) },
            '-',
            { label: 'Delete…', icon: 'trash', danger: true, disabled: s.busy, run: () => remove(s) },
          ]);
        };
        target.appendChild(row);
      }
    } catch (e) { box.innerHTML = `<div class="tc-msg">Couldn't load your lessons: ${esc(e.message)}</div>`; }
  }

  async function remove(s) {
    const ok = await confirmAlert({ title: 'Delete this lesson?', message: `“${s.goal}” and its transcript will be deleted. This can't be undone.`, action: 'Delete', destructive: true });
    if (!ok) return;
    try { await Q.api(`api/teach/${s.id}/delete`, {}); loadList(); } catch (e) { Q.showToast(e.message); }
  }

  async function start(detail) {
    const mats = detail ? [] : T.startMats || [];
    const goal = detail ? detail.goal : Q.$('tcGoal').value.trim() || (mats.length ? matGoal(mats) : '');
    if (!goal) { Q.$('tcGoal').focus(); Q.showToast('Write what you want to understand first'); return; }
    let body;
    if (detail) body = { goal, subject: detail.subject || null, noteTitle: detail.noteTitle || null, gapId: detail.gapId || null, topic: detail.topic || null,
      labFile: detail.labFile || null, labTask: detail.labTask || null, toLearn: detail.toLearn || null };
    else {
      const opt = Q.$('tcNote').selectedOptions[0];
      body = { goal, subject: Q.$('tcSubject').value || (opt && opt.dataset.subject) || null, noteTitle: Q.$('tcNote').value || null,
        gapId: T.prefill && T.prefill.gapId || null, topic: T.prefill && T.prefill.topic || null };
      if (T.prefill && !body.subject) body.subject = T.prefill.subject || null;
      if (T.prefill && !body.noteTitle) body.noteTitle = T.prefill.noteTitle || null;
      if (mats.length) body.materials = mats.map(matRef);
    }
    const btn = Q.$('tcStart');
    if (btn) btn.disabled = true;
    try {
      const v = await Q.api('api/teach/start', body);
      if (Q.$('tcGoal')) Q.$('tcGoal').value = '';
      T.prefill = null;
      if (!detail) T.startMats = [];
      showScreen(v);
    } catch (e) { Q.showToast(e.message); }
    finally { if (btn) btn.disabled = false; }
  }

  // ---------- lesson screen ----------

  // The open lesson lives in the URL (?lesson=<id>): a link to it can be shared or bookmarked,
  // and the browser's back/forward buttons move between a lesson and the Lessons list.
  const urlLesson = () => new URLSearchParams(location.search).get('lesson');
  function setUrl(id, replace) {
    if ((urlLesson() || null) === (id || null)) return;
    const params = new URLSearchParams(location.search);
    if (id) params.set('lesson', id); else params.delete('lesson');
    const q = params.toString();
    history[replace ? 'replaceState' : 'pushState']({ lesson: id || null }, '', location.pathname + (q ? `?${q}` : ''));
  }
  window.addEventListener('popstate', () => {
    const id = urlLesson();
    if (id) { if (!T.view || T.view.id !== id) { Q.setTab('teach'); openSession(id); } }
    else if (document.body.classList.contains('teach-on')) back();
  });

  async function openSession(id) {
    try { showScreen(await Q.api(`api/teach/${id}`)); }
    catch (e) { Q.showToast(e.message); localStorage.removeItem('teach.open'); setUrl(null, true); }
  }

  let ro = null, io = null;
  function showScreen(v) {
    closeMenu(); closeModal();
    const scr = Q.enterScreen();
    document.body.classList.add('teach-on');
    localStorage.setItem('teach.open', v.id);
    setUrl(v.id);
    T.view = null; T.lastCount = 0; T.sig = null;
    scr.innerHTML = `<div class="tc-screen">
      <div class="tc-toolbar">
        <div class="lead"><button class="btn btn-plain tc-back" id="tcBack" type="button">${icon('chevron-left')}<span>Lessons</span></button><div class="tc-tb-title"></div></div>
        <div class="tc-phases" role="list" aria-label="Lesson progress"></div>
        <div class="tc-tb-actions">
          <button class="icon-btn hidden" id="tcTermBtn" type="button" aria-label="Lab terminal" title="Lab terminal" aria-pressed="false">${icon('terminal')}</button>
          <button class="icon-btn" id="tcMapBtn" type="button" aria-label="Show the plan" title="Plan map">${icon('map')}</button>
          <button class="icon-btn" id="tcMore" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false">${icon('ellipsis')}</button>
        </div>
      </div>
      <div class="tc-body">
        <div class="tc-main"><div class="tc-read">
          <header class="tc-head"><h1 class="tc-goal"></h1><div class="sub"></div></header>
          <div class="tc-stream"></div>
          <div class="tc-status"></div>
          <div class="tc-autosave" id="tcAutoSave" hidden></div>
          <div class="tc-matchips" id="tcMatChips" hidden></div>
          <div class="tc-composer">
            <div class="tc-drawchip" id="tcDrawChip" role="status" hidden>${icon('pencil')}<span>Your drawing on the board will be sent</span><button type="button" aria-label="Don't send the drawing" title="Don't send the drawing">${icon('close')}</button></div>
            <button class="tc-clip" id="tcClip" type="button" aria-label="Attach material" title="Attach pages from your materials (or drop / paste a file)">${icon('paperclip')}</button>
            <textarea id="tcAsk" rows="1" placeholder="Ask the teacher anything" aria-label="Ask the teacher anything"></textarea>
            <button class="tc-boardtog" id="tcBoardTog" type="button" aria-pressed="false" aria-label="Answer on the board" title="Ask for the answer on the board, narrated">${icon('board')}</button>
            <button class="tc-hf" id="tcHandsFree" type="button" aria-pressed="false" aria-label="Hands-free" title="Hands-free: just talk, and the teacher stops to listen (best with headphones)">${icon('headphones')}</button>
            <span class="tc-mic-slot"></span>
            <button class="tc-send" id="tcAskSend" type="button" aria-label="Send" title="Send (${CMD_ENTER})" disabled>${ARROW_UP}</button>
          </div>
        </div></div>
        <aside class="tc-inspector" id="tcInspector" aria-label="Plan">
          <div class="tc-ins-head"><h2>Plan</h2><button class="icon-btn" type="button" aria-label="Close">${icon('close')}</button></div>
          <div class="tc-ins-body">
            <section class="tc-ins-sec hidden" id="tcLabBox"><h3>Lab steps</h3><ol class="tc-steps tc-steps-lab" id="tcLabSteps"></ol></section>
            <section class="tc-ins-sec"><div class="tc-map"></div></section>
            <section class="tc-ins-sec hidden" id="tcAssessBox"><h3>Where you started</h3><div class="tc-assess"></div></section>
            <section class="tc-ins-sec hidden" id="tcSavedBox"><h3>Saved to your vault</h3><div class="tc-saved" id="tcSaved"></div></section>
          </div>
        </aside>
        <aside class="tc-termcol" id="tcTermCol" aria-label="Lab terminal"></aside>
      </div>
    </div>`;
    const screen = scr.querySelector('.tc-screen');
    scr.querySelector('#tcBack').onclick = back;
    const ask = Q.$('tcAsk');
    micFor(ask, v.goal, scr.querySelector('.tc-composer .tc-mic-slot'));
    const fit = autoGrow(ask, 180);
    ask.addEventListener('input', () => { fit(); syncSend(); interruptLive(); stopAutoRead(); });   // typing interrupts a live answer / auto-read
    Q.$('tcAskSend').onclick = sendAsk;
    T.askMats = [];
    renderAskMats();
    Q.$('tcClip').hidden = !Q.materials;
    Q.$('tcClip').onclick = () => attachAsk();
    ask.addEventListener('paste', (e) => { const f = Q.materials && Q.materials.pastedFiles(e); if (f && f.length) { e.preventDefault(); attachAsk(f); } });
    if (Q.materials) Q.materials.dropZone(scr.querySelector('.tc-composer'), (f) => attachAsk([...f]));
    Q.$('tcDrawChip').querySelector('button').onclick = () => Q.board && Q.board.drawing && Q.board.drawing.dismiss();
    setBoardAsk(boardDefault());   // teacher.boards = 'always': on for every message
    T.readTurn = null;   // auto-read: the last teacher turn already heard (null: set from the first render)
    Q.$('tcBoardTog').onclick = () => setBoardAsk(!T.boardAsk);
    Q.$('tcHandsFree').onclick = () => Q.handsfree && Q.handsfree.toggle();
    Q.$('tcHandsFree').hidden = !Q.handsfree || !matchMedia('(hover: hover) and (pointer: fine)').matches;
    syncHandsFree();
    ask.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); sendAsk(); } });
    Q.$('tcMore').onclick = (e) => { e.stopPropagation(); lessonMenu(e.currentTarget); };
    Q.$('tcMapBtn').onclick = () => setInspector(!insShown());
    Q.$('tcTermBtn').onclick = () => (screen.classList.contains('term-open') ? closeTerm() : openTerm());
    screen.querySelector('.tc-ins-head .icon-btn').onclick = () => setInspector(false);

    // Docked inspector when the screen is wide enough, a sheet otherwise.
    if (ro) ro.disconnect();
    ro = new ResizeObserver(() => layout());
    ro.observe(screen);
    layout();
    // The toolbar title fades in once the large title scrolls under it.
    if (io) io.disconnect();
    io = new IntersectionObserver(([e]) => screen.querySelector('.tc-toolbar').classList.toggle('scrolled', !e.isIntersecting),
      { rootMargin: `-${60 + topOffset()}px 0px 0px 0px` });
    io.observe(screen.querySelector('.tc-head h1'));
    if (T.pane) { T.pane.dispose(); T.pane = null; }
    render(v);
    labSetup(v);
  }

  // Height of the app's own sticky bars (the phone top bar, the status bar at the bottom), so our
  // toolbar sticks under the one and the composer floats above the other.
  function barHeight(sel) {
    const b = document.querySelector(sel);
    if (!b) return 0;
    const cs = getComputedStyle(b);
    return cs.display !== 'none' && (cs.position === 'sticky' || cs.position === 'fixed') ? b.offsetHeight : 0;
  }
  const topOffset = () => barHeight('.topbar');
  function layout() {
    const screen = document.querySelector('.tc-screen');
    if (!screen) return;
    screen.style.setProperty('--tc-top', topOffset() + 'px');
    // The terminal: a column on the right when there's room, a bottom sheet otherwise.
    const termOpen = screen.classList.contains('term-open');
    const narrow = screen.offsetWidth < 980;
    screen.classList.toggle('narrow', narrow);
    const sb = barHeight('.statusbar'), sheet = termSheetH();
    screen.style.setProperty('--term-w', termColW(screen) + 'px');
    screen.style.setProperty('--tc-sb', sb + 'px');
    screen.style.setProperty('--tc-sheet', sheet + 'px');
    screen.style.setProperty('--tc-bottom', (sb + (termOpen && narrow ? sheet : 0)) + 'px');
    const docked = screen.offsetWidth >= 1100 && !termOpen;
    if (screen.classList.contains('docked') !== docked) {
      screen.classList.toggle('docked', docked);
      T.insOpen = docked ? localStorage.getItem('teach.inspector') !== 'off' : false;
    }
    paintInspector();
  }
  const insShown = () => !!T.insOpen;
  function setInspector(on) {
    const screen = document.querySelector('.tc-screen');
    if (!screen) return;
    T.insOpen = on;
    if (screen.classList.contains('docked')) localStorage.setItem('teach.inspector', on ? 'on' : 'off');
    paintInspector();
  }
  function paintInspector() {
    const screen = document.querySelector('.tc-screen');
    if (!screen) return;
    const docked = screen.classList.contains('docked');
    screen.classList.toggle('ins-open', !!T.insOpen);
    const ins = Q.$('tcInspector');
    ins.classList.toggle('open', !docked && !!T.insOpen);
    Q.$('tcMapBtn').setAttribute('aria-pressed', String(!!T.insOpen));
    let scrim = document.querySelector('.tc-ins-scrim');
    if (!docked && T.insOpen) {
      if (!scrim) { scrim = el('<div class="tc-ins-scrim"></div>'); scrim.onclick = () => setInspector(false); ins.before(scrim); }
    } else if (scrim) scrim.remove();
  }

  function lessonMenu(anchor) {
    const v = T.view;
    if (!v) return;
    menu(anchor, [
      { id: 'tcSave', label: v.savePreview ? 'Review save to vault…' : 'Save to vault…', icon: 'note', disabled: !!v.pending || !v.items.length, run: openSave },
      { label: 'Change the plan…', icon: 'map', disabled: !v.plan || !!v.pending, run: changePlan },
      { label: 'Rewrite last reply', icon: 'refresh', disabled: !!v.pending || !v.items.length || v.items[v.items.length - 1].type !== 'teacher' || v.items.filter((i) => i.type === 'teacher').length < 2,
        run: async () => { if (await confirmAlert({ title: 'Rewrite the last reply?', message: 'The teacher writes its last message again, for example when it skipped the explanation. The current one is replaced.', action: 'Rewrite' })) act('redo', {}); } },
      { label: insShown() ? 'Hide plan' : 'Show plan', icon: 'sidebar', run: () => setInspector(!insShown()) },
      '-',
      { id: 'tcEnd', label: 'End lesson', icon: 'stop', run: async () => { await act('close', {}); back(); } },
    ]);
  }

  function back() {
    stopPolling();
    hideSel(); closeCapture();
    if (T.live) { T.live.dispose(); T.live = null; }
    if (Q.board) Q.board.stopAll();
    if (T.pane) { T.pane.dispose(); T.pane = null; }
    closeMenu(); closeModal();
    if (ro) { ro.disconnect(); ro = null; }
    if (io) { io.disconnect(); io = null; }
    const scrim = document.querySelector('.tc-ins-scrim');
    if (scrim) scrim.remove();
    T.view = null; T.active = null;
    localStorage.removeItem('teach.open');
    setUrl(null);
    document.body.classList.remove('teach-on');
    Q.exitScreen();
    Q.setTab('teach');
  }

  function syncSend() {
    const ta = Q.$('tcAsk'), b = Q.$('tcAskSend');
    if (ta && b) b.disabled = ta.disabled || (!ta.value.trim() && !T.boardAsk && !(T.askMats || []).length);
  }
  // The composer's board toggle: the next question is answered on the board.
  function setBoardAsk(on) {
    T.boardAsk = !!on;
    const b = Q.$('tcBoardTog');
    if (b) b.setAttribute('aria-pressed', String(T.boardAsk));
    placeholder();
    syncSend();
  }
  function placeholder() {
    const ask = Q.$('tcAsk');
    if (!ask || !T.view) return;
    const space = matchMedia('(hover: hover) and (pointer: fine)').matches && Q.think && Q.think.available ? ' · hold Space to talk' : '';
    ask.placeholder = T.view.pending && !(T.view.pending.live && Q.live) ? 'The teacher is thinking…'
      : T.view.pending ? `Cut in: type, or hold Space and talk` : T.boardAsk ? 'What should the teacher draw? (empty: the last explanation)' : `Ask the teacher anything${space}`;
  }
  async function sendAsk(spoken) {
    const ta = Q.$('tcAsk');
    if (typeof spoken === 'string' && ta.value.trim()) spoken = `${ta.value.trim()} ${spoken}`;   // hands-free + something typed: both
    const mats = T.askMats || [];
    const text = (typeof spoken === 'string' ? spoken : ta.value).trim() || (T.boardAsk ? 'Explain your last explanation on the board.' : '')
      || (mats.length ? `I attached ${mats.map((a) => `${a.range ? `pages ${a.range} of ` : ''}“${a.title}” (${(Q.materials.ROLE_LABEL[a.role] || '').toLowerCase()})`).join(' and ')}.` : '');
    if (!text) { ta.focus(); return; }
    // teacher.boards 'auto': the teacher may answer on the live board by itself (teach.js turnJob).
    const body = T.boardAsk ? { text, board: true, ...(Q.live ? { live: true } : {}) } : { text, ...(Q.live && pref('teacher.boards') === 'auto' ? { autoBoard: true } : {}) };
    if (T.interrupted) body.interrupted = T.interrupted;
    if (mats.length) body.materials = mats.map(matRef);
    // Cut in while the teacher is still writing its live answer: the question goes as soon as that turn is stored.
    if (T.view && T.view.pending) {
      T.queued = body;
      ta.value = ''; ta.style.height = ''; setBoardAsk(boardDefault()); T.askMats = []; renderAskMats(); syncSend();
      renderQueued();
      return;
    }
    if (await act('message', body)) { ta.value = ''; ta.style.height = ''; setBoardAsk(boardDefault()); T.interrupted = null; T.askMats = []; renderAskMats(); }
  }
  // Materials attached to the next message (the paperclip, a dropped or pasted file).
  async function attachAsk(files) {
    if (!Q.materials || !T.view) return;
    const a = await Q.materials.pick({ goal: `${Q.$('tcAsk').value} ${T.view.goal}`, subject: T.view.subject || '', files });
    if (!a) return;
    T.askMats = (T.askMats || []).filter((x) => !(x.id === a.id && x.pages === a.pages)).concat(a).slice(-4);
    renderAskMats();
    Q.$('tcAsk').focus();
  }
  function renderAskMats() {
    const box = Q.$('tcMatChips');
    if (!box) return;
    box.innerHTML = '';
    for (const a of T.askMats || []) {
      const c = el(Q.materials.chip(a, { removable: true }));
      c.querySelector('button').onclick = () => { T.askMats = T.askMats.filter((x) => x !== a); renderAskMats(); };
      box.appendChild(c);
    }
    box.hidden = !(T.askMats || []).length;
    syncSend();
  }
  // A question waiting for the live turn to finish writing (sendAsk), shown above the composer.
  function renderQueued() {
    let chip = document.getElementById('tcQueued');
    if (!T.queued) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'tcQueued';
      chip.className = 'tc-queued';
      chip.setAttribute('role', 'status');
      const comp = document.querySelector('.tc-composer');
      if (comp) comp.parentNode.insertBefore(chip, comp);
    }
    chip.innerHTML = `<span class="activity"></span><span><b>Asked:</b> ${esc(T.queued.text)}<br><span class="secondary">Goes to the teacher the moment it finishes writing (a few seconds).</span></span>
      <button type="button" aria-label="Don't send" title="Don't send">${icon('close')}</button>`;
    chip.querySelector('button').onclick = () => {
      const ta = Q.$('tcAsk');
      if (ta && !ta.value.trim()) { ta.value = T.queued.text; ta.dispatchEvent(new Event('input')); }
      T.queued = null; renderQueued();
    };
  }
  function flushQueued(v) {
    if (!T.queued || v.pending) return;
    const body = T.queued;
    T.queued = null;
    renderQueued();
    act('message', body).then((ok) => { if (ok) T.interrupted = null; });
  }
  // Stop a live answer that's still talking, remembering how far he got (sent with his next message).
  function interruptLive() {
    if (!T.live || T.live.ended) return false;
    try { T.interrupted = T.live.heard(); } catch { T.interrupted = null; }
    T.live.stop();
    return true;
  }
  // Settings (Quiz.prefs, ui/prefs.js). Without it everything is at its default.
  const P = () => Q.prefs || window.QuizPrefs || null;
  const pref = (k) => (P() ? P().get(k) : undefined);
  // The composer's board toggle starts on for every message with teacher.boards = 'always'.
  const boardDefault = () => pref('teacher.boards') === 'always';
  window.addEventListener('quiz:prefs', (e) => {
    if (!((e.detail && e.detail.changed) || []).includes('teacher.boards')) return;
    const ta = Q.$('tcAsk');
    if (ta && !ta.value.trim()) setBoardAsk(boardDefault());   // not mid-question: he may have set it himself
  });

  // voice.autoRead: a new teacher reply is read aloud (always the free local voice), unless it came as a
  // board (a live board already speaks; a stored one has its own Play). Typing or sending stops it.
  function autoRead(v) {
    let last = null;
    for (const it of v.items) if (it.type === 'teacher') last = it;
    const n = last && typeof last.turn === 'number' ? last.turn : -1;
    if (T.readTurn == null || n <= T.readTurn) { if (T.readTurn == null || n > T.readTurn) T.readTurn = n; return; }   // first look at this lesson: nothing to read
    T.readTurn = n;
    if (!pref('voice.autoRead') || v.pending || T.live || last.board || !last.say || !Q.board || !Q.board.available) return;
    const btn = document.querySelector(`.tc-stream .tc-tool[data-read="${n}"]`);
    if (!btn) return;   // too short to have a Read aloud button
    T.autoReadBtn = btn;
    Q.board.readAloud(last.say, btn, { free: true });
  }
  function stopAutoRead() {
    const b = T.autoReadBtn;
    T.autoReadBtn = null;
    if (b && b.isConnected && b.getAttribute('aria-pressed') === 'true' && Q.board) Q.board.readAloud('', b);   // same button again = stop
  }

  // He started talking: stop reading the reply aloud.
  window.addEventListener('quiz:mic', () => stopAutoRead());
  // Dictation that stopped by itself after a silence (ui/think.js, mic.autoSendSec): send it.
  window.addEventListener('quiz:dictated', (e) => {
    const d = e.detail || {};
    const ta = Q.$('tcAsk');
    if (!(d.auto || d.via === 'hold') || !ta || d.target !== ta || ta.disabled) return;
    if (!ta.value.trim()) return;   // nothing was heard: never send an empty (or board-only) question
    sendAsk();
  });
  // ---------- hands-free (ui/handsfree.js) ----------
  // What it needs from the lesson: stop the teacher, send what he said, is the teacher talking, the
  // Whisper hint, and what the teacher said last (to spot its own voice leaking into the mic).
  Q.teachTalk = {
    interrupt() { interruptLive(); if (Q.board && Q.board.stopAll) Q.board.stopAll(); stopAutoRead(); },
    send(text) { if (T.view) sendAsk(text); },
    speaking() {
      return !!((T.live && !T.live.ended) || (T.autoReadBtn && T.autoReadBtn.isConnected && T.autoReadBtn.getAttribute('aria-pressed') === 'true'));
    },
    hint() { return (T.view && T.view.goal) || ''; },
    said() {
      if (T.live && !T.live.ended) { try { return T.live.heard().heard.slice(-600); } catch {} }
      const items = (T.view && T.view.items) || [];
      for (let i = items.length - 1; i >= 0; i--) if (items[i].type === 'teacher') return String(items[i].text || items[i].say || '').slice(-600);
      return '';
    },
  };
  function syncHandsFree() {
    const b = Q.$('tcHandsFree');
    const hf = Q.handsfree;
    const on = !!(hf && hf.on);
    if (b) { b.setAttribute('aria-pressed', on); b.classList.toggle('on', on); }
    let pill = document.getElementById('tcHfPill');
    if (!on) { if (pill) pill.remove(); return; }
    if (!pill) {
      const comp = document.querySelector('.tc-composer');
      if (!comp) return;
      pill = document.createElement('div');
      pill.id = 'tcHfPill';
      pill.className = 'tc-hf-pill';
      pill.setAttribute('role', 'status');
      comp.appendChild(pill);
    }
    const s = hf.state;
    pill.dataset.state = s;
    pill.innerHTML = `<i style="--lv:${Math.min(1, hf.level * 12).toFixed(2)}"></i>${s === 'hearing' ? 'Hearing you… pause to send' : s === 'transcribing' ? 'Sending what you said…' : 'Hands-free · just talk'}`;
  }
  if (Q.handsfree) Q.handsfree.subscribe(syncHandsFree);

  // ---------- hold Space to talk (computer) ----------
  // In a lesson, outside a text field: Space down stops the teacher (a live answer, a board, reading aloud)
  // and records into the composer; Space up transcribes and sends (queued if the teacher is still writing).
  let hold = null;
  const typing = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
    || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|range)$/i.test(el.type || '')));
  function holdOn() {
    const ta = Q.$('tcAsk');
    const m = ta && ta._thinkMic;
    if (!m || m.state === 'busy' || m.starting || !(Q.think && Q.think.available)) {
      if (Q.think && !Q.think.available) Q.showToast('Dictation isn’t set up on the server (Settings → Mic).');
      return null;
    }
    interruptLive();
    if (Q.board && Q.board.stopAll) Q.board.stopAll();
    stopAutoRead();
    if (ta.disabled) return null;
    document.body.classList.add('tc-holding');
    const h = { m, released: false };
    h.p = Promise.resolve(m.state === 'recording' ? null : m.toggle('hold')).finally(() => {
      if (h.released && m.state === 'recording') m.toggle();   // let go while the mic was still opening
    });
    return h;
  }
  function holdOff(h) {
    if (!h || h.released) return;
    h.released = true;
    document.body.classList.remove('tc-holding');
    if (h.m.state === 'recording') h.m.toggle();
  }
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !document.body.classList.contains('teach-on')) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(document.activeElement)) return;
    if (document.querySelector('.tc-scrim, dialog[open]')) return;
    e.preventDefault();               // not a page scroll, not a click on the focused button
    if (e.repeat || hold) return;
    hold = holdOn();
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !hold) return;
    e.preventDefault();
    const h = hold; hold = null;
    holdOff(h);
  }, true);
  window.addEventListener('blur', () => { if (hold) { const h = hold; hold = null; holdOff(h); } });

  // "Explain on the board" under a reply: the teacher redraws that reply.
  function boardFor(turn) { act('message', { text: 'Explain this on the board.', board: true, about: turn, ...(Q.live ? { live: true } : {}) }); }

  // A live board answer (ui/live.js): the teacher talks and draws while the turn is still running.
  // It starts when the view says the pending turn is live, sits at the end of the stream until the turn
  // is stored (then inside that turn, cards below it), and gives way to the normal player when it ends.
  function syncLive(v) {
    if (!Q.live || T.live || !v.pending || !v.pending.live || T.liveSeen === v.pending.since) return;
    T.liveSeen = v.pending.since;
    if (Q.board) Q.board.stopAll();
    const id = v.id;
    const lv = Q.live.start(id, {
      onDone: async () => { try { if (T.view && T.view.id === id) render(await Q.api(`api/teach/${id}`)); } catch {} },
      onEnd: () => {
        if (T.live !== lv) return;
        T.live = null;
        T.sig = null;
        if (T.view && T.view.id === id) render(T.view);
      },
    });
    T.live = lv;
    const box = document.querySelector('.tc-stream');
    if (box) { box.appendChild(lv.el); lv.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    renderStatus(v);
  }

  function changePlan() {
    const p = modal('plan', `<div class="tc-modal-head"><h2>Change the plan</h2><p>Say what should change. The teacher redraws the map and carries on from there.</p></div>
      <div class="tc-modal-body"><textarea class="field" id="tcPlanText" placeholder="e.g. Skip the basics of fork(), I know them"></textarea></div>
      <div class="tc-modal-foot"><span class="spacer"></span><button class="btn" data-a="cancel">Cancel</button><button class="btn btn-primary" id="tcPlanSend">Send change</button></div>`, 'small');
    const ta = p.querySelector('textarea');
    micFor(ta, T.view && T.view.goal);
    ta.focus();
    const send = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      p.querySelector('#tcPlanSend').disabled = true;
      if (await act('plan', { text })) closeModal(); else p.querySelector('#tcPlanSend').disabled = false;
    };
    p.querySelector('#tcPlanSend').onclick = send;
    p.querySelector('[data-a=cancel]').onclick = closeModal;
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); send(); } });
  }

  // His drawing on a board (Excalidraw canvas) that hasn't been sent yet: the chip above the composer.
  function syncDrawChip() {
    const chip = Q.$('tcDrawChip');
    if (!chip) return;
    const pd = Q.board && Q.board.drawing && Q.board.drawing.pending();
    chip.hidden = !pd;
    if (pd) chip.querySelector('span').textContent = `Your drawing on “${pd.title}” will be sent`;
  }
  if (Q.board && Q.board.drawing) Q.board.drawing.onChange(syncDrawChip);

  // POST an action, show the pending state, poll until the teacher's turn is done.
  // A message or a card answer carries his unsent drawing: the scene as JSON, plus a PNG for freehand strokes.
  async function act(action, body) {
    if (!T.view) return false;
    stopAutoRead();
    let drew = null;
    if ((action === 'message' || action === 'answer') && Q.board && Q.board.drawing && Q.board.drawing.pending()) {
      try { drew = await Q.board.drawing.collect(); } catch (e) { console.warn('[teach] drawing not attached:', e); }
      if (drew) body = { ...body, drawing: { scene: drew.scene, ...(drew.png ? { png: drew.png } : {}) } };
    }
    try {
      const v = await Q.api(`api/teach/${T.view.id}/${action}`, body);
      if (drew) Q.board.drawing.sent(drew);
      render(v);
      if (v.result && !(v.autoSave && v.autoSave.state === 'saved' && !v.autoSave.dismissed)) showSaveResult(v.result);   // else the banner says it
      return true;
    } catch (e) { Q.showToast(e.message); return false; }
  }

  function stopPolling() { clearTimeout(T.poll); clearInterval(T.tick); T.poll = T.tick = null; }
  function schedulePoll() {
    clearTimeout(T.poll);
    T.poll = setTimeout(async () => {
      if (!T.view) return;
      try { render(await Q.api(`api/teach/${T.view.id}`)); }
      catch { schedulePoll(); }
    }, 1500);
  }

  function render(v) {
    if (!document.querySelector('.tc-screen')) return;
    const prev = T.view;
    T.view = v;
    document.querySelector('.tc-goal').textContent = v.goal;
    document.querySelector('.tc-tb-title').textContent = v.goal;
    const sub = [];
    if (v.subject) sub.push(`<span>${icon('book')}${esc(v.subject)}</span>`);
    if (v.source && v.source.title) sub.push(`<span>${icon('note')}Based on “${esc(v.source.title)}”</span>`);
    else if (v.source && v.source.topic) sub.push(`<span>${icon('map')}${esc(v.source.topic)}</span>`);
    for (const a of v.materials || []) if (Q.materials) sub.push(`<a class="tc-mat" href="${esc(Q.materials.openUrl(a))}" target="_blank" rel="noopener" title="${esc(Q.materials.ROLE_LABEL[a.role] || '')}: open it">${icon(a.kind === 'images' ? 'photo' : 'paperclip')}${esc(a.title)}${a.range ? ` · p. ${esc(a.range)}` : ''}</a>`);
    document.querySelector('.tc-head .sub').innerHTML = sub.join('');
    renderPhases(v);

    // Re-render the stream only when something changed (keeps typed text in the open card).
    const sig = JSON.stringify([v.items.length, v.openCardId, !!v.pending, v.items.map((i) => i.card && i.card.answer ? 1 : 0), v.autoSave ? [v.autoSave.state, !!v.autoSave.dismissed] : 0]);
    const prevSig = prev && prev.id === v.id ? T.sig : null;
    if (sig !== prevSig) { T.sig = sig; renderStream(v); }
    renderStatus(v);
    renderMap(v);
    renderAssessment(v);
    renderSave(v);
    renderAutoSave(v);
    renderLab(v);
    const ask = Q.$('tcAsk');
    // A live answer still being written: he can cut in (Space, typing); the question is queued (sendAsk).
    ask.disabled = !!v.pending && !(v.pending.live && Q.live);
    Q.$('tcBoardTog').disabled = !!v.pending;
    placeholder();
    syncSend();
    const savedBox = Q.$('tcSavedBox');
    savedBox.classList.toggle('hidden', !(v.saved || []).length);
    Q.$('tcSaved').innerHTML = (v.saved || []).map((r) => [...r.written, ...r.appended.map((f) => f + ' (added to)')]
      .map((f) => `<div>${icon('check-circle')}<span>${esc(f)}</span></div>`).join('') +
      (r.skipped.length ? `<div class="secondary">${icon('info')}<span>Skipped ${r.skipped.map((x) => esc(x.file)).join(', ')}</span></div>` : '')).join('');
    syncLive(v);
    autoRead(v);
    flushQueued(v);
    if (v.pending || (v.autoSave && v.autoSave.state === 'preparing')) schedulePoll(); else stopPolling();
  }

  function renderPhases(v) {
    const order = ['probe', 'plan', 'teach'];
    const pi = v.phase === 'done' ? 3 : order.indexOf(v.phase);
    document.querySelector('.tc-phases').innerHTML = order.map((p, i) =>
      `<span role="listitem" class="${i === pi ? 'tc-on' : i < pi ? 'tc-past' : ''}"${i === pi ? ' aria-current="step"' : ''}>${i < pi ? icon('check') : ''}${PHASES[p]}</span>`).join('') +
      (v.phase === 'done' ? `<span role="listitem" class="tc-fin" aria-current="step">${icon('check')}Done</span>` : '');
  }

  const DREW = ` · <span class="tc-drew">${icon('pencil')}with your drawing</span>`;
  function renderStream(v) {
    const box = document.querySelector('.tc-stream');
    box.innerHTML = '';
    T.active = null;
    let phase = null;
    let lastTurnEl = null;
    const DIV = { plan: 'The plan', teach: 'Teaching', done: 'Done' };
    v.items.forEach((it) => {
      if (it.type === 'teacher') {
        if (it.phase !== phase) {
          if (phase !== null || it.phase !== 'probe') box.appendChild(el(`<div class="tc-divider">${esc(DIV[it.phase] || PHASES[it.phase] || it.phase)}</div>`));
          phase = it.phase;
        }
        const turn = el('<div class="tc-turn"></div>');
        if (typeof it.turn === 'number') turn.dataset.turn = it.turn;
        if (T.live && T.live.turn === it.turn) turn.appendChild(T.live.el);   // the live answer, still playing
        else if (it.board && Q.board) {
          const host = el('<div class="tc-board"></div>');
          Q.board.mount(host, it.board, { menu });
          turn.appendChild(host);
        } else if (it.boardFailed) turn.appendChild(el(`<div class="tc-boardnote">${icon('warning')}The teacher couldn't draw this one on the board; the answer is in text.</div>`));
        if (it.say) { const s = el('<div class="tc-say"></div>'); s.innerHTML = md(it.say); turn.appendChild(s); }
        if (it.say && it.say.length >= 60) turn.appendChild(turnTools(v, it));
        if (it.later && it.later.length && typeof it.turn === 'number') turn.appendChild(laterChips(v, it));
        if (it.planUpdated) {
          const n = el(`<button type="button" class="tc-note">${icon('map')}The plan was updated</button>`);
          n.onclick = () => setInspector(true);
          turn.appendChild(n);
        }
        if (it.card) turn.appendChild(renderCard(v, it.card));
        box.appendChild(turn);
        lastTurnEl = turn;
      } else {
        if (it.type === 'terminal') {
          const shown = it.cmds.slice(-3).map((c) => `<code class="${c.exit ? 'bad' : ''}">${esc(c.cmd)}</code>`).join(' ');
          const more = it.cmds.length > 3 ? ` +${it.cmds.length - 3}` : '';
          const b = el(`<button type="button" class="tc-ran" title="Show the commands">${icon('terminal')}<span>You ran ${it.cmds.length} command${it.cmds.length === 1 ? '' : 's'}: ${shown}${more}</span></button>`);
          b.onclick = () => openTerm().then(() => T.pane && T.pane.toggleLog(true));
          box.appendChild(b);
          return;
        }
        if (it.type === 'answer') {
          const a = el(`<button type="button" class="tc-me tc-answered"><small>You answered the question above${it.drawing ? DREW : ''}</small><div class="bubble">${esc(it.text || 'Answered')}</div></button>`);
          a.title = 'Show that question';
          a.onclick = () => { const c = box.querySelector(`.tc-card[data-card="${CSS.escape(it.cardId)}"]`); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
          box.appendChild(a);
          return;
        }
        const me = el(`<div class="tc-me"><small>${it.type === 'planChange' ? 'Plan change' : it.board ? 'You asked for the board' : 'You asked'}${it.drawing ? DREW : ''}</small><div class="bubble">${esc(it.text)}</div></div>`);
        if (it.materials && it.materials.length && Q.materials) me.appendChild(el(`<div class="tc-mats">${it.materials.map((a) => Q.materials.chip({ ...a, range: a.pages })).join('')}</div>`));
        box.appendChild(me);
      }
    });
    if (T.live && T.live.turn == null) box.appendChild(T.live.el);   // live answer, turn not stored yet
    if (Q.board) Q.board.stopDetached();
    applyMarks(v);
    syncDrawChip();
    if (!v.items.length && v.pending) box.appendChild(el('<div class="tc-wait"><span class="activity"></span>Reading your goal and material, then the first question…</div>'));
    // A new teacher turn: bring its start into view (read from the top, not the bottom).
    if (v.items.length > T.lastCount && lastTurnEl && T.lastCount) lastTurnEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Opening or resuming a lesson: start at the bottom, where it continues. Boards and images grow the
    // page after the first paint, so follow them for a moment unless he scrolls up himself.
    if (!T.lastCount && v.items.length) toBottom();
    T.lastCount = v.items.length;
  }

  function toBottom() {
    let stop = false;
    const end = () => { stop = true; };
    const opts = { passive: true, once: true };
    window.addEventListener('wheel', end, opts); window.addEventListener('touchstart', end, opts); window.addEventListener('keydown', end, opts);
    const go = () => { if (!stop && document.body.classList.contains('teach-on')) window.scrollTo(0, document.scrollingElement.scrollHeight); };
    requestAnimationFrame(go);
    [250, 700, 1500].forEach((ms) => setTimeout(go, ms));
    setTimeout(() => { window.removeEventListener('wheel', end); window.removeEventListener('touchstart', end); window.removeEventListener('keydown', end); }, 1600);
  }

  // Under a teacher reply: hear it, or have it redrawn on the board.
  function turnTools(v, it) {
    const row = el('<div class="tc-tools"></div>');
    if (Q.board && Q.board.available) {
      const r = el(`<button type="button" class="tc-tool" aria-pressed="false"${typeof it.turn === 'number' ? ` data-read="${it.turn}"` : ''}>${icon('speaker')}<span>Read aloud</span></button>`);
      r.onclick = () => Q.board.readAloud(it.say, r);
      row.appendChild(r);
    }
    if (!it.board && typeof it.turn === 'number') {
      const b = el(`<button type="button" class="tc-tool"${v.pending ? ' disabled' : ''}>${icon('board')}<span>Explain on the board</span></button>`);
      b.onclick = () => boardFor(it.turn);
      row.appendChild(b);
    }
    return row;
  }

  function renderStatus(v) {
    const box = document.querySelector('.tc-status');
    clearInterval(T.tick);
    if (v.pending && v.items.length && T.live && !T.live.ended) box.innerHTML = '';
    else if (v.pending && v.items.length) {
      const since = Date.parse(v.pending.since) || Date.now();
      const label = v.pending.kind === 'save' ? 'Writing your note and questions…' : 'Thinking…';
      box.innerHTML = `<div class="tc-busy" role="status"><span class="activity"></span><span>${label}</span><span class="secs"></span></div>`;
      const upd = () => { const s = box.querySelector('.secs'); if (s) s.textContent = Math.max(0, Math.round((Date.now() - since) / 1000)) + ' s'; };
      upd(); T.tick = setInterval(upd, 1000);
    } else if (v.error) {
      box.innerHTML = `<div class="tc-banner error" role="alert">${icon('warning')}<div class="grow"><div class="t">${v.error.kind === 'save' ? "Couldn't prepare the save" : "The teacher couldn't answer"}</div>${esc(v.error.message)}</div><button class="btn btn-sm" type="button">${icon('refresh')}Try again</button></div>`;
      box.querySelector('button').onclick = () => act('retry', {});
    } else box.innerHTML = '';
  }

  // ---------- cards ----------

  function renderCard(v, c) {
    const open = c.id === v.openCardId && !v.pending;
    const wrap = el(`<div class="tc-card ${c.kind}"></div>`);
    wrap.dataset.card = c.id;
    if (c.kind === 'plan') return planCard(v, c, open, wrap);
    if (c.kind === 'done') return doneCard(c, wrap);
    const head = `<div class="tc-card-head">${badge(c.kind)}${c.kind === 'probe' && c.strand ? `<span class="footnote">${esc(c.strand)}</span>` : ''}${c.kind === 'task' ? stepLabel(v, c) : ''}</div>`;
    // Still open, but the teacher is answering a question first: show it, answerable once the turn is done.
    if (c.id === v.openCardId && v.pending) {
      wrap.innerHTML = `${head}<div class="tc-q">${md(c.question || '')}</div><div class="tc-stale">You can answer this once the teacher has replied.</div>`;
      return wrap;
    }
    if (!open) return answeredCard(c, wrap, head);
    if (c.kind === 'task') return taskCard(v, c, wrap);

    // ---- the open card ----
    const isMcq = Array.isArray(c.options) && (c.kind === 'probe' || c.kind === 'check');
    const graded = c.kind === 'probe' || c.kind === 'check';
    const state = { choice: null, dontKnow: false };
    // A check waits behind a button, so the teaching above gets read first. (No separate "while
    // reading" box: one text box per card; his thoughts go in with his answer.)
    let body = wrap;
    if (c.kind === 'check') {
      const gate = el(`<div class="tc-gate"><p>When you've read the explanation, check that it landed.</p></div>`);
      const btn = el(`<button class="btn btn-tinted tc-gate-btn" type="button">${icon('target')}Check your understanding</button>`);
      gate.appendChild(btn);
      body.classList.add('hidden');
      btn.onclick = () => {
        gate.hidden = true;
        body.classList.remove('hidden');
        body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      const holder = el('<div></div>');
      holder.appendChild(gate); holder.appendChild(body);
      fillOpen();
      T.active.reveal = () => { if (!body.classList.contains('hidden')) return false; btn.click(); return true; };
      return holder;
    }
    fillOpen();
    return wrap;

    function fillOpen() {
      body.innerHTML = `${head}<div class="tc-q">${md(c.question)}</div>`;
      const opts = [];
      let other = null, idk = null;
      const list = el('<div class="tc-opts" role="radiogroup"></div>');
      if (Array.isArray(c.options)) {
        c.options.forEach((o, i) => {
          const b = el(`<button class="tc-opt" type="button" role="radio" aria-checked="false"><span class="tc-radio"></span><span>${Q.inline(o)}</span><span class="tc-kbd">${i + 1}</span></button>`);
          b.onclick = () => pick(i);
          list.appendChild(b); opts.push(b);
        });
      }
      if (graded) {
        const n = Array.isArray(c.options) ? c.options.length + 1 : 0;
        idk = el(`<button type="button" class="tc-opt tc-idk" role="radio" aria-checked="false"><span class="tc-radio"></span><span>I don't know</span>${n && n <= 5 ? `<span class="tc-kbd">${n}</span>` : '<span></span>'}</button>`);
        idk.onclick = () => { state.dontKnow = !state.dontKnow; if (state.dontKnow) state.choice = null; paint(); };
        list.appendChild(idk);
      }
      if (list.children.length) body.appendChild(list);
      // Free text: free-recall checks, predictions / asks without options, or "Other" for asks/predictions with options.
      if (!isMcq) {
        const free = el('<div class="tc-free field-wrap"></div>');
        other = el('<textarea class="field"></textarea>');
        other.placeholder = c.freeRecall ? 'Explain it in your own words. Thinking out loud is welcome.'
          : Array.isArray(c.options) ? 'Why that one? Or write your own answer…'
          : c.kind === 'predict' ? 'Your prediction, and your reasoning if you like. A wrong guess is fine.'
          : 'Your answer. Thinking out loud is welcome.';
        free.appendChild(other);
        body.appendChild(free);
        micFor(other, c.question);
      }
      const conf = graded ? confidence(body) : { value: null };
      // One text box per card: multiple choice gets an optional "why" box (it has no other); otherwise the
      // answer box takes the thinking too, and the teacher reads both from it.
      const th = isMcq ? thinkField(body, { label: 'Why? · optional', placeholder: 'How are you reasoning? What are you unsure about?', hint: c.question }) : { value: '' };
      const label = c.kind === 'predict' ? 'Send prediction' : c.kind === 'ask' ? 'Answer' : 'Submit';
      const sub = el(`<div class="tc-foot"><span class="hint"><span class="tc-kbd">${CMD_ENTER}</span></span><button class="btn btn-primary" type="button">${label}</button></div>`);
      body.appendChild(sub);
      const subBtn = sub.querySelector('button');

      function paint() {
        opts.forEach((b, i) => { b.classList.toggle('sel', state.choice === i); b.setAttribute('aria-checked', String(state.choice === i)); });
        if (idk) { idk.classList.toggle('sel', state.dontKnow); idk.setAttribute('aria-checked', String(state.dontKnow)); }
      }
      function pick(i) {
        if (i === opts.length && idk) { idk.click(); return; }
        if (!opts[i]) return;
        state.choice = state.choice === i ? null : i;
        state.dontKnow = false;
        paint();
      }
      async function submit() {
        const payload = { cardId: c.id, thinking: th.value || undefined };
        if (state.dontKnow) payload.dontKnow = true;
        else if (state.choice !== null) {
          if (isMcq) payload.choice = state.choice; else payload.choiceText = c.options[state.choice];
        } else if (other && other.value.trim()) payload.text = other.value.trim();
        else { Q.showToast(isMcq ? 'Pick an option (or “I don’t know”)' : 'Write an answer first'); return; }
        if (other && state.choice === null && !state.dontKnow) payload.text = other.value.trim();
        // Picked an option and wrote something too: the text is his reasoning for the pick.
        if (other && (state.choice !== null || state.dontKnow) && other.value.trim()) payload.thinking = other.value.trim();
        if (conf.value !== null && conf.value !== undefined) payload.confidence = conf.value;
        subBtn.disabled = true;
        if (!(await act('answer', payload))) subBtn.disabled = false;
      }
      subBtn.onclick = submit;
      T.active = { submit, pick, count: opts.length + (idk && opts.length ? 1 : 0) };
    }
  }

  function yours(a) {
    const bits = [];
    if (a.thinkingWhileReading) bits.push(`<div><span class="lbl">While reading</span>${esc(a.thinkingWhileReading)}</div>`);
    if (a.thinking) bits.push(`<div><span class="lbl">Your thinking</span>${esc(a.thinking)}</div>`);
    if (typeof a.confidence === 'number') bits.push(`<div class="conf">${icon('target')}You were ${a.confidence}% sure</div>`);
    return bits.length ? `<div class="tc-yours">${bits.join('')}</div>` : '';
  }
  const IDK = `<div class="tc-result idk">${icon('info')}You didn't know: an honest gap, not a mistake.</div>`;

  function answeredCard(c, wrap, head) {
    const a = c.answer;
    let html = `${head}<div class="tc-q">${md(c.question || '')}</div>`;
    if (!a) {
      wrap.classList.add('stale');
      wrap.innerHTML = html + '<div class="tc-stale">Not answered</div>';
      return wrap;
    }
    const r = c.result;
    if (Array.isArray(c.options) && r && !c.freeRecall) {
      html += '<div class="tc-opts">' + c.options.map((o, i) => {
        const right = i === r.correctIndex, picked = i === a.choice;
        const cls = right ? 'right' : picked ? 'wrong' : 'dim';
        const ic = right ? icon('check-circle') : picked ? icon('x-circle') : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9.5"/></svg>';
        const mis = !right && r.misconceptions && r.misconceptions[i] ? `<span class="mis">${Q.inline(r.misconceptions[i])}</span>` : '';
        return `<div class="tc-opt static ${cls}">${ic}<span>${Q.inline(o)}${mis}</span>${picked ? '<span class="badge">Your answer</span>' : '<span></span>'}</div>`;
      }).join('') + '</div>';
      html += a.dontKnow ? IDK
        : r.correct ? `<div class="tc-result ok">${icon('check-circle')}Correct</div>` : `<div class="tc-result bad">${icon('x-circle')}Not quite</div>`;
      if (r.explanation) html += `<div class="tc-expl">${md(r.explanation)}</div>`;
    } else if (c.kind === 'task' && r) {
      html += setupBox(c);
      if (c.ask) html += `<div class="tc-askq"><span class="lbl">Then answer</span>${md(c.ask)}</div>`;
      html += `<div class="tc-quote"><span class="lbl">${a.dontKnow ? 'You were stuck' : 'You said'}</span>${esc(a.text || (a.dontKnow ? '' : 'Done'))}</div>`;
      if (r.check) html += `<div class="tc-checkres"><span class="lbl">The app checked <code>${esc(r.check.cmd)}</code><span class="ex">exit ${esc(String(r.check.exit))}</span></span><pre>${esc(r.check.output || '(no output)')}</pre></div>`;
      const g = r.grade;
      if (g) {
        html += `<div class="tc-result ${g.correct ? 'ok' : 'bad'}">${icon(g.correct ? 'check-circle' : 'x-circle')}<span>${esc(g.verdict || (g.correct ? 'Done' : 'Not quite'))}</span><span class="score">${g.score}/100</span></div>`;
        if (g.got || g.missed) html += `<div class="tc-gotmiss">${g.got ? `<div class="g">${icon('check')}<span>${Q.inline(g.got)}</span></div>` : ''}${g.missed ? `<div class="m">${icon('close')}<span>${Q.inline(g.missed)}</span></div>` : ''}</div>`;
      }
      html += `<div class="tc-expl"><span class="lbl">What you should have seen</span>${md(r.committed)}</div>`;
    } else if (c.freeRecall && r) {
      html += `<div class="tc-quote"><span class="lbl">Your answer</span>${a.dontKnow ? "I don't know" : esc(a.text || '')}</div>`;
      const g = r.grade;
      if (g) {
        html += `<div class="tc-result ${g.correct ? 'ok' : 'bad'}">${icon(g.correct ? 'check-circle' : 'x-circle')}<span>${esc(g.verdict || (g.correct ? 'Correct' : 'Not quite'))}</span><span class="score">${g.score}/100</span></div>`;
        if (g.got || g.missed) html += `<div class="tc-gotmiss">${g.got ? `<div class="g">${icon('check')}<span>${Q.inline(g.got)}</span></div>` : ''}${g.missed ? `<div class="m">${icon('close')}<span>${Q.inline(g.missed)}</span></div>` : ''}</div>`;
      } else if (a.dontKnow) html += IDK;
      html += `<div class="tc-expl"><span class="lbl">The full answer</span>${md(r.committed)}</div>`;
    } else {
      // predict / ask
      const said = a.dontKnow ? "I don't know" : typeof a.choice === 'number' && c.options ? c.options[a.choice] : a.choiceText || a.text || '';
      html += `<div class="tc-quote"><span class="lbl">${c.kind === 'predict' ? 'You predicted' : 'You answered'}</span>${esc(said)}${a.text && a.choiceText ? '\n' + esc(a.text) : ''}</div>`;
    }
    if (a.drawing) html += `<div class="tc-drewnote">${icon('pencil')}Sent with your drawing on the board</div>`;
    html += yours(a);
    wrap.innerHTML = html;
    return wrap;
  }

  // Plan nodes in teaching order: by depth, then as laid out on the map.
  function planOrder(plan) {
    const L = layoutPlan(plan, 600);
    return [...plan.nodes].sort((a, b) => (L.depth[a.id] - L.depth[b.id]) || (L.pos[a.id].x - L.pos[b.id].x));
  }

  function planCard(v, c, open, wrap) {
    const known = c.nodes.filter((n) => n.known).length;
    const L = layoutPlan(c, 600);
    wrap.innerHTML = `<div class="tc-card-head">${badge('plan')}<span class="footnote">${c.nodes.length} steps${known ? `, ${known} you already know` : ''}</span></div>` +
      (c.goal ? `<div class="tc-plan-goal">${Q.inline(c.goal)}</div>` : '') +
      (c.summary ? `<div class="tc-plan-sum">${Q.inline(c.summary)}</div>` : '') +
      `<ol class="tc-steps">${planOrder(c).map((n) => `<li class="${n.known ? 'known' : ''} ${L.sinks.has(n.id) ? 'goal' : ''}"><i></i><span>${esc(n.label)}</span>${n.known ? '<span class="badge">Known</span>' : L.sinks.has(n.id) ? '<span class="badge accent">Goal</span>' : '<span></span>'}</li>`).join('')}</ol>` +
      mapSvg(c, { visited: [], current: null }, 600, 'card');
    const a = c.answer;
    if (a) { wrap.appendChild(el(`<div class="tc-approved">${icon(a.approve ? 'check-circle' : 'chat')}<span>${a.approve ? 'You approved this plan.' : 'You asked for a change: ' + esc(a.text || '')}</span></div>`)); return wrap; }
    if (!open) { wrap.classList.add('stale'); wrap.appendChild(el('<div class="tc-stale">Replaced by a newer plan</div>')); return wrap; }
    const chg = el(`<div class="tc-change hidden"><textarea class="field" placeholder="What should change? e.g. I already know how fork() works; go deeper on wait()"></textarea></div>`);
    const row = el(`<div class="tc-foot"><button class="btn lead" type="button" data-a="change">Change the plan…</button><span class="hint"><span class="tc-kbd">${CMD_ENTER}</span></span><button class="btn btn-primary" type="button" data-a="ok">Start teaching</button></div>`);
    wrap.appendChild(chg); wrap.appendChild(row);
    micFor(chg.querySelector('textarea'), c.goal);
    const okBtn = row.querySelector('[data-a=ok]');
    const approve = () => { okBtn.disabled = true; act('answer', { cardId: c.id, approve: true }).then((ok) => { if (!ok) okBtn.disabled = false; }); };
    const sendChange = () => { const t = chg.querySelector('textarea').value.trim(); if (t) act('answer', { cardId: c.id, text: t }); else chg.querySelector('textarea').focus(); };
    okBtn.onclick = () => (chg.classList.contains('hidden') ? approve() : sendChange());
    row.querySelector('[data-a=change]').onclick = (e) => {
      const opening = chg.classList.contains('hidden');
      chg.classList.toggle('hidden', !opening);
      e.currentTarget.textContent = opening ? 'Keep the plan' : 'Change the plan…';
      okBtn.textContent = opening ? 'Send change' : 'Start teaching';
      if (opening) chg.querySelector('textarea').focus();
    };
    T.active = { submit: () => okBtn.click(), pick() {}, count: 0 };
    return wrap;
  }

  function doneCard(c, wrap) {
    wrap.innerHTML = `<div class="tc-card-head">${badge('done')}</div><div class="tc-done-sum">${md(c.summary)}</div>` +
      (c.nextSteps && c.nextSteps.length ? `<h4>Where to go next</h4><ul>${c.nextSteps.map((s) => `<li>${Q.inline(s)}</li>`).join('')}</ul>` : '') +
      `<div class="tc-foot"><button class="btn btn-primary" type="button">${icon('note')}Save to vault…</button></div>`;
    wrap.querySelector('button').onclick = openSave;
    // The save banner below covers it while it shows (preparing, ready or saved); after "Not now" or a failure the button is back.
    const a = T.view && T.view.autoSave;
    if (a && !a.dismissed && ['preparing', 'ready', 'saved'].includes(a.state)) wrap.querySelector('.tc-foot').remove();
    return wrap;
  }

  // ---------- plan map (hand-rolled layered DAG) ----------

  // Lay the plan out in layers (foundations on top, the goal at the bottom), sized to `maxW` px.
  function layoutPlan(plan, maxW) {
    const ids = plan.nodes.map((n) => n.id);
    const parents = Object.fromEntries(ids.map((id) => [id, []]));
    const kids = Object.fromEntries(ids.map((id) => [id, []]));
    for (const [a, b] of plan.edges || []) if (parents[b] && kids[a]) { parents[b].push(a); kids[a].push(b); }
    // depth = longest path from a root
    const depth = {};
    const d = (id, seen = new Set()) => {
      if (depth[id] !== undefined) return depth[id];
      if (seen.has(id)) return 0;
      seen.add(id);
      return (depth[id] = parents[id].length ? 1 + Math.max(...parents[id].map((p) => d(p, seen))) : 0);
    };
    ids.forEach((id) => d(id));
    const layers = [];
    ids.forEach((id) => (layers[depth[id]] ||= []).push(id));
    const maxN = Math.max(1, ...layers.map((l) => (l ? l.length : 0)));
    const GX = 10, GY = 26;
    const W = Math.max(84, Math.min(156, Math.floor((maxW - (maxN - 1) * GX) / maxN)));
    const chars = Math.max(10, Math.floor((W - 14) / 6.3));
    const lines = Object.fromEntries(plan.nodes.map((n) => [n.id, wrapLabel(n.label, chars, 3)]));
    const H = 16 + 15 * Math.max(...Object.values(lines).map((l) => l.length));
    const width = maxN * (W + GX) - GX + 8;
    const pos = {};
    const avgX = (id) => { const ps = parents[id].filter((p) => pos[p]); return ps.length ? ps.reduce((s, p) => s + pos[p].x, 0) / ps.length : 0; };
    layers.forEach((layer, li) => {
      if (!layer) return;
      if (li) layer.sort((a, b) => avgX(a) - avgX(b));   // keep edges short
      const total = layer.length * (W + GX) - GX;
      layer.forEach((id, i) => { pos[id] = { x: (width - total) / 2 + i * (W + GX), y: 4 + li * (H + GY) }; });
    });
    const height = layers.length * (H + GY) - GY + 10;
    const sinks = new Set(ids.filter((id) => !kids[id].length));
    return { W, H, width, height, pos, depth, lines, sinks };
  }

  function wrapLabel(s, max = 20, lines = 3) {
    const out = [''];
    for (const w of String(s).split(/\s+/)) {
      const cur = out[out.length - 1];
      if (!cur) out[out.length - 1] = w;
      else if ((cur + ' ' + w).length <= max) out[out.length - 1] = cur + ' ' + w;
      else out.push(w);
    }
    if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].slice(0, max - 1) + '…'; }
    return out;
  }

  // Plan boxes clip long names: hovering one shows its full name right away (SVG <title> is slow and plain).
  const tip = document.createElement('div');
  tip.className = 'tc-tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let tipFor = null;
  document.addEventListener('mouseover', (e) => {
    const g = e.target.closest && e.target.closest('.tc-map-svg .node[data-tip]');
    if (g === tipFor) return;
    tipFor = g;
    if (!g) return void tip.classList.remove('show');
    tip.innerHTML = `${esc(g.dataset.tip)}<small>${esc(g.dataset.tipSub || '')}</small>`;
    const r = g.getBoundingClientRect();
    tip.style.left = '0px'; tip.style.top = '0px';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;   // no room above: show below
    x = Math.max(8, Math.min(x, innerWidth - tw - 8));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.classList.add('show');
  });
  document.addEventListener('scroll', () => { tipFor = null; tip.classList.remove('show'); }, true);

  function mapSvg(plan, v, maxW, key) {
    const L = layoutPlan(plan, maxW);
    const { W, H, pos } = L;
    const edges = (plan.edges || []).filter(([a, b]) => pos[a] && pos[b]).map(([a, b]) => {
      const x1 = pos[a].x + W / 2, y1 = pos[a].y + H, x2 = pos[b].x + W / 2, y2 = pos[b].y - 3;
      const my = (y1 + y2) / 2;
      return `<path class="edge" marker-end="url(#tcArrow-${key})" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
    }).join('');
    const nodes = plan.nodes.map((n) => {
      const p = pos[n.id];
      const cur = v.current === n.id, vis = !cur && (v.visited || []).includes(n.id);
      const cls = ['node', n.known ? 'known' : '', vis ? 'visited' : '', cur ? 'current' : '', L.sinks.has(n.id) ? 'goal' : ''].join(' ');
      const lines = L.lines[n.id];
      const ty = p.y + H / 2 - (lines.length - 1) * 7.5 + 4;
      const tick = vis ? `<g class="tick"><circle cx="${p.x + W - 2}" cy="${p.y + 2}" r="7"/><path d="M${p.x + W - 5.2},${p.y + 2.2} l2.2,2.2 l4,-4.4"/></g>` : '';
      const status = cur ? 'You are here' : vis ? 'Covered' : n.known ? 'You already know this' : L.sinks.has(n.id) ? 'Your goal' : 'Coming up';
      return `<g class="${cls}" data-tip="${esc(n.label)}" data-tip-sub="${status}" aria-label="${esc(`${n.label} (${status})`)}"><rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="9"/>` +
        lines.map((l, i) => `<text x="${p.x + W / 2}" y="${ty + i * 15}" text-anchor="middle">${esc(l)}</text>`).join('') + tick + '</g>';
    }).join('');
    return `<svg class="tc-map-svg" width="${L.width}" viewBox="0 0 ${L.width} ${L.height}" role="img" aria-label="Plan map"><defs><marker id="tcArrow-${key}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="arrow" d="M0,1 L9,5 L0,9 z"/></marker></defs>${edges}${nodes}</svg>`;
  }

  function renderMap(v) {
    const box = document.querySelector('.tc-map');
    const plan = v.plan;
    if (!plan) {
      box.innerHTML = `<p class="tc-ins-empty">The plan appears after a few quick questions that find where your understanding ends.</p>`;
      return;
    }
    const w = Math.max(240, (box.clientWidth || 300));
    box.innerHTML = (plan.summary ? `<p class="tc-ins-sum">${Q.inline(plan.summary)}</p>` : '') + mapSvg(plan, v, w, 'ins') +
      `<div class="tc-legend"><span><i class="cur"></i>You are here</span><span><i class="vis"></i>Covered</span><span><i class="kn"></i>Already known</span><span><i class="goal"></i>Your goal</span></div>
       <p class="tc-legend-note">Arrows point from what you need first to what builds on it. A mark shows where the lesson has been, not a grade.</p>` +
      (v.pending ? '' : `<div class="tc-ins-actions"><button class="btn btn-sm" type="button">${icon('map')}Change the plan…</button></div>`);
    const b = box.querySelector('.tc-ins-actions button');
    if (b) b.onclick = changePlan;
  }

  function renderAssessment(v) {
    const box = Q.$('tcAssessBox');
    if (!v.assessment || !v.assessment.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.querySelector('.tc-assess').innerHTML = v.assessment.map((a) =>
      `<div><div class="s">${Q.inline(a.strand || '')}</div>` +
      (a.floor ? `<div class="r f">${icon('check-circle')}<span>${Q.inline(String(a.floor))}</span></div>` : '') +
      (a.ceiling ? `<div class="r c">${icon('target')}<span>${Q.inline(String(a.ceiling))}</span></div>` : '') +
      (Array.isArray(a.misconceptions) && a.misconceptions.length ? `<div class="r m">${icon('warning')}<span>${a.misconceptions.map((m) => Q.inline(String(m))).join('; ')}</span></div>` : '') +
      '</div>').join('');
  }

  // ---------- lab terminal ----------

  // The terminal button shows when this lesson already has the lab, or when the lab machine answers.
  // A lab lesson opens its terminal right away unless he closed it last time.
  async function labSetup(v) {
    const btn = Q.$('tcTermBtn');
    if (!btn || !Q.lab) return;
    if (v.lab && v.lab.on) {
      btn.classList.remove('hidden');
      // A lab lesson opens its terminal right away; in other lessons it opens with the teacher's first task.
      const used = !v.lab.auto || v.items.some((i) => i.type === 'terminal');
      if (used && localStorage.getItem(`teach.term.${v.id}`) !== 'off' && window.innerWidth >= 700) openTerm();
      return;
    }
    const st = await Q.lab.status();
    if (st.ok && T.view && T.view.id === v.id) btn.classList.remove('hidden');
  }

  // Terminal size: the column's width (wide screens) or the sheet's height (narrow), dragged by its
  // edge and remembered. Clamped so the lesson keeps a readable column.
  const MIN_TERM = 320, MIN_LESSON = 380;
  function termColW(screen) {
    const W = screen.offsetWidth;
    const want = Number(localStorage.getItem('teach.termW')) || Math.round(W * 0.48);
    return Math.max(MIN_TERM, Math.min(want, W - MIN_LESSON));
  }
  function termSheetH() {
    const f = Number(localStorage.getItem('teach.termH')) || 0.46;
    return Math.round(innerHeight * Math.max(0.2, Math.min(0.8, f)));
  }
  function addGrip(col) {
    if (col.querySelector('.tc-termgrip')) return;
    const g = el('<div class="tc-termgrip" role="separator" tabindex="0" aria-label="Resize the terminal" title="Drag to resize · double-click to reset"></div>');
    col.appendChild(g);
    const screen = () => document.querySelector('.tc-screen');
    const setW = (w) => { localStorage.setItem('teach.termW', String(Math.round(Math.max(MIN_TERM, Math.min(w, screen().offsetWidth - MIN_LESSON))))); layout(); };
    const setH = (h) => { localStorage.setItem('teach.termH', String(Math.max(0.2, Math.min(0.8, h / innerHeight)).toFixed(3))); layout(); };
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const narrow = screen().classList.contains('narrow');
      g.setPointerCapture(e.pointerId);
      document.body.classList.add('tc-dragging', narrow ? 'tc-drag-y' : 'tc-drag-x');
      const right = screen().getBoundingClientRect().right;
      const bottom = innerHeight - barHeight('.statusbar');
      const move = (ev) => (narrow ? setH(bottom - ev.clientY) : setW(right - ev.clientX - 16));
      const up = () => {
        document.body.classList.remove('tc-dragging', 'tc-drag-x', 'tc-drag-y');
        g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
      };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
    g.addEventListener('dblclick', () => { localStorage.removeItem('teach.termW'); localStorage.removeItem('teach.termH'); layout(); });
    g.addEventListener('keydown', (e) => {
      const narrow = screen().classList.contains('narrow');
      const step = e.shiftKey ? 120 : 30;
      const cur = narrow ? termSheetH() : termColW(screen());
      const d = { ArrowLeft: narrow ? 0 : step, ArrowRight: narrow ? 0 : -step, ArrowUp: narrow ? step : 0, ArrowDown: narrow ? -step : 0 }[e.key];
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      narrow ? setH(cur + d) : setW(cur + d);
    });
  }

  async function openTerm() {
    const v = T.view;
    const screen = document.querySelector('.tc-screen');
    if (!v || !screen || !Q.lab) return;
    if (!v.lab || !v.lab.on) { if (!(await act('lab', { on: true }))) return; }
    localStorage.setItem(`teach.term.${v.id}`, 'on');
    screen.classList.add('term-open');
    Q.$('tcTermBtn').classList.remove('hidden');
    Q.$('tcTermBtn').setAttribute('aria-pressed', 'true');
    layout();
    if (T.pane && T.pane.owner === v.id) { T.pane.focus(); return; }
    if (T.pane) T.pane.dispose();
    addGrip(Q.$('tcTermCol'));
    T.pane = new Q.lab.Pane(Q.$('tcTermCol'), v.id, {
      seen: () => (T.view && T.view.lab ? T.view.lab.seen : 0),
      shareDisabled: () => !!(T.view && T.view.pending),
      onShare: () => act('message', { text: 'Take a look at what I just ran.' }),
      onAsk: (c) => {
        const ta = Q.$('tcAsk');
        ta.value = `About \`${c.cmd}\`: `;
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      },
      onHide: () => closeTerm(),
      dir: () => (T.view && T.view.lab ? T.view.lab.dir : null),
    });
    await T.pane.start();
  }

  function closeTerm() {
    const screen = document.querySelector('.tc-screen');
    if (!screen || !T.view) return;
    localStorage.setItem(`teach.term.${T.view.id}`, 'off');
    screen.classList.remove('term-open');
    Q.$('tcTermBtn').setAttribute('aria-pressed', 'false');
    layout();
  }

  function renderLab(v) {
    if (T.pane) { T.pane.renderFoot(); T.pane.renderLog(); }
    // The teacher chose a hands-on step: open the terminal (once per task, so closing it sticks).
    const open = v.openCardId && !v.pending && v.items.find((i) => i.card && i.card.id === v.openCardId);
    if (open && open.card.kind === 'task' && T.autoOpened !== open.card.id) {
      T.autoOpened = open.card.id;
      if (v.lab && v.lab.on) { Q.$('tcTermBtn').classList.remove('hidden'); if (!document.querySelector('.tc-screen.term-open')) openTerm(); }
    }
    const box = Q.$('tcLabBox');
    const steps = v.lab && v.lab.steps;
    box.classList.toggle('hidden', !(steps && steps.length));
    if (!steps) return;
    const lastTask = [...v.items].reverse().find((i) => i.type === 'teacher' && i.card && i.card.kind === 'task' && i.card.stepId);
    const cur = lastTask ? lastTask.card.stepId : null;
    Q.$('tcLabSteps').innerHTML = steps.map((st) => `<li class="${st.done ? 'done' : ''}"><i></i><span>${esc(st.title)}</span>${st.id === cur && !st.done ? '<span class="badge accent">Now</span>' : '<span></span>'}</li>`).join('');
  }

  const stepLabel = (v, c) => {
    const steps = v.lab && v.lab.steps;
    const i = steps && c.stepId ? steps.findIndex((x) => x.id === c.stepId) : -1;
    return i >= 0 ? `<span class="footnote">Step ${i + 1} of ${steps.length}: ${esc(steps[i].title)}</span>` : '';
  };

  // An open lab task: do it in the terminal, then Done (with the answer to `ask`) or "I'm stuck".
  // Files the teacher prepared in the lesson folder (task "setup"), each one viewable.
  function setupBox(c) {
    const st = c.setup;
    if (!st) return '';
    if (!st.ok) return `<div class="tc-prep bad"><div class="hd">${icon('warning')}<span>Couldn't prepare the files in <code>${esc(st.dir || '')}</code>: ${esc(st.error || 'unknown error')}. Is the lab machine reachable? “Rewrite last reply” in the lesson menu tries again.</span></div></div>`;
    return `<div class="tc-prep"><div class="hd">${icon('check-circle')}<span>Ready for you in <code>${esc(st.dir)}</code></span>` +
      `<button class="btn btn-plain btn-sm cp" type="button" data-cd="${esc(st.dir)}" title="Copy the cd command">Copy <code>cd</code></button></div>` +
      st.files.map((f) => `<details><summary>${icon('chevron-right')}${esc(f.path)}${f.executable ? '<span class="x">executable</span>' : ''}</summary><pre><code>${esc(f.content)}</code></pre></details>`).join('') +
      '</div>';
  }
  // One listener for every "Copy cd" button, answered cards included.
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.tc-prep [data-cd]');
    if (b) navigator.clipboard.writeText(`cd ${b.dataset.cd}`).then(() => Q.showToast('Copied: cd ' + b.dataset.cd), () => {});
  });

  function taskCard(v, c, wrap) {
    wrap.innerHTML = `<div class="tc-card-head">${badge('task')}${stepLabel(v, c)}</div><div class="tc-q">${md(c.question)}</div>` + setupBox(c) +
      (c.hint ? `<details class="tc-hint"><summary>${icon('hint')}Show hint</summary><div>${md(c.hint)}</div></details>` : '') +
      '<div class="tc-taskterm"></div>' +
      (c.ask ? `<div class="tc-askq"><span class="lbl">Then answer</span>${md(c.ask)}</div>` : '');
    const tt = wrap.querySelector('.tc-taskterm');
    const paintTT = () => {
      const shown = document.querySelector('.tc-screen.term-open');
      tt.innerHTML = shown ? '' : `<button class="btn btn-tinted" type="button">${icon('terminal')}Open the terminal</button>`;
      const b = tt.querySelector('button');
      if (b) b.onclick = () => openTerm().then(paintTT);
    };
    paintTT();
    const free = el('<div class="tc-free field-wrap"></div>');
    const ta = el('<textarea class="field"></textarea>');
    ta.placeholder = c.ask ? 'Your answer, and your thinking if you like…' : 'Anything you noticed or tried? (optional)';
    free.appendChild(ta);
    wrap.appendChild(free);
    micFor(ta, c.ask || c.question);
    const foot = el(`<div class="tc-foot"><button class="btn lead" type="button" data-a="stuck">I'm stuck</button><span class="hint"><span class="tc-kbd">${CMD_ENTER}</span></span><button class="btn btn-primary" type="button" data-a="done">Done</button></div>`);
    wrap.appendChild(foot);
    const btns = () => foot.querySelectorAll('button');
    const submit = async (stuck) => {
      const text = ta.value.trim();
      if (!stuck && c.ask && !text) { Q.showToast('Answer the question first (or press “I’m stuck”)'); ta.focus(); return; }
      const payload = { cardId: c.id, text: text || undefined };
      if (stuck) payload.dontKnow = true;
      btns().forEach((b) => (b.disabled = true));
      if (!(await act('answer', payload))) btns().forEach((b) => (b.disabled = false));
    };
    foot.querySelector('[data-a=done]').onclick = () => submit(false);
    foot.querySelector('[data-a=stuck]').onclick = () => submit(true);
    T.active = { submit: () => submit(false), pick() {}, count: 0 };
    return wrap;
  }

  // ---------- start screen: labs ----------

  const stripEmoji = (s) => String(s || '').replace(/^\p{Extended_Pictographic}️?\s*/u, '');

  async function loadLabs(force) {
    const box = Q.$('tcLabs');
    if (!box) return;
    let data;
    try { data = await Q.api(`api/teach/labs${force ? '?force=1' : ''}`); } catch { box.innerHTML = ''; return; }
    const st = data.status || {};
    const name = st.mode === 'local' ? (st.hostname || 'This server') : (st.hostname || st.host || 'VM');
    const vm = st.ok
      ? `<span class="lab-dot on"></span><span title="Lessons folder: ${esc(st.root || '')}">${esc(name)} · ${esc(st.root || '')}</span>`
      : `<span class="lab-dot"></span><span title="${esc(st.error || '')}">${esc(st.mode === 'local' ? 'This server' : st.host || 'VM')} is offline</span><button type="button" data-a="retry">Check again</button>`;
    box.innerHTML = `<div class="list-header">Labs<span class="tc-vm">${vm}<button type="button" data-a="host" title="Where the lab terminal runs and its lessons folder">Change</button></span></div><div class="list tc-list"></div>`;
    const list = box.querySelector('.list');
    if (!data.labs.length) {
      list.innerHTML = `<div class="tc-msg">No labs yet. A lab is a markdown file in <code>Learning/&lt;Subject&gt;/Labs/</code>, with one section per step. Any lesson can also open the terminal from its toolbar.</div>`;
    }
    for (const l of data.labs) {
      const n = l.steps.length;
      const row = el(`<div class="list-row tc-labrow" role="button" tabindex="0">
        <span class="tc-labic">${icon('flask')}</span>
        <div class="grow"><div class="tc-lt">${esc(stripEmoji(l.title))}</div>
          <div class="tc-lm">${esc(l.subject)} · ${n} step${n === 1 ? '' : 's'}${l.session ? ` · ${l.done}/${n} done <span class="tc-prog">${l.steps.map((_, i) => `<i class="${i < l.done ? 'on' : ''}"></i>`).join('')}</span>` : ''}</div></div>
        <span class="btn btn-sm ${l.session ? '' : 'btn-tinted'}">${l.session ? 'Continue' : 'Start'}</span>
        <svg class="chevron" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5-5 5"/></svg>
      </div>`);
      row.onclick = () => startLab(l);
      row.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); startLab(l); } };
      list.appendChild(row);
    }
    const retry = box.querySelector('[data-a=retry]');
    if (retry) retry.onclick = () => { retry.disabled = true; retry.textContent = 'Checking…'; loadLabs(true); };
    box.querySelector('[data-a=host]').onclick = () => changeVm(st);
  }

  function startLab(l) {
    if (l.session) openSession(l.session);
    else start({ goal: l.goal || stripEmoji(l.title), subject: l.subject, labFile: l.id });
  }

  // Where the lab terminal runs (this server, or a machine over ssh) and the lessons folder.
  function changeVm(st) {
    let mode = st.mode === 'ssh' ? 'ssh' : 'local';
    const p = modal('vm', `<div class="tc-modal-head"><h2>Lab terminal</h2><p>Where lesson terminals run. Each lesson gets its own folder inside the lessons folder.</p></div>
      <div class="tc-modal-body">
        <div class="segmented" style="margin-bottom:12px">
          <button type="button" data-m="local">This server</button><button type="button" data-m="ssh">SSH machine</button>
        </div>
        <label class="set-hint" for="tcVmRoot">Lessons folder</label>
        <input class="field" id="tcVmRoot" value="${esc(st.root || '~/lessons')}" placeholder="~/lessons" autocomplete="off" spellcheck="false">
        <div data-ssh>
          <label class="set-hint" for="tcVmHost" style="display:block;margin-top:12px">SSH host, as you'd type it after <code>ssh</code>. It must log in with a key (no password prompt).</label>
          <input class="field" id="tcVmHost" value="${esc(st.mode === 'ssh' ? st.host || '' : '')}" placeholder="rocky" autocomplete="off" spellcheck="false">
        </div>
        <p class="set-hint" data-local>The shell runs on this server as your own user, so it can reach your files. Lessons stay in their folder; the teacher warns before anything that changes the system.</p>
      </div>
      <div class="tc-modal-foot"><span class="spacer"></span><button class="btn" data-a="cancel">Cancel</button><button class="btn btn-primary" data-a="save">Save and connect</button></div>`, 'small');
    const root = p.querySelector('#tcVmRoot'), host = p.querySelector('#tcVmHost');
    const show = () => {
      p.querySelectorAll('[data-m]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === mode)));
      p.querySelector('[data-ssh]').classList.toggle('hidden', mode !== 'ssh');
      p.querySelector('[data-local]').classList.toggle('hidden', mode !== 'local');
    };
    p.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { mode = b.dataset.m; show(); (mode === 'ssh' ? host : root).focus(); }; });
    show();
    root.focus(); root.select();
    const save = async () => {
      const b = p.querySelector('[data-a=save]');
      b.disabled = true;
      try {
        const body = { mode, root: root.value.trim() };
        if (mode === 'ssh') body.host = host.value.trim();
        const r = await Q.lab.api('api/lab/config', body);
        closeModal();
        Q.showToast(r.status && r.status.ok ? `Connected to ${r.status.hostname} · lessons in ${r.status.root}` : `Saved. ${r.status ? r.status.error : ''}`);
        loadLabs();
      } catch (e) { Q.showToast(e.message); b.disabled = false; }
    };
    p.querySelector('[data-a=save]').onclick = save;
    p.querySelector('[data-a=cancel]').onclick = closeModal;
    for (const inp of [root, host]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  }

  // ---------- save to vault ----------

  function openSave() {
    const v = T.view;
    if (!v) return;
    T.wantSave = true;   // an auto-prepared preview opens only when asked for
    if (v.savePreview) { T.shownPv = null; renderSave(v); }
    else if (v.autoSave && v.autoSave.state === 'preparing') Q.showToast('Still preparing your note and questions. The preview opens when it’s ready.');
    else act('save/preview', {});
  }

  function renderSave(v) {
    const pv = v.savePreview;
    if (!pv) { if (T.modal && T.modal.kind === 'save') closeModal(); T.shownPv = null; return; }
    if (T.shownPv === pv.id) return;   // shown once per preview; the menu reopens it
    T.shownPv = pv.id;
    // Prepared by itself at the end of the lesson: the banner offers it; the modal waits for Preview.
    if (pv.auto && !T.wantSave) return;
    T.wantSave = false;
    const warn = [];
    if (pv.newSubject) warn.push(`“${pv.subject}” is a new subject folder.`);
    if (pv.noteExists) warn.push(`A note called “${pv.noteTitle}” already exists. It won't be overwritten; only the questions are saved.`);
    if (pv.questionFileExists) warn.push(`The ${pv.count} new questions will be added to the end of the existing question file.`);
    const last = String(pv.count).padStart(3, '0');
    const p = modal('save', `<div class="tc-modal-head"><h2>Save to vault</h2><p>A study note and quiz questions from this lesson. Nothing is written until you choose Save to vault.</p></div>
      <div class="tc-modal-body">
        <div class="list">
          <div class="list-row">${icon('note')}<div class="grow"><div class="path">${esc(pv.notePath)}</div><div class="footnote">${pv.noteExists ? 'Already exists, will be kept as it is' : 'New study note'}</div></div></div>
          <div class="list-row">${icon('book')}<div class="grow"><div class="path">${esc(pv.questionPath)}</div><div class="footnote">${pv.count} questions, ids ${esc(pv.prefix)}-001 to ${esc(pv.prefix)}-${last}${pv.questionFileExists ? ', added to the existing file' : ''}</div></div></div>
        </div>
        ${warn.map((w) => `<div class="tc-banner">${icon('info')}<div class="grow">${esc(w)}</div></div>`).join('')}
        ${pv.problems && pv.problems.length ? `<div class="tc-banner">${icon('warning')}<div class="grow"><div class="t">Format problems the teacher couldn't fix</div>${pv.problems.map(esc).join('<br>')}</div></div>` : ''}
        <details class="tc-disc"><summary>${icon('chevron-right')}Study note<span class="n">${pv.note.split('\n').length} lines</span></summary><pre>${esc(pv.note)}</pre></details>
        <details class="tc-disc"><summary>${icon('chevron-right')}Questions<span class="n">${pv.count}</span></summary><pre>${esc(pv.questions)}</pre></details>
      </div>
      <div class="tc-modal-foot">
        <button class="btn btn-plain" type="button" data-a="redo">${icon('refresh')}Make a new preview</button><span class="spacer"></span>
        <button class="btn" type="button" data-a="discard">Discard</button><button class="btn btn-primary" type="button" data-a="write">Save to vault</button>
      </div>`);
    // Disabled while the save is in flight, so a double-click can't hit an already-used preview.
    const writeBtn = p.querySelector('[data-a=write]');
    const busy = (on) => p.querySelectorAll('.tc-modal-foot .btn').forEach((b) => (b.disabled = on));
    writeBtn.onclick = async () => {
      busy(true);
      writeBtn.innerHTML = '<span class="activity" style="width:14px;height:14px;border-top-color:#fff"></span>Saving…';
      if (!(await act('save/confirm', { previewId: pv.id }))) { busy(false); writeBtn.textContent = 'Save to vault'; }
    };
    p.querySelector('[data-a=discard]').onclick = async () => { busy(true); if (!(await act('save/discard', {}))) busy(false); };
    p.querySelector('[data-a=redo]').onclick = async () => { busy(true); closeModal(); T.shownPv = null; await act('save/preview', {}); };
    writeBtn.focus();
  }

  // The banner at the end of a lesson: preparing → ready (Save / Questions only / Preview) → saved.
  // "Not now" hides it for this lesson (saved on the server); Save to vault… in the menu still works.
  function renderAutoSave(v) {
    const box = Q.$('tcAutoSave');
    if (!box) return;
    const a = v.autoSave;
    const hide = !a || a.dismissed || (a.state === 'ready' && !v.savePreview) || (a.state === 'failed' && v.pending);
    const key = hide ? '' : JSON.stringify([a.state, a.count, a.saved, a.message, v.savePreview && v.savePreview.id, !!v.pending]);
    if (key === T.autoKey) return;
    T.autoKey = key;
    box.hidden = hide;
    box.className = 'tc-autosave' + (a && !hide ? ' ' + a.state : '');
    if (hide) { box.innerHTML = ''; return; }
    const notNow = '<button class="btn btn-plain btn-sm" type="button" data-a="dismiss">Not now</button>';
    const n = (k) => `${k} review question${k === 1 ? '' : 's'}`;
    const q = (k) => `${k} question${k === 1 ? '' : 's'}`;
    if (a.state === 'preparing') {
      box.setAttribute('role', 'status');
      box.innerHTML = `<span class="activity"></span><div class="msg"><div class="t">Preparing your study note and review questions…</div><div class="d">From this lesson and where you struggled. Nothing is written until you save.</div></div><div class="acts">${notNow}</div>`;
    } else if (a.state === 'ready') {
      const pv = v.savePreview;
      box.setAttribute('role', 'status');
      box.innerHTML = `${icon('note')}<div class="msg"><div class="t">${pv.noteExists ? `${n(a.count)} ready` : `Note + ${n(a.count)} ready`}</div><div class="d">${pv.noteExists ? `The note “${esc(pv.noteTitle)}” already exists and is kept` : esc(pv.notePath)} · <a href="#" data-a="preview">Preview</a></div></div>
        <div class="acts">${notNow}<button class="btn btn-sm" type="button" data-a="questions" title="Save only the review questions, not the note">Questions only</button><button class="btn btn-primary btn-sm" type="button" data-a="save">Save</button></div>`;
    } else if (a.state === 'saved') {
      const sv = a.saved;
      const where = sv.notePath ? (sv.noteUrl ? `<a href="${esc(sv.noteUrl)}" title="Open in Obsidian">${esc(sv.notePath)}</a>` : esc(sv.notePath)) : null;
      box.setAttribute('role', 'status');
      box.innerHTML = `${icon('check-circle')}<div class="msg"><div class="t">${sv.mode === 'questions' || !sv.noteWritten ? `${q(sv.count)} saved to review` : `Saved to ${where || 'your vault'} · ${q(sv.count)} in review`}</div>` +
        `<div class="d">${sv.mode === 'questions' || !sv.noteWritten ? `${esc(sv.questionPath || '')}${where ? ` · linked to ${where}` : ''}` : esc(sv.questionPath || '')}${sv.loaded !== sv.count ? ` · only ${sv.loaded} of ${sv.count} load in the quiz` : ''}</div></div>` +
        `<button class="x" type="button" data-a="dismiss" aria-label="Hide" title="Hide">${icon('close')}</button>`;
    } else if (a.state === 'failed') {
      box.setAttribute('role', 'alert');
      box.innerHTML = `${icon('warning')}<div class="msg"><div class="t">Couldn’t prepare the study note</div><div class="d">${esc(a.message || '')}</div></div><div class="acts">${notNow}<button class="btn btn-sm" type="button" data-a="retry">${icon('refresh')}Try again</button></div>`;
    }
    const on = (k, fn) => { const b = box.querySelector(`[data-a=${k}]`); if (b) b.onclick = fn; };
    const busy = (b, label) => { box.querySelectorAll('button').forEach((x) => (x.disabled = true)); if (label) b.innerHTML = `<span class="activity" style="width:13px;height:13px"></span>${label}`; };
    const undo = () => { T.autoKey = null; renderAutoSave(T.view); };
    on('dismiss', async (e) => { busy(e.currentTarget); if (!(await act('save/dismiss', {}))) undo(); });
    on('preview', (e) => { e.preventDefault(); openSave(); });
    on('retry', async (e) => { busy(e.currentTarget); if (!(await act('save/auto', {}))) undo(); });
    on('save', async (e) => { busy(e.currentTarget, 'Saving…'); if (!(await act('save/confirm', { previewId: v.savePreview.id }))) undo(); });
    on('questions', async (e) => { busy(e.currentTarget, 'Saving…'); if (!(await act('save/confirm', { previewId: v.savePreview.id, mode: 'questions' }))) undo(); });
  }

  function showSaveResult(r) {
    const files = [...r.written, ...r.appended.map((f) => `${f} (added to)`)];
    let msg = files.length ? `Saved ${files.join(', ')}` : 'Nothing was written';
    if (r.skipped.length) msg += `. Skipped: ${r.skipped.map((x) => `${x.file} (${x.reason})`).join(', ')}`;
    if (r.expected && r.loaded !== r.expected) msg += `. Only ${r.loaded} of ${r.expected} questions load in the quiz`;
    Q.showToast(msg);
  }

  // ---------- save for later: select text in a reply → To Learn, ask about it, or board it ----------
  // Selecting text inside one teacher turn (its prose or card) shows a small toolbar above it. Boards,
  // fields, the composer and the lab terminal are left alone. L = To Learn while a selection is shown.
  // Server side: tolearn.js (capture, capture/suggest); the lesson keeps its captures for the marks.
  const SEL_SKIP = '.bd, .excalidraw, canvas, textarea, input, select, button, .lab-pane, .tc-composer';
  const at = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement);
  function selInfo() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !T.view) return null;
    const ae = document.activeElement;
    if (ae && /^(TEXTAREA|INPUT|SELECT)$/.test(ae.tagName)) return null;
    const range = sel.getRangeAt(0);
    const a = at(range.startContainer), b = at(range.endContainer);
    const turnEl = a && a.closest('.tc-stream .tc-turn');
    if (!turnEl || !b || b.closest('.tc-turn') !== turnEl || !turnEl.dataset.turn) return null;   // one reply at a time
    if (a.closest(SEL_SKIP) || b.closest(SEL_SKIP)) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 3) return null;
    return { text: text.slice(0, 1500), turn: Number(turnEl.dataset.turn), range: range.cloneRange() };
  }
  // Fixed-position box above a rect (below it when there's no room, and always below on touch,
  // where the system's own selection menu sits above).
  function placeNear(node, rect) {
    const tb = document.querySelector('.tc-toolbar');
    const minTop = (tb ? tb.getBoundingClientRect().bottom : 0) + 8;
    const w = node.offsetWidth, h = node.offsetHeight;
    const touch = matchMedia('(pointer: coarse)').matches;
    let top = rect.top - h - 10;
    if (touch || top < minTop) top = rect.bottom + 10;
    node.style.top = Math.max(minTop, Math.min(top, innerHeight - h - 8)) + 'px';
    node.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
  }
  function selBar() {
    if (T.selBar && T.selBar.isConnected) return T.selBar;
    const bar = el(`<div class="tc-selbar" role="toolbar" aria-label="Selected text" hidden>
      <button type="button" data-a="learn" title="Save to To Learn (L)">${icon('bookmark-plus')}<span>To Learn</span><span class="tc-kbd">L</span></button>
      <span class="sep"></span>
      <button type="button" data-a="ask" title="Quote it in your question">${icon('chat')}<span class="long">Ask about this</span><span class="short">Ask</span></button>
      <button type="button" data-a="board" title="The teacher explains just this part on the board">${icon('board')}<span class="long">Explain on the board</span><span class="short">Board</span></button>
    </div>`);
    bar.addEventListener('mousedown', (e) => e.preventDefault());   // a click keeps the selection
    // A tap on a phone can collapse the selection before the click lands: remember what was selected.
    bar.addEventListener('pointerdown', () => { T.selKeep = T.sel; setTimeout(() => { T.selKeep = null; }, 800); });
    bar.querySelectorAll('button').forEach((b) => (b.onclick = () => selAction(b.dataset.a)));
    document.body.appendChild(bar);
    T.selBar = bar;
    return bar;
  }
  function showSel(info) {
    T.sel = info;
    const bar = selBar();
    const busy = !!(T.view && T.view.pending);
    bar.querySelector('[data-a=ask]').disabled = busy;
    bar.querySelector('[data-a=board]').disabled = busy;
    bar.hidden = false;
    placeSel();
  }
  function placeSel() {
    if (!T.sel || !T.selBar || T.selBar.hidden) return;
    const r = T.sel.range.getBoundingClientRect();
    const tb = document.querySelector('.tc-toolbar');
    const off = r.bottom < (tb ? tb.getBoundingClientRect().bottom : 0) || r.top > innerHeight;
    T.selBar.style.visibility = off ? 'hidden' : '';
    if (!off) placeNear(T.selBar, r);
  }
  function hideSel() {
    T.sel = null;
    if (T.selBar) T.selBar.hidden = true;
  }
  function checkSel() {
    if (T.selDown) return;   // still dragging with the mouse: wait for the release
    const info = document.body.classList.contains('teach-on') ? selInfo() : null;
    if (info) showSel(info); else hideSel();
  }
  let selTimer = null;
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(checkSel, 120); });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 0 && !(T.selBar && T.selBar.contains(e.target))) T.selDown = true;
  }, true);
  document.addEventListener('pointerup', () => { if (T.selDown) { T.selDown = false; setTimeout(checkSel, 0); } }, true);
  window.addEventListener('scroll', placeSel, true);
  window.addEventListener('resize', placeSel);

  function selAction(a) {
    const info = T.sel || T.selKeep;
    if (!info) return;
    if (a === 'learn') return openCapture(info);
    hideSel();
    getSelection().removeAllRanges();
    if (a === 'ask') {
      const ta = Q.$('tcAsk');
      if (!ta || ta.disabled) return;
      ta.value = `> "${info.text}"\n` + ta.value.replace(/^\s+/, '');
      ta.dispatchEvent(new Event('input'));   // grow + enable Send
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } else if (a === 'board') {
      const part = info.text.length > 800 ? info.text.slice(0, 800) + '…' : info.text;
      act('message', { text: `Explain this part on the board: "${part}"`, board: true, about: info.turn, ...(Q.live ? { live: true } : {}) });
    }
  }

  // The selection as a fallback title (when Claude can't name it): trimmed to 70 characters.
  function rawTitle(text) {
    const t = text.replace(/^[>"“'\s]+|["”'\s]+$/g, '');
    return t.length <= 70 ? t : t.slice(0, 69).replace(/\s+\S*$/, '') + '…';
  }
  function closeCapture() {
    if (!T.capture) return;
    const c = T.capture;
    T.capture = null;
    c.close();
  }
  // The save popover: title (Claude's name for it replaces the raw text when it arrives, unless he
  // already typed), the list, Save. Enter saves, Esc or a click outside closes.
  async function openCapture(info) {
    const v = T.view;
    if (!v) return;
    const rect = T.selBar && !T.selBar.hidden ? T.selBar.getBoundingClientRect() : info.range.getBoundingClientRect();
    hideSel();
    closeCapture();
    const raw = rawTitle(info.text);
    const p = el(`<div class="tc-capture" role="dialog" aria-label="Save to To Learn">
      <div class="tc-cap-head">${icon('bookmark-plus')}<span>Save to To Learn</span></div>
      <input class="field" type="text" maxlength="120" aria-label="Title" spellcheck="true">
      <div class="tc-cap-note"><span class="activity"></span><span>The AI is naming it…</span></div>
      <label class="tc-cap-list"><span>List</span><select class="field" aria-label="List"><option value="">Loading…</option></select></label>
      <div class="tc-cap-foot"><button class="btn btn-sm" type="button" data-a="cancel">Cancel</button><button class="btn btn-primary btn-sm" type="button" data-a="save">Save</button></div>
    </div>`);
    const input = p.querySelector('input'), sel = p.querySelector('select'), note = p.querySelector('.tc-cap-note');
    input.value = raw;
    document.body.appendChild(p);
    placeNear(p, rect);
    // Select it all, but keep the start of the title in view.
    const selectAll = () => { input.setSelectionRange(0, input.value.length, 'backward'); input.scrollLeft = 0; };
    input.focus();
    selectAll();
    const st = { edited: false, named: null, newTitle: 'From lessons' };
    input.addEventListener('input', () => { st.edited = true; });
    const outside = (e) => { if (!p.contains(e.target)) closeCapture(); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    T.capture = { el: p, close() { p.remove(); document.removeEventListener('pointerdown', outside, true); } };

    Q.api(`api/tolearn/capture?lesson=${encodeURIComponent(v.id)}`).then((d) => {
      st.newTitle = d.newTitle || st.newTitle;
      const opts = d.lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`);
      if (!d.lists.some((l) => l.title === st.newTitle)) opts.push(`<option value="new">New list: ${esc(st.newTitle)}</option>`);
      sel.innerHTML = opts.join('');
      sel.value = d.defaultList;
      if (!sel.value) sel.selectedIndex = 0;
    }).catch(() => { sel.innerHTML = `<option value="new">New list: ${esc(st.newTitle)}</option>`; });
    Q.api('api/tolearn/capture/suggest', { text: info.text, lessonId: v.id, turn: info.turn }).then((r) => {
      if (!p.isConnected) return;
      st.named = r;
      if (!st.edited) { input.value = r.title; if (document.activeElement === input) selectAll(); }
      note.innerHTML = r.detail ? `<span>${esc(r.detail)}</span>` : '';
    }).catch(() => {
      if (p.isConnected) note.innerHTML = '<span>Couldn’t name it, so it keeps your selection as the title.</span>';
    });

    const save = async () => {
      const title = input.value.trim();
      if (!title) { input.focus(); return; }
      const btn = p.querySelector('[data-a=save]');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const r = await Q.api('api/tolearn/capture', {
          lessonId: v.id, turn: info.turn, text: info.text, title, kind: 'selection',
          detail: st.named ? st.named.detail : '',
          listId: sel.value || 'new', newListTitle: st.newTitle,
          refine: !st.named && !st.edited,   // saved before the AI named it: the server names it afterwards
        });
        closeCapture();
        getSelection().removeAllRanges();
        savedCapture(r);
      } catch (e) { btn.disabled = false; Q.showToast(e.message); }
    };
    p.querySelector('[data-a=save]').onclick = save;
    p.querySelector('[data-a=cancel]').onclick = closeCapture;
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); save(); }
    });
  }

  // After a save: the lesson's marks and chips update, and a toast offers to open the item.
  function savedCapture(r) {
    if (T.view && r.captures) T.view.captures = r.captures;
    if (T.view) { applyMarks(T.view); syncLaterChips(T.view); }
    toastLink(`Saved to “${r.list.title}”`, 'Open', () => openToLearn(r.list.id, r.item.id));
  }
  function openToLearn(listId, itemId) {
    if (document.body.classList.contains('teach-on')) back();
    if (Q.toLearn) Q.toLearn.show(listId, itemId); else Q.setTab('tolearn');
  }
  // The app's toast (index.html #toast) with a link button after the text.
  function toastLink(text, label, run) {
    const t = Q.$('toast');
    if (!t) return Q.showToast(text);
    Q.showToast(text);   // shows it and starts the app's own hide timer
    const b = el(`<button type="button" class="tc-toastlink">${esc(label)}</button>`);
    b.onclick = () => { t.classList.add('hidden'); run(); };
    t.appendChild(b);
  }

  // Underline saved passages in their turn and add an "In To Learn" marker. Best effort: the quote is
  // looked up ignoring whitespace (a selection across paragraphs has newlines the DOM text doesn't).
  function applyMarks(v) {
    const box = document.querySelector('.tc-stream');
    if (!box) return;
    for (const c of v.captures || []) {
      if (!c.quote || !Number.isInteger(c.turn)) continue;
      const turnEl = box.querySelector(`.tc-turn[data-turn="${c.turn}"]`);
      const key = `${c.listId}/${c.itemId}`;
      if (!turnEl || [...turnEl.querySelectorAll('[data-cap]')].some((x) => x.dataset.cap === key)) continue;
      try { markQuote(turnEl, c, key); } catch (e) { console.warn('[teach] mark', e); }
    }
  }
  function markQuote(root, c, key) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.bd, button, textarea, .tc-tools, .tc-later') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let flat = '';
    const map = [];   // flat[i] came from map[i] = [text node, offset]
    for (let n; (n = walker.nextNode());) {
      const d = n.data;
      for (let i = 0; i < d.length; i++) if (!/\s/.test(d[i])) { flat += d[i]; map.push([n, i]); }
    }
    const q = c.quote.replace(/\s+/g, '').replace(/…$/, '');
    const i0 = q ? flat.indexOf(q) : -1;
    if (i0 < 0) return false;
    const spans = new Map();   // text node → [from, to)
    for (let k = i0; k < i0 + q.length; k++) {
      const [n, off] = map[k];
      const s = spans.get(n);
      spans.set(n, s ? [s[0], off + 1] : [off, off + 1]);
    }
    let last = null;
    for (const [n, [from, to]] of spans) {
      const mid = n.splitText(from);
      mid.splitText(to - from);
      const m = document.createElement('mark');
      m.className = 'tc-cap';
      m.dataset.cap = key;
      mid.replaceWith(m);
      m.appendChild(mid);
      last = m;
    }
    const tag = el(`<button type="button" class="tc-inlearn" data-cap="${esc(key)}" title="${esc(c.title || '')}">${icon('bookmark')}In To Learn</button>`);
    tag.onclick = () => openToLearn(c.listId, c.itemId);
    last.after(tag);
    return true;
  }

  // The teacher's "later" topics under its reply: one click saves each to the default list.
  function laterChips(v, it) {
    const row = el('<div class="tc-later"></div>');
    for (const x of it.later) {
      const b = el('<button type="button" class="tc-later-chip"></button>');
      b.dataset.turn = it.turn;
      b.dataset.title = x.title;
      if (x.why) b.title = x.why;
      paintLater(b, v);
      b.onclick = async () => {
        const saved = savedLater(T.view, it.turn, x.title);
        if (saved) return openToLearn(saved.listId, saved.itemId);
        b.disabled = true;
        try {
          savedCapture(await Q.api('api/tolearn/capture', { lessonId: v.id, turn: it.turn, kind: 'later', title: x.title, why: x.why || '' }));
        } catch (e) { Q.showToast(e.message); }
        b.disabled = false;
      };
      row.appendChild(b);
    }
    return row;
  }
  const savedLater = (v, turn, title) => ((v && v.captures) || []).find((c) => c.turn === turn && c.later === title);
  function paintLater(b, v) {
    const saved = savedLater(v, Number(b.dataset.turn), b.dataset.title);
    b.classList.toggle('saved', !!saved);
    b.innerHTML = saved ? `${icon('check')}<span>Saved “${esc(b.dataset.title)}” · In To Learn</span>` : `${icon('bookmark-plus')}<span>Save “${esc(b.dataset.title)}” for later</span>`;
  }
  function syncLaterChips(v) { document.querySelectorAll('.tc-stream .tc-later-chip').forEach((b) => paintLater(b, v)); }

  // ---------- keyboard: 1–5 pick an option, ⌘/Ctrl+Enter submit, Esc closes ----------
  // Capture phase on window, so the quiz page's own shortcuts (reveal, rate) don't fire under a lesson.
  window.addEventListener('keydown', (e) => {
    // The save popover and the selection toolbar come first: Esc closes them, L saves the selection.
    if (e.key === 'Escape' && T.capture) { e.preventDefault(); e.stopPropagation(); closeCapture(); return; }
    if (T.capture) return;   // its own fields handle keys
    if (e.key === 'Escape' && T.sel) { e.preventDefault(); e.stopPropagation(); hideSel(); getSelection().removeAllRanges(); return; }
    if (T.sel && (e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      && !['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName)) {
      e.preventDefault(); e.stopPropagation(); openCapture(T.sel); return;
    }
    if (e.key === 'Escape' && (T.menu || T.modal)) {
      e.preventDefault(); e.stopPropagation();
      if (T.menu) closeMenu(); else closeModal();
      return;
    }
    if (!T.view || !document.body.classList.contains('teach-on')) return;
    if (T.modal) return;   // the modal's own fields and buttons handle keys
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.lab-pane')) return;   // keys belong to the terminal (Esc, Ctrl-C, vim…)
    if (e.key === 'Escape' && document.querySelector('.tc-inspector.open')) { e.stopPropagation(); setInspector(false); return; }
    const typing = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (document.activeElement && document.activeElement.id === 'tcAsk') return sendAsk();
      if (T.active && T.active.reveal && T.active.reveal()) return;
      if (T.active && !T.view.pending) T.active.submit();
      return;
    }
    if (!typing && /^[1-5]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.stopPropagation();
      if (T.active && T.active.count && !(T.active.reveal && T.active.reveal())) T.active.pick(Number(e.key) - 1);
    }
  }, true);
  window.addEventListener('resize', closeMenu);

  // ---------- wiring ----------

  Q.on('tab', (name) => { if (name === 'teach') renderPanel(); });
  // For the sidebar's "Lessons" list in index.html.
  Q.teach = { open: (id) => openSession(id) };

  // From another app (the NVIDIA plan's lab tasks): /quiz/?lab=<task text>. Opens the matching lab
  // file (resuming its lesson), else a lesson already built on that task, else a new improvised lab.
  window.addEventListener('quiz:lab', async (e) => {
    const d = e.detail || {};
    if (!d.task) return;
    if (document.body.classList.contains('teach-on')) back();
    Q.setTab('teach');
    await renderPanel();
    try {
      const data = await Q.api(`api/teach/labs?task=${encodeURIComponent(d.task)}`);
      const l = data.match && data.labs.find((x) => x.id === data.match);
      if (l) return startLab(l);
      const { sessions } = await Q.api('api/teach/sessions');
      const old = sessions.find((x) => x.lab && !x.lab.file && x.lab.task === d.task);
      if (old) return openSession(old.id);
      start({ goal: d.task, subject: d.subject || null, labTask: d.task });
    } catch (err) { Q.showToast(err.message); }
  });

  // From map nodes and Study-next gap cards: switch to Teach and start a session on that goal.
  window.addEventListener('quiz:teach', (e) => {
    const d = e.detail || {};
    if (document.body.classList.contains('teach-on')) back();
    Q.setTab('teach');
    T.prefill = { gapId: d.gapId || null, topic: d.topic || null, subject: d.subject || null, noteTitle: d.noteTitle || null };
    const fill = async () => {
      await renderPanel();
      if (Q.$('tcGoal')) { Q.$('tcGoal').value = d.goal || ''; Q.$('tcGoal').dispatchEvent(new Event('input')); }
      if (d.subject && Q.$('tcSubject')) { Q.$('tcSubject').value = d.subject; fillNotes(d.noteTitle || ''); }
      renderSource();
      if (d.goal) start({ ...d });
      else if (Q.$('tcGoal')) Q.$('tcGoal').focus();
    };
    fill();
  });

  if (urlLesson()) {
    // A lesson link: open it whatever tab was last used.
    Q.setTab('teach');
    openSession(urlLesson());
  } else if (Q.tab === 'teach') {
    renderPanel();
    const open = localStorage.getItem('teach.open');
    if (open) openSession(open);
  }
})();
