// Python code editor for the Interview tab: CodeMirror 6, like CoderPad in a real interview.
// Highlighting, line numbers, auto-indent (4 spaces, Tab indents), bracket matching/closing, undo.
// On purpose: no autocomplete, no linting, no run button.
//
//   const ed = Quiz.editor.mount(host, { doc, readOnly, onChange(text), onPause(text), pauseMs })
//     onChange fires on every edit; onPause once typing stops for pauseMs (default 1500), which is
//     when the interview takes a code snapshot.
//   await ed.ready; ed.get() → text; ed.set(text) (replay: replaces the doc, keeps no undo for it);
//   ed.focus(); ed.typing() → true while keys were pressed in the last ~600 ms (hands-free uses it to
//   ignore keyboard noise); ed.dispose()
//
// CodeMirror is vendored as one ES module in ui/vendor/codemirror/ (tools/build-codemirror.sh) and
// loaded on first mount. Colours come from the app's CSS tokens, so light/dark follow the theme.
(function () {
  const Q = (window.Quiz = window.Quiz || {});
  const BASE = new URL('.', (document.currentScript && document.currentScript.src) || location.href);
  const SRC = new URL('vendor/codemirror/codemirror.js', BASE).href;

  let libP = null;
  const load = () => (libP = libP || import(SRC));

  function extensions(cm, opts, onDoc) {
    const t = cm.tags;
    const style = cm.HighlightStyle.define([
      { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--purple)' },
      { tag: [t.string, t.special(t.string)], color: 'var(--green)' },
      { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--orange)' },
      { tag: [t.comment, t.lineComment], color: 'var(--label-3)', fontStyle: 'italic' },
      { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--blue)' },
      { tag: [t.className, t.definition(t.className), t.standard(t.variableName)], color: 'var(--teal)' },
      { tag: [t.self, t.special(t.variableName)], color: 'var(--pink)' },
      { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--label-2)' },
    ]);
    const theme = cm.EditorView.theme({
      '&': { height: '100%', fontSize: '14px', color: 'var(--label)', backgroundColor: 'var(--surface)' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
      '.cm-content': { caretColor: 'var(--accent)', padding: '12px 0' },
      '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--label-3)', border: 'none', paddingLeft: '6px' },
      '.cm-activeLine': { backgroundColor: 'var(--fill)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--label-2)' },
      '&.cm-focused': { outline: 'none' },
      '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-tint) !important' },
      '.cm-matchingBracket': { backgroundColor: 'var(--fill-hover)', outline: '1px solid var(--separator-strong)' },
    });
    return [
      cm.lineNumbers(), cm.highlightActiveLineGutter(), cm.highlightActiveLine(), cm.drawSelection(),
      cm.history(), cm.indentOnInput(), cm.bracketMatching(), cm.closeBrackets(),
      cm.indentUnit.of('    '), cm.EditorState.tabSize.of(4),
      cm.python(), cm.syntaxHighlighting(style), theme,
      cm.keymap.of([...cm.closeBracketsKeymap, ...cm.defaultKeymap, ...cm.historyKeymap, cm.indentWithTab]),
      cm.EditorState.readOnly.of(!!opts.readOnly), cm.EditorView.editable.of(!opts.readOnly),
      // No spellcheck/autocorrect squiggles from the browser either.
      cm.EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      cm.EditorView.updateListener.of((u) => { if (u.docChanged) onDoc(u.state.doc.toString()); }),
      opts.placeholder ? cm.placeholder(opts.placeholder) : [],
    ];
  }

  function mount(host, opts = {}) {
    const pauseMs = opts.pauseMs || 1500;
    let view = null, disposed = false, pauseTimer = null, lastKey = 0, silent = false;
    const onKey = () => { lastKey = Date.now(); };
    host.addEventListener('keydown', onKey, true);
    const onDoc = (text) => {
      if (silent) return;
      if (opts.onChange) opts.onChange(text);
      if (opts.onPause) { clearTimeout(pauseTimer); pauseTimer = setTimeout(() => !disposed && opts.onPause(text), pauseMs); }
    };
    const api = {
      ready: load().then((cm) => {
        if (disposed) return;
        view = new cm.EditorView({ parent: host, state: cm.EditorState.create({ doc: opts.doc || '', extensions: extensions(cm, opts, onDoc) }) });
      }),
      get: () => (view ? view.state.doc.toString() : opts.doc || ''),
      set(text) {
        if (!view) { opts.doc = text; return; }
        silent = true;
        try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text || '' } }); } finally { silent = false; }
      },
      focus() { if (view) view.focus(); },
      typing: () => Date.now() - lastKey < 600,
      dispose() {
        disposed = true; clearTimeout(pauseTimer);
        host.removeEventListener('keydown', onKey, true);
        if (view) view.destroy();
        view = null;
      },
    };
    return api;
  }

  Q.editor = { mount, load };
})();
