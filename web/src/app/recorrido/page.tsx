"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CabinMap } from "@/components/CabinMap";
import { MusicPlayer } from "@/components/MusicPlayer";
import { OccupancyBadge } from "@/components/OccupancyBadge";
import { SchematicMap, strokeFor } from "@/components/SchematicMap";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemedFrame } from "@/components/ThemedFrame";
import { TourFlow } from "@/components/TourFlow";
import { STATE_INFO } from "@/lib/occupancy";
import { useFleet } from "@/lib/store";
import type { OccupancyState } from "@/lib/types";

const STATE_TEXT: Record<OccupancyState, string> = {
  available_seats: "Hay sillas libres: puede subir y sentarse.",
  standing_only: "Las sillas están ocupadas; quedan sitios de pie.",
  full: "Lleno: ya no caben más personas con comodidad.",
  overcrowded: "Sobrecupo: hay más personas de las previstas.",
  no_data: "Sin datos: el bus no ha reportado; no se inventa una cifra.",
};

const STEPS = [
  { short: "Mapa", title: "Abra MoveIU y vea los buses de su ruta" },
  { short: "Ruta", title: "Elija una o varias rutas" },
  { short: "Ocupación", title: "Lea cuánto espacio queda en cada bus" },
  { short: "Cabina", title: "Entre al bus: sillas, pasillo, entrada y salida" },
  { short: "Privacidad", title: "Cómo lo sabe MoveIU sin guardar imágenes" },
  { short: "Gemelo 3D", title: "La réplica 3D de la cabina" },
  { short: "Música", title: "Para el viaje: música interna" },
] as const;

export default function Tour() {
  const { routes, selected, buses, demo, select, setDemoMode, stop } = useFleet();
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // El recorrido siempre usa la flota simulada: se ve igual con o sin servidor.
  useEffect(() => {
    void setDemoMode(true);
    return stop;
  }, [setDemoMode, stop]);

  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("paso"));
    if (Number.isInteger(n) && n >= 1 && n <= STEPS.length) setStep(n - 1);
  }, []);

  const go = useCallback((n: number) => {
    const next = Math.min(STEPS.length - 1, Math.max(0, n));
    moved.current = true;
    setStep(next);
    try {
      window.history.replaceState(null, "", `?paso=${next + 1}`);
    } catch {
      /* algunos navegadores en modo embebido no permiten cambiar la dirección */
    }
  }, []);

  useEffect(() => {
    if (moved.current) heading.current?.focus(); // lectores de pantalla: anuncia el nuevo paso
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === "ArrowRight") go(step + 1);
      if (e.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step]);

  const toggle = (id: string) => select(selected.includes(id) ? selected.filter((r) => r !== id) : [...selected, id]);
  const first = buses.find((b) => b.id === "2101") ?? buses[0];

  return (
    <main className="shell narrow">
      <header className="top">
        <h1>Recorrido por MoveIU</h1>
        <div className="tools">
          <Link href="/" className="btn">Ir al mapa</Link>
          <ThemeToggle />
        </div>
      </header>
      <p className="muted">
        Una vista guiada con datos simulados (rutas reales de Pasto): no necesita servidor ni cámaras. Use los botones o las
        flechas del teclado.
      </p>

      <nav aria-label="Pasos del recorrido">
        <ol className="tour-steps">
          {STEPS.map((s, i) => (
            <li key={s.short}>
              <button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined} aria-label={`Paso ${i + 1}: ${s.short}`}>
                <span className="label">{s.short}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="tour-panel" aria-labelledby="tour-title" aria-live="polite">
        <p className="muted">Paso {step + 1} de {STEPS.length}</p>
        <h2 id="tour-title" ref={heading} tabIndex={-1}>{STEPS[step]!.title}</h2>

        {step === 0 && (
          <>
            <p>MoveIU muestra en un mapa los buses de su ruta y, sobre cada uno, cuánto espacio le queda.</p>
            <SchematicMap buses={buses} routes={routes} selected={selected} />
            <p className="callout">Cada etiqueta indica la ruta, un símbolo y el porcentaje de ocupación. Se actualiza sola.</p>
          </>
        )}

        {step === 1 && (
          <>
            <p>Puede seguir hasta cinco rutas a la vez. Marque o desmarque para ver el cambio en el mapa.</p>
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
            <SchematicMap buses={buses} routes={routes} selected={selected} />
            <p className="callout">Cada ruta tiene su color y también su tipo de línea (continua, rayada, punteada…), para distinguirlas sin depender del color.</p>
          </>
        )}

        {step === 2 && (
          <>
            <p>El estado nunca se indica solo con color: siempre va con un símbolo y una palabra.</p>
            <ul className="list">
              {(Object.keys(STATE_INFO) as OccupancyState[]).map((s) => (
                <li key={s}>
                  <OccupancyBadge state={s} />
                  <span className="muted">{STATE_TEXT[s]}</span>
                </li>
              ))}
            </ul>
            <h3>Ahora mismo, en la ruta elegida</h3>
            <ul className="list">
              {buses.map((b) => (
                <li key={b.id}>
                  <strong>Bus {b.id} · ruta {b.routeId}</strong>
                  <OccupancyBadge state={b.state} percentage={b.percentage} />
                  <span className="muted">{b.freeSeats} sillas libres · {b.freeStanding} sitios de pie</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 3 && (
          <>
            <p>
              Al abrir un bus verá su cabina desde arriba: la <strong>entrada</strong> (adelante), la <strong>salida</strong> (atrás),
              las sillas, el pasillo y los sitios de pie. {first ? `Es el bus ${first.id}.` : ""}
            </p>
            <CabinMap busId={first?.id ?? "2101"} refreshMs={1000} />
            <p className="callout">Cada silla ocupada se rellena; los sitios de pie del pasillo van rayados hasta que alguien los ocupa.</p>
          </>
        )}

        {step === 4 && (
          <>
            <p>
              Para proteger a los pasajeros, <strong>la imagen de la cámara no sale del bus</strong>. El equipo a bordo decide qué
              posiciones están ocupadas, descarta la imagen y envía solo esa lista.
            </p>
            <TourFlow />
            <p className="callout">Por eso el plano de la cabina es una réplica: dibuja posiciones, no personas.</p>
          </>
        )}

        {step === 5 && (
          <>
            <p>El gemelo digital es la misma cabina en 3D, con figuras genéricas (sin rostro). Arrastre para girar y use dos dedos para acercar.</p>
            <ThemedFrame title="Gemelo digital 3D del bus" src="/arquitectura/index.html#twin" />
            <p><a className="btn" href="/arquitectura/index.html#twin">Abrir en pantalla completa</a></p>
          </>
        )}

        {step === 6 && (
          <>
            <p>Un módulo aparte, con pistas originales incluidas en el proyecto. No usa la red ni afecta el mapa.</p>
            <MusicPlayer />
          </>
        )}
      </section>

      <div className="tour-nav">
        <button type="button" className="btn" onClick={() => go(step - 1)} disabled={step === 0}>← Anterior</button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn primary" onClick={() => go(step + 1)}>Siguiente →</button>
        ) : (
          <Link href="/" className="btn primary">Terminar</Link>
        )}
      </div>
      {!demo && <p className="muted" role="status">Preparando los datos de demostración…</p>}
    </main>
  );
}
