"""WAV inspection / conditioning-prep helpers.

The browser converts every take to 24 kHz mono WAV before upload, so the server
only ever has to read PCM WAV. That keeps the install small (no ffmpeg needed).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import soundfile as sf

TARGET_SR = 24000
MAX_CLIP_SECONDS = 300


class AudioError(ValueError):
    pass


def _to_mono(data: np.ndarray) -> np.ndarray:
    if data.ndim == 1:
        return data.astype(np.float32, copy=False)
    return data.mean(axis=1).astype(np.float32)


def _resample(x: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return x.astype(np.float32, copy=False)
    try:  # scipy ships with the TTS stack; use it when available
        from scipy.signal import resample_poly

        g = math.gcd(int(src_sr), int(dst_sr))
        return resample_poly(x, dst_sr // g, src_sr // g).astype(np.float32)
    except Exception:
        duration = len(x) / float(src_sr)
        n = max(1, int(round(duration * dst_sr)))
        src_t = np.linspace(0.0, duration, num=len(x), endpoint=False)
        dst_t = np.linspace(0.0, duration, num=n, endpoint=False)
        return np.interp(dst_t, src_t, x).astype(np.float32)


def _trim_silence(x: np.ndarray, sr: int, threshold_db: float = -42.0) -> np.ndarray:
    if x.size == 0:
        return x
    frame = max(1, int(sr * 0.02))
    usable = (len(x) // frame) * frame
    if usable < frame:
        return x
    frames = x[:usable].reshape(-1, frame)
    rms = np.sqrt(np.mean(frames**2, axis=1) + 1e-12)
    peak = float(np.max(np.abs(x))) or 1.0
    floor = peak * (10 ** (threshold_db / 20.0))
    voiced = np.where(rms > max(floor, 1e-5))[0]
    if voiced.size == 0:
        return x
    pad = int(sr * 0.12)
    start = max(0, voiced[0] * frame - pad)
    end = min(len(x), (voiced[-1] + 1) * frame + pad)
    return x[start:end]


def _metrics(x: np.ndarray, sr: int, original_channels: int, original_sr: int) -> dict:
    duration = len(x) / float(sr) if sr else 0.0
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    rms = float(np.sqrt(np.mean(x**2))) if x.size else 0.0
    peak_db = 20 * math.log10(peak) if peak > 0 else -120.0
    rms_db = 20 * math.log10(rms) if rms > 0 else -120.0

    clipping_pct = float(np.mean(np.abs(x) >= 0.999) * 100) if x.size else 0.0
    silence_pct = 0.0
    snr_db = 0.0
    if x.size:
        frame = max(1, int(sr * 0.02))
        usable = (len(x) // frame) * frame
        if usable >= frame:
            frames = x[:usable].reshape(-1, frame)
            frame_rms = np.sqrt(np.mean(frames**2, axis=1) + 1e-12)
            loud = np.percentile(frame_rms, 95)
            noise = max(np.percentile(frame_rms, 10), 1e-9)
            snr_db = float(20 * math.log10(loud / noise))
            gate = max(loud * 10 ** (-38 / 20), 5e-4)
            silence_pct = float(np.mean(frame_rms < gate) * 100)

    return {
        "duration": round(duration, 3),
        "sample_rate": sr,
        "source_sample_rate": original_sr,
        "channels": original_channels,
        "peak_db": round(peak_db, 1),
        "rms_db": round(rms_db, 1),
        "clipping_pct": round(clipping_pct, 3),
        "silence_pct": round(silence_pct, 1),
        "snr_db": round(snr_db, 1),
    }


def prepare_wav(src: Path, dst: Path) -> dict:
    """Normalise a take: mono, 24 kHz, trimmed, peak-normalised, 16-bit PCM."""
    try:
        data, sr = sf.read(str(src), always_2d=True, dtype="float32")
    except Exception as exc:  # noqa: BLE001
        raise AudioError(f"Could not read that audio file ({exc}).") from exc

    if sr <= 0 or data.size == 0:
        raise AudioError("That file contains no audio.")
    duration = data.shape[0] / float(sr)
    if duration > MAX_CLIP_SECONDS:
        raise AudioError(
            f"That clip is {duration / 60:.1f} minutes long; keep samples under "
            f"{MAX_CLIP_SECONDS // 60} minutes."
        )
    channels = data.shape[1]

    x = _to_mono(data)
    x = _trim_silence(x, sr)
    x = _resample(x, sr, TARGET_SR)

    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 0:
        x = x * (0.95 / peak)  # about -0.45 dBFS
    x = np.clip(x, -1.0, 1.0)

    dst.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(dst), x.astype(np.float32), TARGET_SR, subtype="PCM_16")
    return _metrics(x, TARGET_SR, channels, sr)


def wav_duration(path: Path) -> float:
    try:
        info = sf.info(str(path))
        return round(info.frames / float(info.samplerate), 3) if info.samplerate else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


def clip_warnings(metrics: dict, *, emotion: str) -> list[dict]:
    """Human-readable quality advice shown next to every sample."""
    warnings: list[dict] = []
    duration = float(metrics.get("duration") or 0)
    if duration < 3:
        warnings.append(
            {"level": "error", "text": "Under 3 seconds — too short to learn much from."}
        )
    elif duration < 6:
        warnings.append(
            {"level": "warn", "text": "Short. 8–20 seconds per take clones far better."}
        )
    if metrics.get("clipping_pct", 0) > 0.4:
        warnings.append(
            {"level": "warn", "text": "Clipping — move back from the mic or lower the gain."}
        )
    if metrics.get("snr_db", 99) < 12:
        warnings.append(
            {"level": "warn", "text": "Noisy room. A quieter space will improve the clone."}
        )
    if metrics.get("rms_db", 0) < -38:
        warnings.append({"level": "warn", "text": "Very quiet recording."})
    if metrics.get("silence_pct", 0) > 60:
        warnings.append({"level": "warn", "text": "Mostly silence — trim it and re-upload."})
    if emotion != "neutral" and duration < 4:
        warnings.append(
            {"level": "warn", "text": "Emotion takes need at least ~5 seconds to register."}
        )
    return warnings
