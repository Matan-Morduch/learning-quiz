"""Kokoro-82M on Apple MLX (Metal): the backend on Apple Silicon Macs. Used by server.py."""
import threading

import numpy as np

REPO = "mlx-community/Kokoro-82M-bf16"
MODEL_LABEL = REPO


def download(model_dir):
    from huggingface_hub import snapshot_download
    snapshot_download(REPO, local_dir=str(model_dir),
                      allow_patterns=["config.json", "kokoro-v1_0.safetensors", "voices/a*.safetensors", "voices/b*.safetensors"])


def has_model(model_dir):
    return (model_dir / "kokoro-v1_0.safetensors").exists()


def voices(model_dir):
    d = model_dir / "voices"
    return sorted(p.stem for p in d.glob("*.safetensors")) if d.is_dir() else []


class Engine:
    name = "mlx"

    def __init__(self, model_dir, log):
        self.dir, self.log, self.model = model_dir, log, None
        self.lock = threading.Lock()   # MLX isn't thread-safe: one synthesis at a time

    def load(self):
        import mlx.core as mx
        from mlx_audio.tts.utils import load_model
        mx.set_cache_limit(256 * 1024 * 1024)
        self.model = load_model(self.dir, model_type="kokoro")

    def synth(self, text, voice, speed):
        import mlx.core as mx
        lang = "b" if voice.startswith("b") else "a"
        with self.lock:
            chunks = [np.asarray(r.audio, dtype=np.float32)
                      for r in self.model.generate(text=text, voice=str(self.dir / "voices" / f"{voice}.safetensors"),
                                                   speed=speed, lang_code=lang)]
            mx.clear_cache()   # MLX keeps freed GPU buffers around; give them back between requests
        return np.concatenate([c.reshape(-1) for c in chunks]) if chunks else np.zeros(0, dtype=np.float32)

    def memory(self):
        import mlx.core as mx
        return {"activeMB": round(mx.get_active_memory() / 1e6), "peakMB": round(mx.get_peak_memory() / 1e6)}
