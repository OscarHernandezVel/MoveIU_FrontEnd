"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { buildLayout, FLOOR_L, INNER_W } from "@/lib/layout";
import type { CabinSnapshot } from "@/lib/types";

/**
 * Plano de la cabina desde GET /buses/{id}/cabin (solo ids de posición, nunca imágenes). Mismos ids y medidas que el
 * gemelo 3D (/arquitectura) y la maqueta (edge/maqueta): filas 1-10 cada 54 mm y la banca de 5 al fondo.
 *
 * En un celular el bus se dibuja **vertical** (frente arriba): así las sillas ocupan el ancho de la pantalla y el
 * texto se lee; en horizontal el plano de 714 mm quedaría de 5 px por mm. En pantallas anchas va horizontal.
 */
const spots = buildLayout();
const PAD = 22; // margen para los rótulos
const FRONT_DOOR: [number, number] = [11, 81];
const REAR_DOOR: [number, number] = [545, 607];

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 700px)");
    const read = () => setNarrow(query.matches);
    read();
    // Safari anterior a 14 solo conoce addListener
    if (query.addEventListener) query.addEventListener("change", read);
    else query.addListener(read);
    return () => (query.removeEventListener ? query.removeEventListener("change", read) : query.removeListener(read));
  }, []);
  return narrow;
}

export function CabinMap({ busId, refreshMs = 3000 }: { busId: string; refreshMs?: number }) {
  const [cabin, setCabin] = useState<CabinSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vertical = useNarrow();

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .cabin(busId)
        .then((c) => alive && (setCabin(c), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const timer = setInterval(load, refreshMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [busId, refreshMs]);

  const taken = new Set(cabin?.occupied ?? []);
  // (x a lo largo del bus, y a lo ancho) -> posición en el dibujo
  const W = vertical ? INNER_W : FLOOR_L;
  const H = vertical ? FLOOR_L : INNER_W;
  const at = (x: number, y: number, w: number, h: number) =>
    vertical ? { x: INNER_W - y - h, y: x, width: h, height: w } : { x, y, width: w, height: h };
  const label = vertical ? 10 : 11;

  const door = (range: [number, number], cls: string) => {
    return <rect {...at(range[0], -3, range[1] - range[0], 6)} className={`door ${cls}`} />;
  };
  const front = at(FRONT_DOOR[0], 0, FRONT_DOOR[1] - FRONT_DOOR[0], 0);
  const rear = at(REAR_DOOR[0], 0, REAR_DOOR[1] - REAR_DOOR[0], 0);
  const aisle = at(85, 61, 520, 38);
  const centre = (r: { x: number; y: number; width: number; height: number }) => ({ cx: r.x + r.width / 2, cy: r.y + r.height / 2 });

  return (
    <section aria-label="Plano de la cabina" className="cabin-section">
      <svg
        viewBox={`${-PAD} ${-PAD - 6} ${W + PAD + (vertical ? 68 : PAD)} ${H + 2 * PAD + 12}`}
        role="img"
        aria-label="Plano de la cabina visto desde arriba, con la entrada y la salida, las sillas y el pasillo"
        className={vertical ? "cabin vertical" : "cabin"}
      >
        <rect x="0" y="0" width={W} height={H} rx="4" className="hull" />
        {door(FRONT_DOOR, "in")}
        {door(REAR_DOOR, "out")}
        <rect {...aisle} className="aisle" />
        {spots.map((s) => {
          const r = at(s.x, s.y, s.w, s.h);
          const on = taken.has(s.id);
          const c = centre(r);
          return (
            <g key={s.id}>
              <rect {...r} rx={s.kind === "seat" ? 3 : 2} className={s.kind === "seat" ? (on ? "seat taken" : "seat") : on ? "spot taken" : "spot"}>
                <title>{`${s.id}${s.kind === "stand" ? " (de pie)" : ""}: ${on ? "ocupada" : "libre"}`}</title>
              </rect>
              <text x={c.cx} y={c.cy + label * 0.35} className={on && s.kind === "seat" ? "mark on" : "mark"} textAnchor="middle" fontSize={label}>
                {on ? "●" : s.kind === "stand" ? s.id : ""}
              </text>
            </g>
          );
        })}
        {/* Rótulos fuera del dibujo girado: siempre se leen en horizontal */}
        {vertical ? (
          <>
            <text x={-PAD + 2} y={-PAD + 8} className="tag" fontSize={label}>FRENTE</text>
            <text x={W + 64} y={front.y + 14} className="tag" textAnchor="end" fontSize={label}>ENTRADA</text>
            <text x={W + 64} y={rear.y + 14} className="tag" textAnchor="end" fontSize={label}>SALIDA</text>
          </>
        ) : (
          <>
            <text x="46" y="-9" className="tag" textAnchor="middle" fontSize={label}>ENTRADA D-FRONT</text>
            <text x="576" y="-9" className="tag" textAnchor="middle" fontSize={label}>SALIDA D-REAR</text>
            <text x="8" y={INNER_W + 16} className="tag" fontSize={label}>FRENTE</text>
          </>
        )}
      </svg>
      <ul className="legend" aria-label="Leyenda del plano">
        <li><i aria-hidden="true" /> Silla libre</li>
        <li><i className="taken" aria-hidden="true" /> Silla ocupada</li>
        <li><i className="stand" aria-hidden="true" /> Sitio de pie (P02–P09)</li>
      </ul>
      <p className="muted">
        {error
          ? `Sin datos de la cabina (${error}).`
          : cabin
            ? cabin.fresh
              ? `${cabin.counts.seated} sentados · ${cabin.counts.standing} de pie · actualizado hace unos segundos`
              : "Sin imagen reciente de las cámaras: se muestran solo los conteos de las puertas."
            : "Cargando…"}
      </p>
      <p className="muted">
        Solo se reciben identificadores de posición, nunca imágenes. Vista 3D:{" "}
        <a href="/arquitectura/index.html#twin">gemelo digital</a>.
      </p>
    </section>
  );
}
