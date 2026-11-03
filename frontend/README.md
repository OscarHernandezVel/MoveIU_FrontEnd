# MoveIU — frontend (cliente web)

Página estática que muestra en un mapa los buses de hasta 5 rutas y su ocupación en tiempo real.
No necesita compilación: HTML + CSS + JavaScript y **Leaflet 1.9** (desde cdnjs) con mapas de OpenStreetMap.

| Archivo | Contenido |
|---|---|
| `index.html` | Estructura: acceso (entrar / crear cuenta), mapa con rutas y buses, panel del bus o de la parada, vista de operación |
| `app.js` | Sesión (JWT con renovación automática), WebSocket `/ws/v1/buses/stream` (*snapshot* + *deltas*, `resync` si falta un `seq`, reconexión con espera creciente), rutas, paradas, hallazgos y análisis |
| `cabin.js` | Plano de la cabina armado con los identificadores de posición (`S02-L1`, `P04`…): ninguna imagen sale del bus |
| `emulation.js` | Emulación: buses ficticios que recorren el trazado real de cada ruta y suben o bajan pasajeros (solo en el navegador) |
| `gemelo/` | Gemelo 3D de la cabina (three.js r128, MIT, servido desde el mismo sitio); el panel del bus le pasa cada lectura |
| `config.js` | URL del backend, rutas iniciales y centro del mapa — **lo único que cambia por entorno** |
| `styles.css` | Tema «Pasto de noche» (oscuro, y claro según el sistema), transiciones animadas, diseño para celular y movimiento reducido |

## Qué hace

* **Acceso:** crear cuenta o entrar; si el correo ya existe, ofrece entrar con él. Al vencer la sesión avisa y vuelve al acceso.
* **Mapa en vivo:** hasta 5 rutas; cada una dibuja su recorrido y sus paradas. Los buses se deslizan entre lecturas (cada 3 s) y la lista se ordena por más espacio primero.
* **Bus:** ocupación, sillas libres, sitios de pie y el botón «Mostrar ocupación real del bus #…», que muestra el plano de la cabina y avisa si el plano no está al día.
* **Parada:** «este bus o el siguiente» en ida o regreso, con el recomendado resaltado.
* **Estado:** En vivo / Conectando / Reconectando (los buses se atenúan mientras no hay datos frescos).
* **Cabina 3D:** en el panel del bus, el plano o el gemelo 3D visto desde la cámara frontal, la trasera o libre.
* **Simulación:** el botón «Iniciar simulación» de la barra superior (o el de la vista Emulación) la enciende; un aviso ámbar indica que está activa y «Salir» vuelve a los datos reales.
* **Emulación:** buses ficticios en todas las rutas, con escenario (valle, normal, pico), indicadores de la flota y la opción de verlos en el mapa. No envía nada al backend.
* **Operación** (solo administrador y auditor): hallazgos por reglas o IA y análisis de la flota.
* **Accesibilidad:** el color nunca es la única señal, foco visible, navegación con teclado y `prefers-reduced-motion`.

## Usarlo en local

1. Backend corriendo en `http://127.0.0.1:8080` con `CORE_CORS_ORIGINS=http://localhost:5500` (ver `../README.md`).
2. En `config.js`: `apiBaseUrl: "http://127.0.0.1:8080"`.
3. `python -m http.server 5500` dentro de esta carpeta y abrir `http://localhost:5500`.
4. Crear una cuenta desde la pestaña «Crear cuenta» e iniciar sesión.

## Producción

Lo sirve el mismo proxy que enruta `/api/*` y `/ws/*` al backend (Caddy en la EC2, o S3 + CloudFront),
con `apiBaseUrl: ""` (mismo dominio, sin CORS). Para actualizar basta `git pull` en el servidor: los archivos
llevan `?v=N` en `index.html`; súbalo al cambiar CSS o JS para que los navegadores no usen la copia vieja.

## Limitaciones

* Solo inicio de sesión con cuenta: el modo invitado (`/auth/guest`) acepta hoy solo `android`/`ios`.
* No crea alertas de proximidad (requieren un dispositivo con token push); eso corresponde a la app móvil.
* El token de refresco se guarda en `sessionStorage` (se pierde al cerrar la pestaña).
