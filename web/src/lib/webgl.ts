/** ¿Puede este navegador dibujar el mapa vectorial (WebGL)? Si no, se usa el mapa esquemático. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
