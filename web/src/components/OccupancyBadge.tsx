import { STATE_INFO } from "@/lib/occupancy";
import type { OccupancyState } from "@/lib/types";

export function OccupancyBadge({ state, percentage }: { state: OccupancyState; percentage?: number }) {
  const info = STATE_INFO[state];
  return (
    <span className={`badge tone-${info.tone}`}>
      <span aria-hidden="true">{info.glyph}</span> {info.label}
      {percentage !== undefined && state !== "no_data" ? ` · ${percentage}%` : ""}
    </span>
  );
}
