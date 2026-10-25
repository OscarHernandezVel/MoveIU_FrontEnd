import assert from "node:assert/strict";
import { test } from "node:test";
import { TWIN_VIEWS, twinUrl } from "./twin.ts";

test("a camera view embeds the twin at that camera, reading the bus live", () => {
  const url = new URL(twinUrl("2101", "rear", true), "https://moveiu.example");
  assert.equal(url.pathname, "/arquitectura/index.html");
  assert.equal(url.hash, "#twin");
  assert.deepEqual(Object.fromEntries(url.searchParams), { bus: "2101", embed: "1", view: "rear", live: "1" });
});

test("the free 3D view has no camera, and demo mode does not read the service", () => {
  const url = new URL(twinUrl("2101", "3d", false), "https://moveiu.example");
  assert.equal(url.searchParams.has("view"), false);
  assert.equal(url.searchParams.has("live"), false);
});

test("bus ids are escaped and every view has a label", () => {
  assert.match(twinUrl("bus 7&x=1", "front", true), /bus=bus\+7%26x%3D1/);
  assert.deepEqual(TWIN_VIEWS.map((v) => v.id), ["front", "rear", "3d"]);
});
