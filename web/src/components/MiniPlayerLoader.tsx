"use client";

import dynamic from "next/dynamic";

// Carga aparte y solo en el navegador: el módulo de música no pesa en la primera carga del mapa.
const MiniPlayer = dynamic(() => import("./MiniPlayer").then((m) => m.MiniPlayer), { ssr: false });

export function MiniPlayerLoader() {
  return <MiniPlayer />;
}
