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

Interfaz con la identidad del SETP Pasto (Avante): naranja `#E05018`, verde `#00A858` y fondo crema, tomados de la
guía oficial de rutas; tema oscuro según el sistema. Historias UX-01 a UX-11 (mockups interactivos en el lienzo
«MoveIU · Rediseño SETP»).

* **Acceso:** crear cuenta o entrar; si el correo ya existe, ofrece entrar con él. Al vencer la sesión avisa y vuelve al acceso.
* **Buscar ruta (UX-03):** por número («12»), nombre o barrio por el que pasa («tamasagra», sin tildes), con origen, destino y tipo.
* **Mis rutas (UX-02):** hasta 5; se recuerdan en este navegador. Sin rutas, el mapa muestra tenues todas las paradas de la ciudad.
* **Mapa en vivo:** al elegir una ruta el mapa vuela a su recorrido, la línea se dibuja y las paradas aparecen escalonadas; el regreso por otras calles va punteado. Los buses se deslizan entre lecturas.
* **Ocupación accesible (UX-07):** cada bus lleva color, icono y texto; el lector de pantalla anuncia ruta, estado y sillas libres.
* **Cerca de mí (UX-04):** con permiso del navegador, las 3 paradas más cercanas con distancia a pie y sus rutas. La ubicación no sale del navegador.
* **Planear viaje (UX-05):** sugerencias mientras se escribe, «Mi ubicación» como origen e «Ir desde / hasta aquí» desde una parada.
* **Mis paradas (UX-08):** estrella en la parada; muestra el próximo bus y su llegada; «Deshacer» al quitarla.
* **Bus:** ocupación, sillas libres y «Mostrar ocupación real del bus #…» con el plano o el gemelo 3D.
* **Parada:** «este bus o el siguiente» en ida o regreso, con el recomendado y el tiempo estimado de llegada.
* **Recorrido guiado (UX-06):** tres pasos la primera vez; se repite con el botón «?».
* **Conexión (UX-09, UX-10):** franja «Sin conexión · reintentando» / «De nuevo en vivo», buses atenuados y siluetas mientras carga.
* **Operación (UX-11, administrador y auditor):** indicadores de toda la flota (en servicio, ocupación, sobrecupo, sin reportar) que filtran los hallazgos; análisis por IA.
* **Simulación y emulación:** buses ficticios solo en este navegador, con aviso de que no son datos reales.
* **Accesibilidad:** foco visible, navegación con teclado, contraste AA y `prefers-reduced-motion`.

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
