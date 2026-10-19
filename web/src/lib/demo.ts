/**
 * Modo demostración: el front funciona solo, con la flota simulada de `src/mock`, cuando no hay back-end.
 *
 *  - `NEXT_PUBLIC_DEMO=on`   siempre demostración (por ejemplo, un despliegue de vista previa sin back-end).
 *  - `NEXT_PUBLIC_DEMO=auto` (por omisión) datos reales; si el back-end no responde, pasa a demostración.
 *  - `NEXT_PUBLIC_DEMO=off`  nunca demostración: muestra el error.
 *  La dirección `?demo=1` o `?demo=0` lo fuerza en esa visita.
 */
export type DemoSetting = "on" | "off" | "auto";

export const DEMO_SETTING: DemoSetting = (() => {
  const raw = (process.env.NEXT_PUBLIC_DEMO ?? "auto").toLowerCase();
  return raw === "on" || raw === "off" ? raw : "auto";
})();

/** La demostración corre más rápido que el reloj real para que en un recorrido de minutos se vea movimiento. */
export const DEMO_SPEED = 4;

let active = false;

export function isDemo(): boolean {
  return active;
}

export function setDemo(on: boolean): void {
  active = on;
}

/** Hora simulada (ms) que usan el mapa, la lista y el plano de la cabina. */
export function demoNow(): number {
  return Date.now() * DEMO_SPEED;
}

/** ¿Debe iniciar en demostración? Lee `?demo=` y la configuración; no toca el almacenamiento del navegador. */
export function wantsDemoAtStart(search: string): boolean {
  const param = new URLSearchParams(search).get("demo");
  if (param === "1" || param === "true") return true;
  if (param === "0" || param === "false") return false;
  return DEMO_SETTING === "on";
}
