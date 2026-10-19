/** Módulo secundario de música: lógica pura (sin DOM) para poder probarla con `node --test`. */

export interface Track {
  id: string;
  title: string;
  artist: string;
  file: string;
  seconds: number;
  license: string;
}

export type Repeat = "off" | "all" | "one";

/** Valida el catálogo: un archivo mal formado nunca debe romper la pantalla, solo omitir esa pista. */
export function parseCatalog(raw: unknown): Track[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { tracks?: unknown }).tracks;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    const { id, title, artist, file, seconds, license } = t;
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(id) || seen.has(id)) continue;
    if (typeof title !== "string" || !title.trim() || typeof file !== "string") continue;
    // Solo archivos internos del sitio: nada de URLs externas ni de esquemas como javascript:.
    if (!/^\/musica\/[A-Za-z0-9_.-]+\.(mp3|m4a|ogg|opus|wav)$/.test(file)) continue;
    seen.add(id);
    tracks.push({
      id,
      title: title.trim().slice(0, 80),
      artist: typeof artist === "string" ? artist.slice(0, 80) : "",
      file,
      seconds: typeof seconds === "number" && seconds > 0 ? Math.round(seconds) : 0,
      license: typeof license === "string" ? license.slice(0, 120) : "",
    });
  }
  return tracks;
}

/** Índice de la pista siguiente (`step` = 1) o anterior (`step` = -1); `null` si la lista termina. */
export function neighbour(index: number, length: number, step: 1 | -1, repeat: Repeat): number | null {
  if (length <= 0) return null;
  if (repeat === "one") return index;
  const next = index + step;
  if (next >= 0 && next < length) return next;
  return repeat === "all" ? (next + length) % length : null;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
