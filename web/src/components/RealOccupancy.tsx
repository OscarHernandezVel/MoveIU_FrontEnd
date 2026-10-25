"use client";

import { useState } from "react";
import { ThemedFrame } from "@/components/ThemedFrame";
import { isDemo } from "@/lib/demo";
import { TWIN_VIEWS, type TwinView, twinUrl } from "@/lib/twin";

/**
 * «Mostrar ocupación real del bus #…»: la cabina vista desde cada cámara del bus, reconstruida en 3D con figuras
 * genéricas a partir de los identificadores de posición que envía el bus. La imagen de las cámaras no sale del bus,
 * así que aquí no hay fotos ni rostros: la identidad de los pasajeros queda protegida por diseño.
 */
export function RealOccupancy({ busId }: { busId: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<TwinView>("front");
  const panel = `real-occupancy-${busId}`;
  return (
    <section className="real-occupancy" aria-label={`Ocupación real del bus ${busId}`}>
      <button type="button" className="btn primary" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        {open ? "Ocultar" : "Mostrar"} ocupación real del bus #{busId}
      </button>
      {open ? (
        <div id={panel} className="real-occupancy-body">
          <p className="muted">
            Lo que ve cada cámara, rehecho con figuras genéricas en las sillas y sitios de pie ocupados. El bus solo envía
            identificadores como <code>S04-L1</code> o <code>P05</code>: ninguna imagen ni rostro sale del bus.
          </p>
          <div className="row" role="group" aria-label="Punto de vista">
            {TWIN_VIEWS.map((v) => (
              <button key={v.id} type="button" className="btn" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <ThemedFrame
            key={view}
            src={twinUrl(busId, view, !isDemo())}
            title={`Ocupación del bus ${busId}: ${TWIN_VIEWS.find((v) => v.id === view)?.label ?? ""}`}
          />
          {isDemo() ? <p className="muted">Modo demostración: la cabina es simulada.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
