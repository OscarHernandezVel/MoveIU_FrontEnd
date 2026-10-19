import type { Metadata } from "next";
import Link from "next/link";
import { MusicPlayer } from "@/components/MusicPlayer";

export const metadata: Metadata = { title: "Música · MoveIU" };

export default function MusicPage() {
  return (
    <main className="shell narrow">
      <header className="top">
        <h1>Música</h1>
        <Link href="/">← Volver al mapa</Link>
      </header>
      <MusicPlayer />
    </main>
  );
}
