"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePlayer } from "@/lib/player";
import { MusicControls } from "./MusicControls";

/** Barra mínima: solo aparece cuando hay una pista cargada y no se está en la página de música. */
export function MiniPlayer() {
  const { tracks, index, playing, position } = usePlayer();
  const pathname = usePathname();
  const track = tracks[index];
  if (!track || (!playing && position === 0) || pathname === "/musica") return null;
  return (
    <div className="mini-player" role="region" aria-label="Música">
      <Link href="/musica" className="mini-title">{track.title}</Link>
      <MusicControls compact />
    </div>
  );
}
