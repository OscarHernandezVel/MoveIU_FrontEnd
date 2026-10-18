import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLayout } from "./layout.ts";

test("the plan has 41 seats and 8 standing positions with unique ids", () => {
  const spots = buildLayout();
  assert.equal(spots.filter((s) => s.kind === "seat").length, 41);
  assert.equal(spots.filter((s) => s.kind === "stand").length, 8);
  assert.equal(new Set(spots.map((s) => s.id)).size, 49);
});

test("rows with a door have seats only on the left, and standing needs seats on both sides", () => {
  const spots = buildLayout();
  for (const row of [1, 10]) {
    assert.ok(spots.filter((s) => s.row === row).every((s) => s.id.includes("-L")));
  }
  for (const p of spots.filter((s) => s.kind === "stand")) {
    const sides = new Set(spots.filter((s) => s.row === p.row && s.kind === "seat").map((s) => s.id.split("-")[1]![0]));
    assert.deepEqual([...sides].sort(), ["L", "R"]);
  }
});

test("no two spots overlap on the floor", () => {
  const spots = buildLayout();
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i]!, b = spots[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlap, false, `${a.id} overlaps ${b.id}`);
    }
  }
});
