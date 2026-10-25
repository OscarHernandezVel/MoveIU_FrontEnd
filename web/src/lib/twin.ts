/**
 * Dirección del gemelo 3D (`public/arquitectura`) para la sección «Mostrar ocupación real del bus #…».
 *
 * `front` y `rear` ponen la vista donde está cada webcam de la maqueta (la misma pose con la que el agente del bus
 * reconoce las figuras); `3d` deja la vista libre. Con `live` el gemelo lee `/api/v1/buses/{id}/cabin` del mismo
 * origen; sin él (modo demostración) usa su simulador. Solo viajan identificadores de posición: nunca imágenes.
 */
export type TwinView = "front" | "rear" | "3d";

export const TWIN_VIEWS: readonly { id: TwinView; label: string }[] = [
  { id: "front", label: "Cámara frontal (filas 1–5)" },
  { id: "rear", label: "Cámara trasera (filas 6–11)" },
  { id: "3d", label: "Vista libre 3D" },
];

export function twinUrl(busId: string, view: TwinView, live: boolean): string {
  const q = new URLSearchParams({ bus: busId, embed: "1" });
  if (view !== "3d") q.set("view", view);
  if (live) q.set("live", "1");
  return `/arquitectura/index.html?${q.toString()}#twin`;
}
