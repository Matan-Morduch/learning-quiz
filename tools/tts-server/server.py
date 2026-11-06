#!/usr/bin/env python3
"""Local text-to-speech for the quiz app: Kokoro-82M, free and offline.

Backends (same model, voices, text front end and HTTP API; picked by --backend / $QUIZ_TTS_BACKEND, default auto):
  mlx        Apple Silicon Macs: mlx-audio on Metal (backend_mlx.py). auto picks it on Darwin-arm64 if mlx is installed.
  onnx       everywhere else: ONNX Runtime (backend_onnx.py), CUDA when the GPU works with it, else CPU.
  onnx-cpu   ONNX Runtime, CPU only.
/health reports the one in use as "backend": "mlx" | "onnx-cuda" | "onnx-cpu".

voice.js starts this lazily on the first local request and talks to it over 127.0.0.1 only:
  GET  /health                         -> {"ok": true, "ready": bool, "backend": ..., "model": ..., "voices": n}
  GET  /voices                         -> {"voices": ["bm_george", ...]}
  POST /tts {"text", "voice", "speed"} -> audio/mpeg (MP3, 24 kHz mono) of the whole text

One synthesis at a time; requests queue behind a lock. It exits on its own after --idle seconds without a
request (default 20 min) to give the RAM back.
Installed by tools/tts-server/install.sh into ~/.local/share/quiz-tts (venv + model).
"""
import argparse
import importlib.util
import json
import os
import platform
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SAMPLE_RATE = 24000
VOICE_RE = re.compile(r"^[abef]?[a-z]_[a-z]{2,20}$")

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8737)
ap.add_argument("--home", default=os.environ.get("QUIZ_TTS_HOME", os.path.expanduser("~/.local/share/quiz-tts")))
ap.add_argument("--idle", type=int, default=1200, help="seconds without requests before exiting (0 = never)")
ap.add_argument("--download", action="store_true", help="fetch the model + English voices, then exit (install step)")
ap.add_argument("--backend", choices=["auto", "mlx", "onnx", "onnx-cpu"], default=os.environ.get("QUIZ_TTS_BACKEND") or "auto")
args = ap.parse_args()

HOME = Path(args.home)
MODEL_DIR = HOME / "model"
FFMPEG = next((p for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg") if os.path.exists(p)), "ffmpeg")
APPLE_SILICON = sys.platform == "darwin" and platform.machine() == "arm64"
# auto: MLX on an Apple Silicon Mac whose venv has it (requirements.txt), else ONNX Runtime (requirements-linux*.txt).
KIND = args.backend if args.backend != "auto" else ("mlx" if APPLE_SILICON and importlib.util.find_spec("mlx") else "onnx")

if KIND == "mlx":
    import backend_mlx as B
else:
    import backend_onnx as B


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


if args.download:
    B.download(MODEL_DIR)
    log("model in", MODEL_DIR)
    sys.exit(0)

# Never reach out to the network at run time: everything was fetched at install.
os.environ.setdefault("HF_HUB_OFFLINE", "1")

engine = B.Engine(MODEL_DIR, log) if KIND == "mlx" else B.Engine(MODEL_DIR, log, device="cpu" if KIND == "onnx-cpu" else "auto")
state = {"ready": False, "error": None, "last": time.time(), "busy": 0}


def load():
    try:
        t = time.time()
        engine.load()
        log(f"{engine.name}: model loaded in {time.time() - t:.1f}s")
        for v in ("bm_george", "af_heart"):   # loads both G2Ps (British, American; spaCy) + kernels: first real request is fast
            if v in voices():
                engine.synth("Ready.", v, 1.0)
        state["ready"] = True
        log(f"warm in {time.time() - t:.1f}s")
    except Exception as e:  # noqa: BLE001
        state["error"] = f"{type(e).__name__}: {e}"
        log("load failed:", state["error"])


def voices():
    return B.voices(MODEL_DIR)


def to_mp3(pcm):
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "1",
                        "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1"],
                       input=pcm.tobytes(), capture_output=True, check=True)
    return p.stdout


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body, ctype="application/json"):
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Health checks don't count as use: the app polls /health whenever a page asks for voice status,
        # and that alone must not keep the sidecar (and its RAM) alive forever. Speaking (POST) does.
        if self.path != "/health":
            state["last"] = time.time()
        if self.path == "/health":
            mem = {}
            try:
                mem = engine.memory() if state["ready"] else {}
            except Exception:  # noqa: BLE001
                pass
            return self.reply(200, {"ok": state["error"] is None, "memory": mem, "ready": state["ready"],
                                    "error": state["error"], "model": B.MODEL_LABEL, "engine": f"kokoro-{KIND.split('-')[0]}",
                                    "backend": engine.name, "note": getattr(engine, "note", None),
                                    "voices": len(voices()), "busy": state["busy"], "pid": os.getpid()})
        if self.path == "/voices":
            return self.reply(200, {"voices": voices()})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        state["last"] = time.time()
        if self.path != "/tts":
            return self.reply(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            text = str(body.get("text") or "").strip()[:8000]
            voice = str(body.get("voice") or "bm_george")
            speed = min(2.0, max(0.5, float(body.get("speed") or 1.0)))
        except Exception:  # noqa: BLE001
            return self.reply(400, {"error": "invalid JSON body"})
        if not text:
            return self.reply(400, {"error": "nothing to say"})
        if not VOICE_RE.match(voice) or voice not in voices():
            return self.reply(400, {"error": f"unknown voice {voice}"})
        if not state["ready"]:
            return self.reply(503, {"error": state["error"] or "still loading"})
        state["busy"] += 1
        try:
            t = time.time()
            pcm = engine.synth(text, voice, speed)
            mp3 = to_mp3(pcm)
            dt = time.time() - t
            log(f"tts {len(text)} chars, {voice}, {len(pcm) / SAMPLE_RATE:.1f}s audio in {dt:.2f}s ({engine.name})")
            self.reply(200, mp3, "audio/mpeg")
        except Exception as e:  # noqa: BLE001
            log("tts failed:", e)
            self.reply(500, {"error": f"{type(e).__name__}: {e}"})
        finally:
            state["busy"] -= 1
            state["last"] = time.time()


def idle_watch(srv):
    while True:
        time.sleep(15)
        if args.idle and not state["busy"] and time.time() - state["last"] > args.idle:
            log("idle, exiting")
            os._exit(0)


if __name__ == "__main__":
    if not B.has_model(MODEL_DIR):
        log(f"no {KIND} model in", MODEL_DIR, "- run tools/tts-server/install.sh")
        sys.exit(3)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), H)   # loopback only
    threading.Thread(target=load, daemon=True).start()
    threading.Thread(target=idle_watch, args=(srv,), daemon=True).start()
    log(f"listening on 127.0.0.1:{args.port}")
    srv.serve_forever()
