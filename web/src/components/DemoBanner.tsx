"use client";

import Link from "next/link";
import { useFleet } from "@/lib/store";

/** Avisa que los datos son simulados y ofrece el recorrido; con back-end disponible permite volver a los datos reales. */
export function DemoBanner() {
  const demo = useFleet((s) => s.demo);
  const setDemoMode = useFleet((s) => s.setDemoMode);
  if (!demo) return null;
  return (
    <div className="demo-banner" role="note">
      <p>
        <strong>Demostración.</strong> Buses y ocupación simulados (rutas reales de Pasto).
      </p>
      <div className="demo-actions">
        <Link href="/recorrido" className="btn primary">Ver recorrido</Link>
        <button type="button" className="btn" onClick={() => void setDemoMode(false)}>Datos reales</button>
      </div>
    </div>
  );
}
