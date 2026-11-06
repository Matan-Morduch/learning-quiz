#!/usr/bin/env bash
# One-off, dev-time build of the vendored CodeMirror 6 editor (ui/vendor/codemirror/) for the
# Interview tab. The app never runs npm: this script's OUTPUT is committed, and ui/editor.js loads it
# as a plain ES module (`import('vendor/codemirror/codemirror.js')`).
#
# Rebuild (e.g. to bump a version): edit the pinned versions below, then
#   bash tools/build-codemirror.sh
# and commit ui/vendor/codemirror/. Needs node + npm + network, only while building.
#
# On purpose there is no autocomplete, linting or search panel: the interview editor is like CoderPad
# (highlighting, auto-indent, brackets, undo). closeBrackets lives in @codemirror/autocomplete, so that
# package is bundled, but only closeBrackets is exported.
set -euo pipefail

STATE=6.4.1
VIEW=6.26.3
LANGUAGE=6.10.1
COMMANDS=6.5.0
AUTOCOMPLETE=6.16.0
PYTHON=6.1.6
ESBUILD=0.25.10

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/ui/vendor/codemirror"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund --save-exact \
  "@codemirror/state@$STATE" "@codemirror/view@$VIEW" "@codemirror/language@$LANGUAGE" \
  "@codemirror/commands@$COMMANDS" "@codemirror/autocomplete@$AUTOCOMPLETE" \
  "@codemirror/lang-python@$PYTHON" "esbuild@$ESBUILD"

# One copy of @codemirror/state, or extensions silently stop working together.
n=$(find node_modules -path '*/@codemirror/state/package.json' | wc -l)
[ "$n" = 1 ] || { echo "expected one @codemirror/state, found $n" >&2; exit 1; }

cat > entry.js <<'JS'
export { EditorState, Compartment } from '@codemirror/state';
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder } from '@codemirror/view';
export { indentUnit, indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
export { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
export { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
export { python } from '@codemirror/lang-python';
export { tags } from '@lezer/highlight';
JS

rm -rf "$OUT"
mkdir -p "$OUT"
node_modules/.bin/esbuild entry.js --bundle --format=esm --minify --target=es2020 \
  --legal-comments=none --log-level=warning --outfile="$OUT/codemirror.js"
cat > "$OUT/VERSION" <<TXT
@codemirror/state $STATE · view $VIEW · language $LANGUAGE · commands $COMMANDS · autocomplete $AUTOCOMPLETE · lang-python $PYTHON (all MIT)
bundled with esbuild $ESBUILD by tools/build-codemirror.sh on $(date +%Y-%m-%d)
TXT
du -sh "$OUT"
