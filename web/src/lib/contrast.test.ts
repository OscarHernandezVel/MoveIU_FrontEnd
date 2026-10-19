/**
 * Legibilidad con poco brillo: lee los tokens de color de app/globals.css y comprueba las razones de contraste (WCAG 2.x).
 *  - día: texto ≥ 7:1 (AAA) para el texto principal y ≥ 4.5:1 (AA) para estados y secundarios
 *  - noche y alto contraste: ≥ 7:1 en todo el texto, y ≥ 3:1 en bordes y trazos de los dibujos
 * Con poco brillo la pantalla pierde luminancia pero no cambia la razón entre colores: partir de razones altas es lo que
 * mantiene la lectura.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

/** Cuerpo `{ ... }` que sigue a un selector exacto. */
function body(selector: string, from = 0): string {
  const at = css.indexOf(selector + " {", from);
  assert.ok(at >= 0, `no se encontró ${selector}`);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

const THEMES = {
  day: tokens(body(":root")),
  night: tokens(body(':root[data-theme="night"]')),
  contrast: tokens(body(':root[data-theme="contrast"]')),
};

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const STATES = ["ok", "warn", "full", "over", "none"];
const ROUTES = ["r1", "r2", "r3", "r4"];

for (const [name, t] of Object.entries(THEMES)) {
  const strict = name !== "day" ? 7 : 4.5;
  test(`${name}: el texto principal y el secundario se leen sobre el fondo y las tarjetas`, () => {
    for (const bg of ["bg", "card", "soft"]) {
      assert.ok(ratio(t.fg!, t[bg]!) >= 7, `fg/${bg} = ${ratio(t.fg!, t[bg]!).toFixed(2)}`);
      assert.ok(ratio(t.muted!, t[bg]!) >= (name === "day" ? 7 : 7), `muted/${bg} = ${ratio(t.muted!, t[bg]!).toFixed(2)}`);
    }
  });
  test(`${name}: los estados de ocupación y las rutas tienen contraste sobre la tarjeta`, () => {
    for (const k of [...STATES, ...ROUTES]) assert.ok(ratio(t[k]!, t.card!) >= strict, `${k} = ${ratio(t[k]!, t.card!).toFixed(2)}`);
  });
  test(`${name}: bordes, acento y botón principal`, () => {
    assert.ok(ratio(t.line!, t.card!) >= 3, `line = ${ratio(t.line!, t.card!).toFixed(2)}`);
    assert.ok(ratio(t.line!, t.bg!) >= 3, `line/bg = ${ratio(t.line!, t.bg!).toFixed(2)}`);
    assert.ok(ratio(t.accent!, t.card!) >= strict, `accent = ${ratio(t.accent!, t.card!).toFixed(2)}`);
    assert.ok(ratio(t["accent-fg"]!, t.accent!) >= 7, `accent-fg = ${ratio(t["accent-fg"]!, t.accent!).toFixed(2)}`);
  });
}

test("los temas automáticos (media queries) repiten exactamente los tokens del tema explícito", () => {
  const dark = css.indexOf("@media (prefers-color-scheme: dark)");
  const more = css.indexOf("@media (prefers-contrast: more)");
  assert.deepEqual(tokens(body(":root:not([data-theme])", dark)), THEMES.night);
  assert.deepEqual(tokens(body(":root:not([data-theme])", more)), THEMES.contrast);
  assert.deepEqual(tokens(body(':root[data-theme="day"]')), THEMES.day);
});

test("las rutas se distinguen entre sí en cada tema (no solo por el trazo)", () => {
  for (const t of Object.values(THEMES)) {
    const colors = ROUTES.map((k) => t[k]);
    assert.equal(new Set(colors).size, 4);
  }
});
