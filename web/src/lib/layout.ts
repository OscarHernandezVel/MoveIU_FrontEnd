/**
 * Floor plan of the 1:20 maqueta bus (mm from the inner face of the front wall; y from the right, door side).
 * Sized for LEGO minifigures (seat 30 mm). Same numbers as edge/maqueta/make_cut_files.py and the 3D twin:
 * 41 seats + 8 standing positions = 49.
 */
export interface Spot {
  id: string;
  kind: "seat" | "stand";
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const INNER_W = 160;
export const FLOOR_L = 714;
const DOUBLE_W = 61;
const AISLE = 38;

export function buildLayout(): Spot[] {
  const starts = [54, ...Array.from({ length: 8 }, (_, i) => 108 + i * 54), 540];
  const spots: Spot[] = [];
  starts.forEach((start, k) => {
    const row = k + 1;
    const offset = row === 1 ? 2 : row === 10 ? 20 : 10;
    const sides = row === 1 || row === 10 ? ["L"] : ["R", "L"]; // the door takes the right side of rows 1 and 10
    for (const side of sides) {
      for (const n of [1, 2]) {
        const o = (n - 1) * 31;
        spots.push({
          id: `S${String(row).padStart(2, "0")}-${side}${n}`,
          kind: "seat", row, x: start + offset, y: side === "R" ? o : INNER_W - 30 - o, w: 30, h: 30,
        });
      }
    }
    if (row >= 2 && row <= 9) {
      spots.push({ id: `P${String(row).padStart(2, "0")}`, kind: "stand", row, x: start + 8, y: DOUBLE_W + 4, w: 42, h: AISLE - 8 });
    }
  });
  for (let i = 1; i <= 5; i++) {
    spots.push({ id: `S11-T${i}`, kind: "seat", row: 11, x: 616, y: 2 + (i - 1) * 31.2 + 0.6, w: 30, h: 30 });
  }
  return spots;
}
