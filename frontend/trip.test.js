// Prueba del planificador: node frontend/trip.test.js
"use strict";
const assert = require("node:assert");
const { walkRideWalk, distanceM } = require("./trip.js");

const stop = (id, order, lat, lng) => ({ stop_id: id, name: id, order, location: { lat, lng } });
const m = 0.0009;  // ≈ 100 m de latitud
const routes = new Map([
  ["A", { stops: [stop("A1", 1, 0, 0), stop("A2", 2, 10 * m, 0), stop("A3", 3, 20 * m, 0)] }],
  ["B", { stops: [stop("B1", 1, 20 * m, 3 * m), stop("B2", 2, 40 * m, 3 * m)] }],
]);

// Las dos paradas exactas en la misma ruta: cero caminata, de ida.
let [best] = walkRideWalk(routes, { lat: 0, lng: 0 }, { lat: 20 * m, lng: 0 });
assert.deepStrictEqual([best.routeId, best.from.stop_id, best.to.stop_id, best.dir], ["A", "A1", "A3", "outbound"]);
assert.ok(best.walkFrom < 1 && best.walkTo < 1);

// Sentido contrario: regreso.
[best] = walkRideWalk(routes, { lat: 20 * m, lng: 0 }, { lat: 0, lng: 0 });
assert.strictEqual(best.dir, "return");

// Ninguna ruta pasa por el destino (B2 + 300 m): baja en la más cercana y camina; la ruta A no sirve (mismo lado).
const trips = walkRideWalk(routes, { lat: 21 * m, lng: 2 * m }, { lat: 43 * m, lng: 3 * m });
assert.deepStrictEqual(trips.map((t) => t.routeId), ["B"]);
assert.ok(Math.abs(trips[0].walkTo - 300) < 5, "≈ 300 m a pie hasta el destino real");

// Todo a más de 800 m: igual recomienda la ruta más cercana, marcada como lejana.
const far = walkRideWalk(routes, { lat: 0, lng: 50 * m }, { lat: 40 * m, lng: 50 * m });
assert.strictEqual(far.length, 1);
assert.ok(far[0].far && far[0].walkFrom > 800);

assert.ok(Math.abs(distanceM({ lat: 0, lng: 0 }, { lat: m, lng: 0 }) - 100) < 1);
console.log("ok: viaje exacto, regreso, caminar hasta el destino y ruta más cercana cuando todo queda lejos");
