import type { OccupancyState } from "./types.ts";

/** Label and glyph per state: the state is never conveyed by colour alone (RNF accessibility of v7). */
export const STATE_INFO: Record<OccupancyState, { label: string; glyph: string; tone: string }> = {
  available_seats: { label: "Hay sillas", glyph: "◯", tone: "ok" },
  standing_only: { label: "Solo de pie", glyph: "◐", tone: "warn" },
  full: { label: "Lleno", glyph: "●", tone: "full" },
  overcrowded: { label: "Sobrecupo", glyph: "▲", tone: "over" },
  no_data: { label: "Sin datos", glyph: "–", tone: "none" },
};
