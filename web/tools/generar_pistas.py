"""Genera las pistas internas del reproductor de MoveIU (música original, sin derechos de terceros).

Cada pista es una composición sencilla escrita aquí mismo (acordes en pad + arpegio suave + reverberación),
sintetizada con numpy y codificada a MP3 con ffmpeg (MP3 suena en Android, iOS y todos los navegadores).
Ejecutar:  python3 tools/generar_pistas.py   (necesita numpy, scipy y ffmpeg)
Puede reemplazar los MP3 por sus propias canciones: solo edite public/musica/catalogo.json.
"""

from __future__ import annotations

import json
import subprocess
import wave
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

SR = 44_100
OUT = Path(__file__).resolve().parent.parent / "public" / "musica"
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def hz(name: str) -> float:
    """'A3' -> 220.0; admite sostenido '#' y bemol 'b'."""
    letter, rest = name[0], name[1:]
    semis = NOTE[letter]
    if rest[0] == "#":
        semis, rest = semis + 1, rest[1:]
    elif rest[0] == "b":
        semis, rest = semis - 1, rest[1:]
    octave = int(rest)
    return 440.0 * 2 ** ((semis - 9 + 12 * (octave - 4)) / 12)


def tone(freq: float, seconds: float, attack: float, release: float, harmonics: tuple[float, ...], detune: float = 0.0):
    t = np.arange(int(seconds * SR)) / SR
    wave_ = sum(a * np.sin(2 * np.pi * freq * (k + 1) * (1 + detune) * t) for k, a in enumerate(harmonics))
    env = np.minimum(1.0, t / max(attack, 1e-4)) * np.minimum(1.0, (seconds - t) / max(release, 1e-4))
    return wave_ * np.clip(env, 0.0, 1.0)


def reverb(x: np.ndarray, seconds: float = 1.8, mix: float = 0.28, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * seconds / 4.5))
    ir /= np.sqrt(np.sum(ir**2))
    wet = fftconvolve(x, ir)[: len(x)]
    return (1 - mix) * x + mix * wet


def render(spec: dict) -> np.ndarray:
    beat = 60.0 / spec["bpm"]
    bar = 4 * beat
    total = spec["bars"] * bar
    n = int((total + 3.0) * SR)
    left, right = np.zeros(n), np.zeros(n)
    chords: list[list[str]] = spec["chords"]
    for index in range(spec["bars"]):
        chord = chords[index % len(chords)]
        start = int(index * bar * SR)
        for k, note in enumerate(chord):  # pad suave, ligeramente desafinado entre canales
            for chan, det in ((left, -0.0012), (right, 0.0012)):
                voice = tone(hz(note), bar + 1.2, 0.9, 1.1, (1.0, 0.35, 0.12), det) * 0.11
                chan[start : start + len(voice)] += voice[: n - start]
        pattern = spec["pattern"]
        for step, degree in enumerate(pattern):  # arpegio: una nota por corchea
            if degree is None:
                continue
            note = chord[degree % len(chord)]
            octave_shift = 2.0 if degree >= len(chord) else 1.0
            pos = start + int(step * beat / 2 * SR)
            pluck = tone(hz(note) * octave_shift, 1.6, 0.006, 1.4, (1.0, 0.5, 0.25, 0.1)) * 0.09
            pan = 0.35 + 0.3 * ((step % 4) / 3)
            left[pos : pos + len(pluck)] += pluck[: n - pos] * (1 - pan)
            right[pos : pos + len(pluck)] += pluck[: n - pos] * pan
        bass = tone(hz(chord[0]) / 2, bar, 0.25, 0.6, (1.0, 0.2)) * 0.10
        left[start : start + len(bass)] += bass[: n - start]
        right[start : start + len(bass)] += bass[: n - start]
    stereo = np.stack([reverb(left, seed=11), reverb(right, seed=23)], axis=1)
    fade = int(2.5 * SR)
    stereo[:fade] *= np.linspace(0, 1, fade)[:, None]
    end = int((total + 2.0) * SR)
    stereo = stereo[:end]
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    stereo *= 0.7 / max(1e-9, np.abs(stereo).max())  # pico en -3 dBFS
    return stereo


TRACKS = [
    {"id": "alba", "title": "Alba en la ruta", "bpm": 72, "bars": 20,
     "chords": [["C3", "G3", "E4"], ["A2", "E3", "C4"], ["F2", "C3", "A3"], ["G2", "D3", "B3"]],
     "pattern": [0, 1, 2, 1, 3, 2, 1, 2]},
    {"id": "mediodia", "title": "Mediodía en el centro", "bpm": 84, "bars": 22,
     "chords": [["D3", "A3", "F#4"], ["B2", "F#3", "D4"], ["G2", "D3", "B3"], ["A2", "E3", "C#4"]],
     "pattern": [0, None, 1, 2, 1, None, 2, 3]},
    {"id": "tarde", "title": "Tarde de lluvia fina", "bpm": 64, "bars": 18,
     "chords": [["A2", "E3", "C4"], ["F2", "C3", "A3"], ["C3", "G3", "E4"], ["E2", "B2", "G#3"]],
     "pattern": [0, 1, 2, 3, 2, 1, 0, 1]},
    {"id": "ultima", "title": "Última parada", "bpm": 58, "bars": 16,
     "chords": [["F2", "C3", "A3"], ["C3", "G3", "E4"], ["D3", "A3", "F4"], ["Bb2", "F3", "D4"]],
     "pattern": [0, None, None, 1, None, 2, None, None]},
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = []
    for spec in TRACKS:
        audio = render(spec)
        wav_path = OUT / f"{spec['id']}.wav"
        with wave.open(str(wav_path), "wb") as handle:
            handle.setnchannels(2)
            handle.setsampwidth(2)
            handle.setframerate(SR)
            handle.writeframes((audio * 32767).astype("<i2").tobytes())
        mp3_path = OUT / f"{spec['id']}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path), "-codec:a", "libmp3lame", "-b:a", "96k", str(mp3_path)],
            check=True,
        )
        wav_path.unlink()
        catalog.append({
            "id": spec["id"], "title": spec["title"], "artist": "MoveIU (pista original)",
            "file": f"/musica/{spec['id']}.mp3", "seconds": round(len(audio) / SR),
            "license": "Obra original del proyecto, sin derechos de terceros",
        })
        print(spec["id"], f"{mp3_path.stat().st_size / 1024:.0f} KB", catalog[-1]["seconds"], "s")
    (OUT / "catalogo.json").write_text(json.dumps({"version": 1, "tracks": catalog}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
