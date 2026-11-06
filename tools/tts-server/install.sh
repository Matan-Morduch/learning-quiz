#!/usr/bin/env bash
# Installs the free local voice (Kokoro-82M) for the quiz app.
#   tools/tts-server/install.sh            # install or repair
#   tools/tts-server/install.sh --remove   # delete it (≈ 0.8 GB on a Mac, ≈ 0.7 GB CPU / ≈ 3.5–4 GB CUDA on Linux)
# Everything goes to $QUIZ_TTS_HOME (default ~/.local/share/quiz-tts): a uv-managed Python 3.12 venv with
# pinned packages and the model + English voices (model/).
#   macOS (Apple Silicon): Kokoro on MLX (requirements.txt). Needs Homebrew (uv + ffmpeg installed with it if missing).
#   Linux x86_64: Kokoro on ONNX Runtime, CUDA if an NVIDIA GPU + driver is present (requirements-linux-cuda.txt),
#     else CPU (requirements-linux.txt). $QUIZ_TTS_GPU=cpu|cuda overrides the choice.
#     Needs ffmpeg + curl (sudo apt-get install -y ffmpeg curl ca-certificates); uv is installed to ~/.local/bin
#     with its official script if missing. No sudo is run here. espeak-ng comes bundled (espeakng-loader).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${QUIZ_TTS_HOME:-$HOME/.local/share/quiz-tts}"

if [[ "${1:-}" == "--remove" ]]; then
  pkill -f "tts-server/server.py" 2>/dev/null || true
  rm -rf "$HOME_DIR"; echo "Removed $HOME_DIR"; exit 0
fi

# espeak-ng keeps its data path in a 160-byte buffer: a longer venv path silently breaks the phoneme fallback.
ESPEAK_DATA="$HOME_DIR/venv/lib/python3.12/site-packages/espeakng_loader/espeak-ng-data"
(( ${#ESPEAK_DATA} < 150 )) || { echo "QUIZ_TTS_HOME is too long a path for espeak-ng (${#ESPEAK_DATA} chars inside it): pick a shorter one." >&2; exit 1; }

OS="$(uname -s)-$(uname -m)"
case "$OS" in
  Darwin-arm64)
    REQ="$HERE/requirements.txt"; ENGINE=kokoro-mlx
    command -v uv >/dev/null || brew install uv
    command -v ffmpeg >/dev/null || [[ -x /opt/homebrew/bin/ffmpeg ]] || brew install ffmpeg
    ;;
  Linux-x86_64)
    ENGINE=kokoro-onnx
    missing=()
    command -v ffmpeg >/dev/null || missing+=(ffmpeg)
    command -v curl >/dev/null || missing+=(curl)
    if (( ${#missing[@]} )); then
      echo "Missing: ${missing[*]}. Install with:  sudo apt-get install -y ffmpeg curl ca-certificates" >&2; exit 1
    fi
    if ! command -v uv >/dev/null; then
      if [[ -x "$HOME/.local/bin/uv" ]]; then export PATH="$HOME/.local/bin:$PATH"
      else
        echo "→ uv (official installer, into ~/.local/bin)"
        curl -LsSf https://astral.sh/uv/0.13.6/install.sh | env UV_NO_MODIFY_PATH=1 sh
        export PATH="$HOME/.local/bin:$PATH"
      fi
    fi
    GPU="${QUIZ_TTS_GPU:-auto}"
    if [[ "$GPU" == auto ]]; then
      if command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then GPU=cuda; else GPU=cpu; fi
    fi
    if [[ "$GPU" == cuda ]]; then
      REQ="$HERE/requirements-linux-cuda.txt"
      DRV="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || true)"
      echo "→ NVIDIA: $(nvidia-smi --query-gpu=name,compute_cap --format=csv,noheader 2>/dev/null | head -1 || echo '?'), driver ${DRV:-?}"
      [[ -z "$DRV" || "${DRV%%.*}" -ge 570 ]] || echo "  ! driver $DRV is older than 570 (CUDA 12.8): CUDA may fail and the voice will use the CPU." >&2
    else
      REQ="$HERE/requirements-linux.txt"
      echo "→ no NVIDIA GPU in use: CPU voice"
    fi
    ;;
  *) echo "The local voice supports Apple Silicon Macs and Linux x86_64 (this is $OS)." >&2; exit 1 ;;
esac

mkdir -p "$HOME_DIR"
echo "→ Python 3.12 venv in $HOME_DIR/venv"
uv venv --allow-existing --python 3.12 "$HOME_DIR/venv"
echo "→ packages (pinned: $(basename "$REQ"))"
VIRTUAL_ENV="$HOME_DIR/venv" uv pip sync "$REQ"
echo "→ model + English voices"
"$HOME_DIR/venv/bin/python" "$HERE/server.py" --home "$HOME_DIR" --download
echo "→ test"
PORT=8799
"$HOME_DIR/venv/bin/python" "$HERE/server.py" --home "$HOME_DIR" --port $PORT --idle 60 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
H=""
for _ in $(seq 1 240); do
  H=$(curl -sf "http://127.0.0.1:$PORT/health" || true)
  grep -q '"ready": true' <<<"$H" && break
  grep -q '"ok": false' <<<"$H" && { echo "Model failed to load: $H" >&2; exit 1; }
  sleep 0.5
done
curl -sf -X POST "http://127.0.0.1:$PORT/tts" -H 'Content-Type: application/json' \
  -d '{"text":"The local voice is ready.","voice":"bm_george"}' -o "$HOME_DIR/test.mp3"
[[ -s "$HOME_DIR/test.mp3" ]] || { echo "Test synthesis failed" >&2; exit 1; }
BACKEND=$(sed -n 's/.*"backend": "\([a-z-]*\)".*/\1/p' <<<"$H")
NOTE=$(sed -n 's/.*"note": "\([^"]*\)".*/\1/p' <<<"$H")
[[ "${GPU:-}" == cuda && "$BACKEND" != onnx-cuda ]] && echo "  ! GPU not used: ${NOTE:-see $HOME_DIR/server.log}" >&2
printf '{"engine":"%s","backend":"%s","installedAt":"%s"}\n' "$ENGINE" "${BACKEND:-?}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HOME_DIR/installed.json"
echo "✓ Installed ($(du -sh "$HOME_DIR" | cut -f1), backend ${BACKEND:-?}). The quiz app starts it on demand; test clip: $HOME_DIR/test.mp3"
