"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { CabinMap } from "@/components/CabinMap";
import { DemoBanner } from "@/components/DemoBanner";
import { OccupancyBadge } from "@/components/OccupancyBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api } from "@/lib/api";
import { fromRest } from "@/lib/convert";
import { useFleet } from "@/lib/store";
import type { Bus } from "@/lib/types";

export default function BusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const known = useFleet((s) => s.buses.find((b) => b.id === id));
  const routesLoaded = useFleet((s) => s.routes.length > 0);
  const init = useFleet((s) => s.init);
  const stop = useFleet((s) => s.stop);
  const [fetched, setFetched] = useState<Bus | null>(null);

  // Si se entra directo a esta dirección, primero se decide si hay datos reales o demostración.
  useEffect(() => {
    if (!useFleet.getState().routes.length) void init();
    return stop;
  }, [init, stop]);

  useEffect(() => {
    if (known || !routesLoaded) return;
    api
      .cabin(id)
      .then((c) => api.activeBuses([c.route_id]))
      .then((rows) => {
        const row = rows.flatMap((r) => r.buses).find((b) => b.bus_id === id);
        if (row) setFetched(fromRest(row));
      })
      .catch(() => undefined);
  }, [id, known, routesLoaded]);

  const bus = known ?? fetched;
  return (
    <main className="shell narrow">
      <header className="top">
        <Link href="/" className="btn">← Mapa</Link>
        <ThemeToggle />
      </header>
      <DemoBanner />
      <h1>Bus {id}</h1>
      {bus ? (
        <p>
          Ruta {bus.routeId} · <OccupancyBadge state={bus.state} percentage={bus.percentage} />
        </p>
      ) : null}
      {routesLoaded ? <CabinMap busId={id} /> : <p className="muted" aria-busy="true">Cargando…</p>}
    </main>
  );
}
