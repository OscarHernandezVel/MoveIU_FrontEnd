"use client";

import { useEffect } from "react";
import { formatTime } from "@/lib/music";
import { usePlayer } from "@/lib/player";
import { MusicControls } from "./MusicControls";

/** Reproductor completo: lista de pistas internas del proyecto. */
export function MusicPlayer() {
  const { tracks, index, playing, error, load, play } = usePlayer();
  useEffect(() => {
    void load();
  }, [load]);
  const current = tracks[index];
  return (
    <section className="music" aria-label="Reproductor de música">
      <div className="music-now">
        <p className="muted">{playing ? "Sonando" : "Listo para reproducir"}</p>
        <h2>{current?.title ?? "Sin pistas"}</h2>
        <p className="muted">{current?.artist}</p>
      </div>
      <MusicControls />
      {error && <p role="alert" className="music-error">{error}</p>}
      <ol className="music-list">
        {tracks.map((t, i) => (
          <li key={t.id}>
            <button type="button" className={i === index ? "track current" : "track"} onClick={() => play(i)} aria-current={i === index}>
              <span>{t.title}</span>
              <span className="muted">{formatTime(t.seconds)}</span>
            </button>
          </li>
        ))}
        {!tracks.length && !error && <li className="muted">Cargando pistas…</li>}
      </ol>
      <p className="muted">
        Las pistas son música original incluida en el proyecto (carpeta <code>public/musica</code>); no se transmite
        nada desde servicios externos. {current?.license}
      </p>
    </section>
  );
}
