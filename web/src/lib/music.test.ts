import assert from "node:assert/strict";
import { test } from "node:test";
import { clamp01, formatTime, neighbour, parseCatalog } from "./music.ts";

const good = { id: "alba", title: " Alba ", artist: "MoveIU", file: "/musica/alba.mp3", seconds: 69.4, license: "propia" };

test("el catálogo acepta pistas internas y limpia los campos", () => {
  const [track] = parseCatalog({ version: 1, tracks: [good] });
  assert.equal(track?.title, "Alba");
  assert.equal(track?.seconds, 69);
});

test("el catálogo descarta URLs externas, esquemas peligrosos, rutas con .. e ids repetidos", () => {
  const bad = [
    { ...good, id: "a", file: "https://example.com/x.mp3" },
    { ...good, id: "b", file: "javascript:alert(1)" },
    { ...good, id: "c", file: "/musica/../secreto.mp3" },
    { ...good, id: "d", file: "/otra-carpeta/x.mp3" },
    { ...good, id: "Mal Id" },
    { ...good, id: "e", title: "" },
    good,
    good,
  ];
  assert.deepEqual(parseCatalog({ tracks: bad }).map((t) => t.id), ["alba"]);
});

test("un catálogo mal formado no lanza: devuelve una lista vacía", () => {
  for (const raw of [null, undefined, 3, "x", {}, { tracks: "x" }, { tracks: [null, 1] }]) {
    assert.deepEqual(parseCatalog(raw), []);
  }
});

test("siguiente y anterior respetan el modo de repetición", () => {
  assert.equal(neighbour(0, 3, 1, "off"), 1);
  assert.equal(neighbour(2, 3, 1, "off"), null);
  assert.equal(neighbour(2, 3, 1, "all"), 0);
  assert.equal(neighbour(0, 3, -1, "all"), 2);
  assert.equal(neighbour(0, 3, -1, "off"), null);
  assert.equal(neighbour(1, 3, 1, "one"), 1);
  assert.equal(neighbour(0, 0, 1, "all"), null);
});

test("formato de tiempo y volumen acotado", () => {
  assert.equal(formatTime(69.9), "1:09");
  assert.equal(formatTime(-1), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(Number.NaN), 0);
});
