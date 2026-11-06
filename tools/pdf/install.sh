#!/usr/bin/env bash
# Installs the PDF reader for Teach materials (PyMuPDF in its own small venv, ≈ 60 MB). No sudo.
#   tools/pdf/install.sh            # install or repair
#   tools/pdf/install.sh --remove   # delete it
# Goes to $QUIZ_PDF_HOME (default ~/.local/share/quiz-pdf). materials.js finds it there.
set -euo pipefail
HOME_DIR="${QUIZ_PDF_HOME:-$HOME/.local/share/quiz-pdf}"
if [[ "${1:-}" == "--remove" ]]; then rm -rf "$HOME_DIR"; echo "Removed $HOME_DIR"; exit 0; fi
if ! command -v uv >/dev/null; then
  if [[ "$(uname -s)" == Darwin ]]; then brew install uv
  else curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"; fi
fi
mkdir -p "$HOME_DIR"
[[ -x "$HOME_DIR/venv/bin/python" ]] || uv venv -q -p 3.12 "$HOME_DIR/venv"
uv pip install -q -p "$HOME_DIR/venv/bin/python" "pymupdf==2.1"
"$HOME_DIR/venv/bin/python" -c "import pymupdf; print('PyMuPDF', pymupdf.__version__, 'ready in $HOME_DIR')"
