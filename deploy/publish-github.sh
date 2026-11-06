#!/usr/bin/env bash
# Publishes the committed main to the public GitHub repo as one new commit, without this repo's history
# (it has test transcripts and machine names). The public copy is what the Windows installer downloads.
# Files marked export-ignore in .gitattributes are left out. Needs `gh auth login` once.
#   deploy/publish-github.sh              # → <your GitHub login>/learning-quiz (created public on first run)
#   deploy/publish-github.sh owner/name
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$(pwd)"
GH="$(command -v gh || echo "$HOME/.local/bin/gh")"
"$GH" auth status >/dev/null 2>&1 || { echo "Sign in first: $GH auth login" >&2; exit 1; }
LOGIN="$("$GH" api user --jq .login)"
ID="$("$GH" api user --jq .id)"
REPO="${1:-$LOGIN/learning-quiz}"
[[ -z "$(git status --porcelain)" ]] || echo "Note: uncommitted changes are not published (only HEAD is)." >&2
if ! "$GH" repo view "$REPO" >/dev/null 2>&1; then
  "$GH" repo create "$REPO" --public --description "Learning app: spaced-repetition quizzes, AI teacher and mock interviews. Runs on Claude Code or Gemini."
fi
"$GH" auth setup-git >/dev/null
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
git clone -q "https://github.com/$REPO.git" "$WORK/pub" 2>/dev/null || { mkdir -p "$WORK/pub"; git -C "$WORK/pub" init -q -b main; git -C "$WORK/pub" remote add origin "https://github.com/$REPO.git"; }
cd "$WORK/pub"
git checkout -q -B main
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$SRC" archive --format=tar HEAD | tar -x -C .
git add -A
if git diff --cached --quiet; then echo "GitHub is already up to date ($REPO)."; exit 0; fi
SHA="$(git -C "$SRC" rev-parse --short HEAD)"
git -c user.name="$LOGIN" -c user.email="$ID+$LOGIN@users.noreply.github.com" commit -q -m "Update to $SHA"
git push -q origin main
echo "Published $SHA to https://github.com/$REPO"
