// Configuracion del cliente web: lo unico que cambia por entorno.
// apiBaseUrl vacio = mismo origen (el proxy -Caddy o CloudFront- sirve el front, /api/* y /ws/* en un solo dominio).
window.APP_CONFIG = {
  apiBaseUrl: "",          // p. ej. "https://api.capacidadbus.co"
  defaultRoutes: ["C1"],   // rutas que se muestran al entrar (maximo 5)
  mapCenter: [1.2136, -77.2811],
  mapZoom: 14,
  // Servidor de teselas. El de openstreetmap.org NO admite uso intensivo en producción:
  // autoaloje uno (ver docs/despliegue-opensource.md) y ponga aquí su URL, p. ej. "/tiles/{z}/{x}/{y}.png".
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileAttribution: "&copy; OpenStreetMap",
};
