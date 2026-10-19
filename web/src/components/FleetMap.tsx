"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { webglAvailable } from "@/lib/webgl";
import type { Bus, RouteInfo } from "@/lib/types";
import { SchematicMap } from "./SchematicMap";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="map" aria-busy="true" />,
});

/**
 * Mapa con teselas (MapLibre) cuando hay datos reales y el navegador soporta WebGL; mapa esquemático en SVG en la
 * demostración o si no hay WebGL. En ambos casos se ve lo mismo: rutas, paradas y buses con su ocupación.
 */
export function FleetMap({ buses, routes, selected, demo }: { buses: Bus[]; routes: RouteInfo[]; selected: string[]; demo: boolean }) {
  const [gl, setGl] = useState<boolean | null>(null);
  useEffect(() => setGl(webglAvailable()), []);
  if (demo || gl === false) return <SchematicMap buses={buses} routes={routes} selected={selected} />;
  if (gl === null) return <div className="map" aria-busy="true" />;
  return <MapView buses={buses} routes={routes} selected={selected} />;
}
