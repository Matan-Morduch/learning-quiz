"""Kokoro-82M on ONNX Runtime: the backend everywhere but Apple Silicon (Linux: CUDA if usable, else CPU).

Same model (Kokoro v1.0 weights, onnx-community export), same English voices and the same text front end as
the MLX backend (misaki G2P with the espeak-ng fallback, hexgrad's 510-phoneme chunking), so a voice
sounds the same on both. Used by server.py.

Why not the `kokoro-onnx` package: it hard-depends on the CPU `onnxruntime` (which clashes with
`onnxruntime-gpu`) and on `phonemizer` (which clashes with misaki's `phonemizer-fork`), and it uses plain
espeak phonemes instead of misaki's lexicon. Running the model directly is ~30 lines.
GPU: fp32 on purpose. Pascal (GTX 10xx) runs fp16 at 1/64 rate, so the fp16 export would be slower there.
"""
import json
import os
import re
import threading

import numpy as np

REPO = "onnx-community/Kokoro-82M-v1.0-ONNX"
REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231"   # pinned commit (2025-02-08)
MODEL_FILE = "onnx/model.onnx"                         # fp32, 326 MB
MODEL_LABEL = f"{REPO} (fp32)"
CONTEXT = 510                                          # phonemes per model call (+ 2 pad tokens = 512)


def download(model_dir):
    from huggingface_hub import snapshot_download
    snapshot_download(REPO, revision=REVISION, local_dir=str(model_dir),
                      allow_patterns=["config.json", "tokenizer.json", MODEL_FILE, "voices/a?_*.bin", "voices/b?_*.bin"])


def has_model(model_dir):
    return (model_dir / MODEL_FILE).exists()


def voices(model_dir):
    d = model_dir / "voices"
    return sorted(p.stem for p in d.glob("??_*.bin")) if d.is_dir() else []


# ---------- text → phonemes (same as mlx_audio's / hexgrad's KPipeline for English) ----------

def _ps(tokens):
    return "".join(t.phonemes + (" " if t.whitespace else "") for t in tokens).strip()


def _waterfall_last(tokens, next_count, waterfall=("!.?…", ":;", ",—"), bumps=(")", "”")):
    for w in waterfall:
        z = next((i for i, t in reversed(list(enumerate(tokens))) if t.phonemes in set(w)), None)
        if z is None:
            continue
        z += 1
        if z < len(tokens) and tokens[z].phonemes in bumps:
            z += 1
        if next_count - len(_ps(tokens[:z])) <= CONTEXT:
            return z
    return len(tokens)


def _chunks(tokens):
    """Phoneme strings of at most 510 chars, split at sentence/clause ends (KPipeline.en_tokenize)."""
    tks, pcount = [], 0
    for t in tokens:
        t.phonemes = "" if t.phonemes is None else t.phonemes.replace("ɾ", "T")
        next_ps = t.phonemes + (" " if t.whitespace else "")
        next_pcount = pcount + len(next_ps.rstrip())
        if next_pcount > CONTEXT:
            z = _waterfall_last(tks, next_pcount)
            yield _ps(tks[:z])
            tks = tks[z:]
            pcount = len(_ps(tks))
            if not tks:
                next_ps = next_ps.lstrip()
        tks.append(t)
        pcount += len(next_ps)
    if tks:
        yield _ps(tks)


class Engine:
    def __init__(self, model_dir, log, device="auto"):
        self.dir, self.log, self.device = model_dir, log, device   # device: auto | cpu
        self.name = "onnx-cpu"
        self.note = None            # why CUDA isn't used, when it isn't
        self.sess = None
        self.g2p = {}
        self.styles = {}
        self.lock = threading.Lock()

    # -- model --
    def _session(self, providers):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.log_severity_level = 3
        return ort.InferenceSession(str(self.dir / MODEL_FILE), sess_options=so, providers=providers)

    def load(self):
        import onnxruntime as ort
        tok = json.loads((self.dir / "tokenizer.json").read_text())
        self.vocab = tok["model"]["vocab"]
        avail = ort.get_available_providers()
        if self.device != "cpu" and "CUDAExecutionProvider" in avail:
            try:
                if hasattr(ort, "preload_dlls"):
                    ort.preload_dlls()   # CUDA/cuDNN from the nvidia-* wheels in this venv
                cuda = ("CUDAExecutionProvider", {
                    "device_id": int(os.environ.get("QUIZ_TTS_CUDA_DEVICE", "0")),
                    # Every request has a new input length: cuDNN's exhaustive per-shape search would run each time.
                    "cudnn_conv_algo_search": "HEURISTIC",
                    "arena_extend_strategy": "kSameAsRequested",
                })
                self.sess = self._session([cuda, "CPUExecutionProvider"])
                if self.sess.get_providers()[0] != "CUDAExecutionProvider":
                    raise RuntimeError("CUDA provider not active")
                self.name = "onnx-cuda"
                self.synth("Ready.", "bm_george", 1.0)   # fails here if the GPU can't run the kernels
            except Exception as e:  # noqa: BLE001
                self.note = f"CUDA unusable, using CPU ({type(e).__name__}: {str(e)[:300]})"
                self.log(self.note)
                self.sess, self.name = None, "onnx-cpu"
        elif self.device != "cpu":
            self.note = "no CUDA provider in onnxruntime: CPU"
        if self.sess is None:
            self.sess = self._session(["CPUExecutionProvider"])
        self.log(f"onnxruntime {ort.__version__}, providers {self.sess.get_providers()}")

    def _g2p(self, lang):
        if lang not in self.g2p:
            from misaki import en, espeak
            try:
                fallback = espeak.EspeakFallback(british=lang == "b")
            except Exception as e:  # noqa: BLE001
                self.log("espeak fallback unavailable, unknown words are skipped:", e)
                fallback = None
            self.g2p[lang] = en.G2P(trf=False, british=lang == "b", fallback=fallback, unk="")
        return self.g2p[lang]

    def _style(self, voice):
        if voice not in self.styles:
            self.styles[voice] = np.fromfile(self.dir / "voices" / f"{voice}.bin", dtype=np.float32).reshape(-1, 1, 256)
        return self.styles[voice]

    def synth(self, text, voice, speed):
        lang = "b" if voice.startswith("b") else "a"
        style = self._style(voice)
        out = []
        with self.lock:
            g2p = self._g2p(lang)
            for para in re.split(r"\n+", text.strip()):
                if not para.strip():
                    continue
                _, tokens = g2p(para)
                for ps in _chunks(tokens):
                    ids = [i for i in (self.vocab.get(p) for p in ps[:CONTEXT]) if i is not None]
                    if not ids:
                        continue
                    wav = self.sess.run(None, {
                        "input_ids": np.array([[0, *ids, 0]], dtype=np.int64),
                        "style": style[min(len(ps), CONTEXT) - 1],
                        "speed": np.array([speed], dtype=np.float32),
                    })[0]
                    out.append(np.asarray(wav, dtype=np.float32).reshape(-1))
        return np.concatenate(out) if out else np.zeros(0, dtype=np.float32)

    def memory(self):
        try:
            import resource
            import sys
            rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            return {"peakRssMB": round(rss / (1e6 if sys.platform == "darwin" else 1e3))}
        except Exception:  # noqa: BLE001
            return {}
