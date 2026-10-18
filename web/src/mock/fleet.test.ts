import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLayout } from "../lib/layout.ts";
import { MOCK_BUSES, MOCK_BUS_IDS, mockBuses, mockCabin, mockRoutes, occupancyFor, peopleAt, positionAt, stateFor } from "./fleet.ts";
import { MOCK_ROUTES } from "./routes.ts";

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

test("los estados siguen las reglas de la aplicación (41 sillas + 8 de pie)", () => {
  assert.equal(stateFor(10), "available_seats");
  assert.equal(stateFor(41), "standing_only");
  assert.equal(stateFor(48), "standing_only");
  assert.equal(stateFor(49), "full");
  assert.equal(stateFor(53), "overcrowded");
  const o = occupancyFor(45);
  assert.deepEqual([o.seated, o.standing, o.free_seats, o.free_standing, o.percentage], [41, 4, 0, 4, 92]);
});

test("en una hora de simulación se ven los estados que muestra el recorrido", () => {
  const seen = new Set<string>();
  for (let s = 0; s < 3600; s += 5) for (const b of MOCK_BUSES) seen.add(stateFor(peopleAt(b, T0 + s * 1000)));
  for (const state of ["available_seats", "standing_only", "full", "overcrowded"]) assert.ok(seen.has(state), state);
});

test("los buses quedan sobre el trazado de su ruta y se mueven con el tiempo", () => {
  for (const route of MOCK_ROUTES) {
    const lngs = route.path.map((p) => p[0]);
    const lats = route.path.map((p) => p[1]);
    for (const f of [0, 0.25, 0.5, 0.999, 1.3, -0.2]) {
      const p = positionAt(route.route_id, f);
      assert.ok(p.lng >= Math.min(...lngs) - 1e-9 && p.lng <= Math.max(...lngs) + 1e-9);
      assert.ok(p.lat >= Math.min(...lats) - 1e-9 && p.lat <= Math.max(...lats) + 1e-9);
    }
  }
  const a = mockBuses(["C1"], T0)[0]!.buses[0]!.location;
  const b = mockBuses(["C1"], T0 + 30_000)[0]!.buses[0]!.location;
  assert.notDeepEqual(a, b);
});

test("el plano de la cabina coincide con los conteos y usa ids reales del plano", () => {
  const valid = new Set(buildLayout().map((s) => s.id));
  for (const id of MOCK_BUS_IDS) {
    for (let s = 0; s < 1200; s += 37) {
      const cabin = mockCabin(id, T0 + s * 1000)!;
      assert.ok(cabin.occupied.every((x) => valid.has(x)));
      assert.equal(new Set(cabin.occupied).size, cabin.occupied.length);
      const seats = cabin.occupied.filter((x) => x.startsWith("S")).length;
      assert.equal(seats, cabin.counts.seated);
      assert.equal(cabin.occupied.length, cabin.counts.seated + cabin.counts.standing - cabin.counts.standing_out_of_position);
    }
  }
  assert.equal(mockCabin("9999", T0), null);
});

test("la lista de buses y el plano de la cabina del mismo instante cuentan lo mismo", () => {
  const row = mockBuses(["C1"], T0)[0]!.buses.find((b) => b.bus_id === "2101")!;
  const cabin = mockCabin("2101", T0)!;
  assert.equal(row.occupancy.seated, cabin.counts.seated);
  assert.equal(row.occupancy.standing, cabin.counts.standing);
});

test("las rutas de demostración traen trazado y paradas", () => {
  const routes = mockRoutes();
  assert.equal(routes.length, 4);
  for (const r of routes) assert.ok((r.path?.length ?? 0) > 20 && r.stops.length >= 6);
});
