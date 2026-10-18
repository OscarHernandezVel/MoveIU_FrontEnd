import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMessage, backoff, type RouteState } from "./feed.ts";
import type { ServerMessage, WsBus } from "./types.ts";

const bus = (id: string, pct = 50): WsBus => ({
  bus: id, dir: "outbound", lat: 1.2, lng: -77.28, pct, state: "available_seats", seated: 10, standing: 0,
  free_seats: 30, free_standing: 8, wheelchair: true, conf: 0.9, approx: false, off_route: false, ts: 1,
});
const snapshot = (seq: number, ...buses: WsBus[]): ServerMessage => ({
  v: 1, type: "snapshot", channel: "fleet", route: "C1", seq, ts: 1, buses,
});
const delta = (seq: number, upsert: WsBus[], remove: string[] = []): ServerMessage => ({
  v: 1, type: "delta", channel: "fleet", route: "C1", seq, ts: 1, upsert, remove,
});

test("a snapshot replaces the route and a consecutive delta updates it", () => {
  const routes = new Map<string, RouteState>();
  assert.equal(applyMessage(routes, snapshot(7, bus("2101"), bus("2102"))), null);
  assert.equal(applyMessage(routes, delta(8, [bus("2101", 90)], ["2102"])), null);
  const state = routes.get("C1")!;
  assert.equal(state.seq, 8);
  assert.deepEqual([...state.buses.keys()], ["2101"]);
  assert.equal(state.buses.get("2101")!.percentage, 90);
});

test("a jump in seq drops the route and asks for a resync", () => {
  const routes = new Map<string, RouteState>();
  applyMessage(routes, snapshot(7, bus("2101")));
  assert.deepEqual(applyMessage(routes, delta(9, [bus("2101", 99)])), { kind: "resync", route: "C1" });
  assert.equal(routes.has("C1"), false);
});

test("a duplicate or old delta is ignored", () => {
  const routes = new Map<string, RouteState>();
  applyMessage(routes, snapshot(7, bus("2101", 10)));
  assert.equal(applyMessage(routes, delta(7, [bus("2101", 99)])), null);
  assert.equal(routes.get("C1")!.buses.get("2101")!.percentage, 10);
});

test("a delta before any snapshot asks for the full state", () => {
  const routes = new Map<string, RouteState>();
  assert.deepEqual(applyMessage(routes, delta(1, [bus("2101")])), { kind: "resync", route: "C1" });
});

test("backoff doubles, is capped at 30 s and keeps the jitter under 25%", () => {
  assert.equal(backoff(0, () => 0), 1000);
  assert.equal(backoff(3, () => 0), 8000);
  assert.equal(backoff(10, () => 0), 30_000);
  assert.equal(backoff(10, () => 1), 37_500);
});
