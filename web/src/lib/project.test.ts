import assert from "node:assert/strict";
import { test } from "node:test";
import { fit } from "./project.ts";

const pts = [
  { lat: 1.19, lng: -77.31 },
  { lat: 1.23, lng: -77.27 },
];

test("todos los puntos caen dentro del lienzo, con margen, y el norte queda arriba", () => {
  const p = fit(pts, 360, 300, 20);
  for (const q of pts) {
    assert.ok(p.x(q.lng) >= 19.99 && p.x(q.lng) <= 340.01);
    assert.ok(p.y(q.lat) >= 19.99 && p.y(q.lat) <= 280.01);
  }
  assert.ok(p.y(1.23) < p.y(1.19));
  assert.ok(p.x(-77.27) > p.x(-77.31));
});

test("conserva las proporciones: un grado de longitud y de latitud no se deforman entre sí", () => {
  const p = fit(pts, 800, 800, 0);
  const dx = (p.x(-77.27) - p.x(-77.31)) / (0.04 * Math.cos((1.21 * Math.PI) / 180));
  const dy = (p.y(1.19) - p.y(1.23)) / 0.04;
  assert.ok(Math.abs(dx - dy) / dy < 1e-6);
});

test("un lienzo sin tamaño o sin puntos no produce NaN", () => {
  assert.equal(fit([], 100, 100, 5).x(1), 0);
  assert.equal(fit(pts, 0, 0, 5).y(1), 0);
  assert.ok(Number.isFinite(fit([pts[0]!], 100, 100, 5).x(-77.31)));
});
