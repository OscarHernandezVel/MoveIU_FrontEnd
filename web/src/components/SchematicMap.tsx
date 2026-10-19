"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fit } from "@/lib/project";
import { STATE_INFO } from "@/lib/occupancy";
import type { Bus, RouteInfo } from "@/lib/types";

/** Estilos de línea por ruta: además del color, cada ruta tiene su trazo (el color nunca es lo único que distingue). */
export const ROUTE_STROKES = [
  { color: "var(--r1)", dash: "", css: "solid" },
  { color: "var(--r2)", dash: "14 7", css: "dashed" },
  { color: "var(--r3)", dash: "3 6", css: "dotted" },
  { color: "var(--r4)", dash: "14 5 3 5", css: "double" },
];
export function strokeFor(routeId: string, routes: RouteInfo[]) {
  const i = Math.max(0, routes.findIndex((r) => r.route_id === routeId));
  return ROUTE_STROKES[i % ROUTE_STROKES.length]!;
}

function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * Mapa esquemático en SVG: no necesita WebGL, ni teselas, ni red. Se usa en el modo demostración y como respaldo
 * cuando el navegador no puede dibujar el mapa vectorial (algunos celulares con ahorro de batería o sin GPU).
 */
export function SchematicMap({ buses, routes, selected }: { buses: Bus[]; routes: RouteInfo[]; selected: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(box);
  const router = useRouter();
  const shown = routes.filter((r) => selected.includes(r.route_id));
  const pool = shown.length ? shown : routes;

  const projection = useMemo(
    () => fit(pool.flatMap((r) => (r.path?.length ? r.path : r.stops.map((s) => s.location))), width, height, 36),
    [pool, width, height],
  );

  return (
    <div ref={box} className="map schematic" role="group" aria-label="Mapa esquemático de las rutas y los buses">
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
          {shown.map((r) => {
            const stroke = strokeFor(r.route_id, routes);
            const points = (r.path?.length ? r.path : r.stops.map((s) => s.location))
              .map((p) => `${projection.x(p.lng).toFixed(1)},${projection.y(p.lat).toFixed(1)}`)
              .join(" ");
            return (
              <g key={r.route_id}>
                <polyline points={points} className="route-casing" />
                <polyline points={points} className="route-line" stroke={stroke.color} strokeDasharray={stroke.dash} />
                {r.stops.map((s, i) => {
                  const cx = projection.x(s.location.lng);
                  const cy = projection.y(s.location.lat);
                  const label = shown.length === 1 && (i === 0 || i === r.stops.length - 1 || i % 2 === 0);
                  return (
                    <g key={s.stop_id}>
                      <circle cx={cx} cy={cy} r={5} className="stop" />
                      {label && (
                        <text x={cx > width / 2 ? cx - 9 : cx + 9} y={cy + 4} className="stop-label" textAnchor={cx > width / 2 ? "end" : "start"}>
                          {s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {buses.map((b) => {
            const info = STATE_INFO[b.state];
            const text = `${b.routeId} ${info.glyph} ${b.state === "no_data" ? "" : `${b.percentage}%`}`.trim();
            const w = 18 + text.length * 9;
            // La etiqueta nunca se sale del mapa: se acerca al borde pero se mantiene visible y tocable
            const px = Math.min(Math.max(projection.x(b.lng), w / 2 + 4), Math.max(width - w / 2 - 4, w / 2 + 4));
            const py = Math.max(projection.y(b.lat), 50);
            const label = `Bus ${b.id}, ruta ${b.routeId}: ${info.label}, ${b.percentage}% de ocupación. Abrir plano de la cabina.`;
            return (
              <g
                key={b.id}
                className={`bus-pin tone-${info.tone}`}
                style={{ transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)` }}
                role="link"
                tabIndex={0}
                aria-label={label}
                onClick={() => router.push(`/bus/${encodeURIComponent(b.id)}`)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && router.push(`/bus/${encodeURIComponent(b.id)}`)}
              >
                {/* Área táctil de al menos 44 × 46 px, invisible, alrededor de la etiqueta */}
                <rect x={-Math.max(w, 48) / 2} y={-46} width={Math.max(w, 48)} height={46} className="pin-hit" />
                <rect x={-w / 2} y={-38} width={w} height={30} rx={8} className="pin-box" />
                <path d="M -7 -8 L 0 1 L 7 -8 Z" className="pin-tip" />
                <text x={0} y={-17} textAnchor="middle" className="pin-text">{text}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
