#!/usr/bin/env bash
# The Gemini CLI for the AI engine "Gemini" (Settings → AI). No sudo: it goes into its own folder.
#   tools/gemini/install.sh            # install or update (≈ 100 MB)
#   tools/gemini/install.sh --login    # sign in with your Google account (once; installs first if needed)
#   tools/gemini/install.sh --remove   # delete it (your sign-in in ~/.gemini stays)
# Goes to $QUIZ_GEMINI_HOME (default ~/.local/share/gemini-cli). llm.js finds it there.
set -euo pipefail
DIR="${QUIZ_GEMINI_HOME:-$HOME/.local/share/gemini-cli}"
BIN="$DIR/node_modules/.bin/gemini"
case "${1:-}" in
  --remove) rm -rf "$DIR"; echo "Removed $DIR"; exit 0 ;;
esac
if ! command -v npm >/dev/null; then echo "npm (Node.js) is needed first" >&2; exit 1; fi
if [[ ! -x "$BIN" || "${1:-}" != "--login" ]]; then
  mkdir -p "$DIR"
  npm install --silent --no-fund --no-audit --prefix "$DIR" @google/gemini-cli@latest
  echo "Gemini CLI $("$BIN" --version 2>/dev/null) ready in $DIR"
fi
if [[ "${1:-}" == "--login" ]]; then
  if [[ -f "$HOME/.gemini/oauth_creds.json" ]]; then echo "Already signed in (~/.gemini/oauth_creds.json). Delete that file to sign in with another account."; exit 0; fi
  echo
  echo "Choose \"Sign in with Google\", open the link it prints, approve, and paste the code back here."
  echo "Use the Google account that has your Gemini plan. When it shows the chat prompt, type /quit."
  echo
  # A server has no browser: NO_BROWSER makes it print the link and ask for the code.
  cd "$(mktemp -d)" && NO_BROWSER=true "$BIN"
  [[ -f "$HOME/.gemini/oauth_creds.json" ]] && echo "Signed in. Pick Gemini in Settings → AI." || echo "Not signed in yet: run this again."
fi
