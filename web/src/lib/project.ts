/** Proyección plana (equirrectangular local) de rutas y buses a píxeles, para el mapa esquemático. */
export interface Pt {
  lat: number;
  lng: number;
}

export interface Projection {
  x(lng: number): number;
  y(lat: number): number;
}

/** Ajusta los puntos a `width` × `height` píxeles con `pad` de margen, conservando las proporciones. */
export function fit(points: Pt[], width: number, height: number, pad: number): Projection {
  if (!points.length || width <= 0 || height <= 0) return { x: () => 0, y: () => 0 };
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * k, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return {
    x: (lng) => offsetX + (lng - minLng) * k * scale,
    y: (lat) => offsetY + (maxLat - lat) * scale,
  };
}
