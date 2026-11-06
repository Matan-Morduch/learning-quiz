# Local voice: Kokoro-82M (Apple MLX on a Mac, ONNX Runtime on Linux)

The quiz app's free text-to-speech engine. `voice.js` talks to it over `127.0.0.1:8737`. Same model,
same English voices (default `bm_george`), same text front end (misaki G2P) and the same HTTP API on
every platform; only the inference backend differs:

| Platform | Backend (`/health` → `backend`) | Packages | Model |
|---|---|---|---|
| macOS, Apple Silicon | `mlx`: mlx-audio 0.6.3 on Metal | `requirements.txt` | `mlx-community/Kokoro-82M-bf16` |
| Linux x86_64 + NVIDIA GPU | `onnx-cuda`: onnxruntime-gpu 1.26.0, CUDA 12.8, cuDNN 9.10.2 (from pip wheels) | `requirements-linux-cuda.txt` | `onnx-community/Kokoro-82M-v1.0-ONNX` fp32, pinned commit |
| Linux x86_64, no GPU (or CUDA fails) | `onnx-cpu`: onnxruntime 1.26.0 | `requirements-linux.txt` | same |

Files: `server.py` (HTTP, CLI, picks the backend), `backend_mlx.py`, `backend_onnx.py`.

## Install / remove

```sh
tools/tts-server/install.sh            # into ~/.local/share/quiz-tts (override: QUIZ_TTS_HOME)
tools/tts-server/install.sh --remove
```

- **Mac**: needs Apple Silicon and Homebrew (`uv` and `ffmpeg` are installed if missing). ≈ 0.9 GB.
- **Linux (Ubuntu 24.04)**: needs `ffmpeg` and `curl` first; the script never runs sudo:
  ```sh
  sudo apt-get install -y ffmpeg curl ca-certificates
  # GPU: the NVIDIA driver (Pascal / GTX 10xx: the 580 branch is the last one, e.g. nvidia-driver-580)
  tools/tts-server/install.sh
  ```
  `uv` is installed into `~/.local/bin` with its official (version-pinned) script if missing. espeak-ng is
  not needed from apt: `espeakng-loader` bundles it. No system CUDA toolkit is needed: the CUDA and cuDNN
  libraries come as pip wheels in the venv. The GPU set is chosen when `nvidia-smi -L` works
  (`QUIZ_TTS_GPU=cpu|cuda` overrides). ≈ 0.6 GB CPU, ≈ 3.5–4 GB with the CUDA wheels (≈ 2 GB download).

Both create a uv-managed Python 3.12 venv with the exact packages of the matching requirements file,
download the model + the English voices (`a*`/`b*`) into `model/`, run a test synthesis (`test.mp3`), and write
`installed.json` (`{engine, backend, installedAt}`), which is how the app knows it's there.

Keep `QUIZ_TTS_HOME` short (the script checks): espeak-ng keeps its data path in a 160-byte buffer, and a longer
venv path silently breaks the phoneme fallback for unknown words.

## Run

You don't start it yourself. The app spawns it on the first local request (detached, so app restarts
don't kill it; it's reused). It exits after `--idle` seconds without a request (the app passes 1200).
Log: `~/.local/share/quiz-tts/server.log`. By hand:

```sh
~/.local/share/quiz-tts/venv/bin/python tools/tts-server/server.py --port 8737 --idle 0
curl -s localhost:8737/health
curl -s -X POST localhost:8737/tts -d '{"text":"Hello there.","voice":"bm_george","speed":1}' -o hello.mp3
```

- `GET /health` → `{ok, ready, error, backend, note, engine, model, voices, busy, memory}` (`ready` once the model
  is loaded and warmed; `backend` is `mlx` | `onnx-cuda` | `onnx-cpu`; `note` says why CUDA isn't used, if it isn't)
- `GET /voices` → `{voices: ["af_heart", "bm_george", …]}`
- `POST /tts {text, voice, speed}` → `audio/mpeg` (24 kHz mono, 64 kbps, via ffmpeg). One at a time.

Backend choice: `--backend auto|mlx|onnx|onnx-cpu` or `$QUIZ_TTS_BACKEND`. `auto` = `mlx` on an Apple Silicon Mac
whose venv has mlx, else `onnx` (CUDA if onnxruntime has the CUDA provider and a warm-up synthesis on the GPU
works, else CPU). `$QUIZ_TTS_CUDA_DEVICE` picks the GPU (default 0).

Voices starting with `b` use British English phonemes, the rest American.

## Why ONNX Runtime on Linux, and why these versions (2026-10)

- **Pascal (GTX 1080, sm_61)**: PyTorch's CUDA 12.8+ wheels have no sm_50/sm_60 kernels, and the cu126 wheels
  (the last with Pascal) end with PyTorch 2.14; 2.15 is build-from-source for Pascal. onnxruntime-gpu **1.26.0** is
  the last release whose PyPI wheel is CUDA 12.8 built with `60-real` (sm_60 SASS runs on sm_61); 1.27+ on PyPI are
  CUDA 13, sm_75+. cuDNN 9.10.2 still lists compute capability 6.1 (the current cuDNN, 9.27, starts at 7.5; NVIDIA
  names 9.10.2 as the tuned release for pre-Volta). The NVIDIA 580 driver branch is the last for Pascal.
- **Lighter**: no PyTorch (~2.5 GB with its CUDA libs); the same onnxruntime runs the CPU fallback.
- **Same sound as the Mac**: not the `kokoro-onnx` package (it pins the CPU `onnxruntime`, which clashes with
  `onnxruntime-gpu`, and `phonemizer`, which clashes with misaki's `phonemizer-fork`, and it phonemizes with plain
  espeak). `backend_onnx.py` runs the model directly with misaki + hexgrad's chunking, as mlx-audio does: the same
  text gives the same phonemes and the same audio length (within one frame).
- **fp32**: Pascal runs fp16 at 1/64 rate; on CPU the int8 export was 2.4× *slower* than fp32 (M3 Pro).

Benchmarks (2026-10-31, M3 Pro, `bm_george`, warm; RTF = synthesis time / audio length):

| | 145-char sentence | 605-char paragraph | RAM |
|---|---|---|---|
| **mlx** (mlx-audio 0.6.3, Metal) | 0.68 s (RTF 0.066) | 2.1 s (RTF 0.054) | ~0.6 GB steady |
| **onnx-cpu** (onnxruntime 1.26.0, fp32) | 1.8 s (RTF 0.17) | 6.2 s (RTF 0.16) | ~0.75 GB |
| onnx-cpu, int8 export | – | 14.4 s (RTF 0.37) | |

Cold start (spawn → ready, warmed): ~3–4 s. Not measured yet: `onnx-cuda` on the GTX 1080, and `onnx-cpu` on the
server's i7 (expect roughly the M3 Pro's CPU figure, give or take 2×).

Earlier Mac comparison (2026-10-30): PyTorch MPS was as fast as MLX but needs torch (1.7 GB RAM, 35 s first load);
mlx-audio uses the same misaki G2P as the reference implementation with half the RAM.
