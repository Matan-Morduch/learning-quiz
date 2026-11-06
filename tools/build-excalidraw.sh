#!/usr/bin/env bash
# One-off, dev-time build of the vendored Excalidraw canvas (ui/vendor/excalidraw/).
# The app itself never runs npm: this script's OUTPUT is committed, and the browser loads it as
# plain ES modules (ui/canvas.js does `import('vendor/excalidraw/excalidraw.js')`).
#
# Rebuild (e.g. to bump a version): edit the pinned versions below, then
#   bash tools/build-excalidraw.sh
# and commit ui/vendor/excalidraw/. Needs node + npm + network, only while building.
#
# What it produces:
#   excalidraw.js        ESM entry: export { React, createRoot, ...@excalidraw/excalidraw }
#   chunk-*.js           code-split chunks (the font-subset worker loads one of them as a module Worker)
#   excalidraw.css       Excalidraw's stylesheet
#   fonts/<Family>/…     woff2 fonts (window.EXCALIDRAW_ASSET_PATH points at this folder)
# Left out on purpose (would add ~14 MB): the Xiaolai CJK font, the 50+ UI translations (English
# only) and the Mermaid-to-diagram converter. Those code paths fail only if someone uses them.
set -euo pipefail

EXCALIDRAW=0.18.1
REACT=18.3.1
ESBUILD=0.25.10

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/ui/vendor/excalidraw"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund --save-exact \
  "@excalidraw/excalidraw@$EXCALIDRAW" "react@$REACT" "react-dom@$REACT" "esbuild@$ESBUILD"

cat > entry.js <<'JS'
import * as React from 'react';
import { createRoot } from 'react-dom/client';
export * from '@excalidraw/excalidraw';
export { React, createRoot };
JS

cat > build.mjs <<'JS'
import * as esbuild from 'esbuild';
const drop = {
  name: 'drop-extras',
  setup(b) {
    // Non-English UI translations and Mermaid: left as unresolved dynamic imports (never loaded).
    b.onResolve({ filter: /\/locales\/[\w-]+\.js$/ }, (a) => (/\/en-\w+\.js$/.test(a.path) ? undefined : { path: a.path, external: true }));
    b.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, (a) => ({ path: a.path, external: true }));
  },
};
await esbuild.build({
  entryPoints: { excalidraw: 'entry.js' },
  bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2020',
  outdir: process.argv[2], chunkNames: 'chunk-[hash]',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"', 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' },
  conditions: ['production'],
  plugins: [drop],
  legalComments: 'none',
  logLevel: 'warning',
});
JS

rm -rf "$OUT"
mkdir -p "$OUT"
node build.mjs "$OUT"
PKG=node_modules/@excalidraw/excalidraw/dist/prod
cp "$PKG/index.css" "$OUT/excalidraw.css"
mkdir -p "$OUT/fonts"
for f in "$PKG"/fonts/*; do
  [ "$(basename "$f")" = Xiaolai ] && continue
  cp -R "$f" "$OUT/fonts/"
done
cat > "$OUT/VERSION" <<TXT
@excalidraw/excalidraw $EXCALIDRAW (MIT) · react $REACT (MIT) · react-dom $REACT (MIT)
bundled with esbuild $ESBUILD by tools/build-excalidraw.sh on $(date +%Y-%m-%d)
TXT
du -sh "$OUT"
