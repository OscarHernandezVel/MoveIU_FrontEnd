"use client";

import { formatTime } from "@/lib/music";
import { usePlayer } from "@/lib/player";

const REPEAT_LABEL = { off: "Repetir: no", all: "Repetir: todas", one: "Repetir: una" } as const;

/** Controles compartidos por el reproductor completo y la barra mínima. */
export function MusicControls({ compact = false }: { compact?: boolean }) {
  const { tracks, index, playing, position, duration, volume, repeat, toggle, next, previous, seek, setVolume, cycleRepeat } =
    usePlayer();
  const track = tracks[index];
  const total = duration || track?.seconds || 0;
  return (
    <div className={compact ? "music-controls compact" : "music-controls"}>
      <div className="music-buttons">
        <button type="button" onClick={previous} aria-label="Pista anterior" disabled={!tracks.length}>⏮</button>
        <button type="button" className="primary" onClick={toggle} aria-label={playing ? "Pausar" : "Reproducir"} disabled={!tracks.length}>
          {playing ? "⏸" : "▶"}
        </button>
        <button type="button" onClick={next} aria-label="Pista siguiente" disabled={!tracks.length}>⏭</button>
        {!compact && (
          <button type="button" onClick={cycleRepeat} aria-label={REPEAT_LABEL[repeat]} title={REPEAT_LABEL[repeat]}>
            {repeat === "one" ? "🔂" : "🔁"}
            <span className="muted"> {repeat === "off" ? "no" : repeat === "all" ? "todas" : "una"}</span>
          </button>
        )}
      </div>
      <label className="music-seek">
        <span className="muted">{formatTime(position)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(total))}
          step={1}
          value={Math.min(Math.round(position), Math.max(1, Math.round(total)))}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Posición de la pista"
          disabled={!track}
        />
        <span className="muted">{formatTime(total)}</span>
      </label>
      {!compact && (
        <label className="music-volume">
          <span className="muted">Volumen</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            aria-label="Volumen"
          />
        </label>
      )}
    </div>
  );
}
