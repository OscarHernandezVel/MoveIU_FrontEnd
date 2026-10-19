"use client";

import Link from "next/link";
import { useEffect } from "react";
import { DemoBanner } from "@/components/DemoBanner";
import { FleetMap } from "@/components/FleetMap";
import { OccupancyBadge } from "@/components/OccupancyBadge";
import { strokeFor } from "@/components/SchematicMap";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useFleet } from "@/lib/store";

export default function Home() {
  const { routes, selected, buses, link, error, demo, init, select, stop } = useFleet();

  useEffect(() => {
    void init();
    return stop;
  }, [init, stop]);

  const toggle = (id: string) =>
    select(selected.includes(id) ? selected.filter((r) => r !== id) : [...selected, id]);
  const linkText = demo
    ? "Demostración · datos simulados"
    : { ws: "En vivo (WebSocket)", polling: "Actualizando cada pocos segundos", offline: "Sin conexión" }[link];
  const linkClass = demo ? "link-demo" : `link-${link}`;

  return (
    <main className="shell">
      <header className="top">
        <h1>MoveIU</h1>
        <div className="tools">
          <Link href="/recorrido" className="btn">Recorrido</Link>
          <Link href="/musica" className="btn">Música</Link>
          <ThemeToggle />
        </div>
      </header>
      {!demo && (
        <p className={`link ${linkClass}`} role="status">
          {linkText}
          {error ? ` · ${error}` : ""}
        </p>
      )}
      <DemoBanner />
      <fieldset className="routes">
        <legend>Rutas (hasta 5)</legend>
        {routes.map((r) => (
          <label key={r.route_id} className={selected.includes(r.route_id) ? "chip on" : "chip"}>
            <input type="checkbox" checked={selected.includes(r.route_id)} onChange={() => toggle(r.route_id)} />
            <span className="swatch" aria-hidden="true" style={{ borderTopColor: strokeFor(r.route_id, routes).color, borderTopStyle: strokeFor(r.route_id, routes).css as "solid" }} />
            {r.route_id} <span className="muted">{r.name}</span>
          </label>
        ))}
      </fieldset>
      <div className="split">
        <FleetMap buses={buses} routes={routes} selected={selected} demo={demo} />
        <aside aria-label="Buses">
          <h2>Buses ({buses.length})</h2>
          <ul className="list">
            {buses.map((b) => (
              <li key={b.id}>
                <Link href={`/bus/${encodeURIComponent(b.id)}`}>
                  <strong>Bus {b.id}</strong> · ruta {b.routeId}
                </Link>
                <OccupancyBadge state={b.state} percentage={b.percentage} />
                <span className="muted">
                  {b.freeSeats} sillas libres · {b.freeStanding} sitios de pie
                  {b.approximate ? " · conteo aproximado" : ""}
                </span>
              </li>
            ))}
            {!buses.length && <li className="muted">No hay buses reportando en estas rutas.</li>}
          </ul>
        </aside>
      </div>
    </main>
  );
}
