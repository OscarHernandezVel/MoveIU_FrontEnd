# MoveIU — frontend (cliente web)

Página estática que muestra en un mapa los buses de hasta 5 rutas y su ocupación en tiempo real.
No necesita compilación: HTML + CSS + JavaScript y **Leaflet 1.9** (desde cdnjs) con mapas de OpenStreetMap.

| Archivo | Contenido |
|---|---|
| `index.html` | Estructura: inicio de sesión, lista de rutas y buses, mapa |
| `app.js` | Sesión (JWT con renovación automática), WebSocket `/ws/v1/buses/stream` (*snapshot* + *deltas*, `resync` si falta un `seq`, reconexión con espera creciente) |
| `config.js` | URL del backend, rutas iniciales y centro del mapa — **lo único que cambia por entorno** |
| `styles.css` | Estilos con modo claro/oscuro y diseño adaptable a celular |

## Usarlo en local

1. Backend corriendo en `http://127.0.0.1:8080` con `CORE_CORS_ORIGINS=http://localhost:5500` (ver `../README.md`).
2. En `config.js`: `apiBaseUrl: "http://127.0.0.1:8080"`.
3. `python -m http.server 5500` dentro de esta carpeta y abrir `http://localhost:5500`.
4. Crear una cuenta con `POST /api/v1/auth/register` (o desde `/docs` del backend) e iniciar sesión.

## Producción

Se publica en **S3 + CloudFront**. Con CloudFront enrutando
`/api/*` y `/ws/*` al backend, deje `apiBaseUrl: ""` (mismo dominio, sin CORS).

## Limitaciones

* Solo inicio de sesión con cuenta: el modo invitado (`/auth/guest`) acepta hoy solo `android`/`ios`.
* No crea alertas de proximidad (requieren un dispositivo con token push); eso corresponde a la app móvil.
* El token de refresco se guarda en `sessionStorage` (se pierde al cerrar la pestaña).
