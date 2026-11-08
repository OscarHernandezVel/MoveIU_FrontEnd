// Planificador «caminar → bus → caminar» (HU-03). Por cada ruta: subir en la parada más cercana a la salida y bajar
// en la más cercana al destino. No usa IA: es geometría sobre las paradas, determinista e instantánea.
"use strict";

const MAX_WALK_M = 800;      // ~10 min a pie a cada lado
const EARTH_R = 6371000;     // el mismo radio que usa Leaflet en distanceTo

function distanceM(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

// routes: Map o lista de [route_id, { stops: [{ stop_id, name, order, location: { lat, lng } }] }].
// Devuelve hasta `limit` viajes, el de menos caminata primero; si ninguno cabe en `maxWalk` a cada lado, la ruta más
// cercana igual (marcada `far`) para no dejar al pasajero sin respuesta.
function walkRideWalk(routes, origin, dest, maxWalk = MAX_WALK_M, limit = 6) {
  const all = [];
  for (const [routeId, route] of routes) {
    const stops = route.stops || [];
    const nearest = (p) => stops.reduce((best, s) => {
      const m = distanceM(p, s.location);
      return m < best.m ? { s, m } : best;
    }, { s: null, m: Infinity });
    const board = nearest(origin), alight = nearest(dest);
    if (!board.s || board.s.stop_id === alight.s.stop_id) continue;  // misma parada: más rápido caminar
    all.push({ routeId, from: board.s, to: alight.s, dir: board.s.order < alight.s.order ? "outbound" : "return",
      stops: Math.abs(alight.s.order - board.s.order), walkFrom: board.m, walkTo: alight.m });
  }
  all.sort((a, b) => a.walkFrom + a.walkTo - (b.walkFrom + b.walkTo) || a.stops - b.stops);
  const near = all.filter((t) => t.walkFrom <= maxWalk && t.walkTo <= maxWalk);
  return near.length ? near.slice(0, limit) : all.slice(0, 1).map((t) => ({ ...t, far: true }));
}

if (typeof module !== "undefined") module.exports = { walkRideWalk, distanceM, MAX_WALK_M };
