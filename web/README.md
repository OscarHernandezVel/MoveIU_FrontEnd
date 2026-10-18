# web: front de MoveIU

Next.js 16 (App Router) + TypeScript + MapLibre GL + Zustand. Todo de código abierto; el mapa usa un estilo
vectorial abierto en lugar de Mapbox.

| Ruta | Qué muestra |
|---|---|
| `/` | Mapa con los buses de hasta 5 rutas, lista con estado (texto + símbolo, nunca solo color) |
| `/bus/[id]` | Plano 2D de la cabina con sillas y posiciones de pie ocupadas (`GET /buses/{id}/cabin`) |
| `/recorrido` | **Recorrido guiado** de 7 pasos con datos simulados: mapa, rutas, ocupación, cabina, privacidad, gemelo 3D y música |
| `/musica` | Módulo secundario: reproductor con 4 pistas originales internas (`public/musica`) |
| `/arquitectura/index.html` | Interfaz 3D: arquitectura de 5 módulos y gemelo digital del bus (Three.js) |

## Uso

```bash
cp .env.example .env.local      # BACKEND_URL, NEXT_PUBLIC_WS_URL, NEXT_PUBLIC_MAP_STYLE
npm install
npm run dev                     # http://localhost:3000 (el servicio Python en BACKEND_URL)
npm test                        # protocolo WebSocket (snapshot/delta/resync) y reconexión
npm run build
```

## Modo demostración y recorrido

Sin servidor, el front sigue siendo útil: `src/mock` simula una flota (6 buses en las 4 rutas de `demo_data`, con
ocupación que sube y baja hasta mostrar los estados «hay sillas», «solo de pie», «lleno» y «sobrecupo») como una función pura del
tiempo, así que el mapa, la lista y el plano de la cabina siempre coinciden. `NEXT_PUBLIC_DEMO=auto` (por omisión) usa datos
reales y cae a la demostración si el servidor no responde, avisándolo en pantalla; `?demo=1` / `?demo=0` lo fuerzan.
En demostración el mapa es esquemático (SVG: sin WebGL, sin teselas, sin red); también se usa si el navegador no soporta WebGL.

## Legibilidad con poco brillo y celulares

* Tres temas por tokens de color: **día**, **noche (poco brillo)** y **alto contraste**. Por omisión siguen al sistema
  (`prefers-color-scheme`, `prefers-contrast`); el selector «Tema» lo fija y se recuerda. `npm test` comprueba las razones de
  contraste leyendo `globals.css` (texto principal ≥ 7:1 en los tres temas; en noche 16:1 y 10:1 el secundario).
* El estado nunca va solo en color (símbolo + palabra) y cada ruta tiene también su tipo de línea.
* Controles de 44 px o más, texto base de 16 px, áreas táctiles amplias en los marcadores, `viewport-fit=cover` y márgenes seguros.
* El plano de la cabina se dibuja **vertical** en pantallas angostas (sillas de ~45 px) y horizontal en las anchas.
* Compatibilidad: `browserslist` (iOS/Safari ≥ 15, Chrome/Android ≥ 100, Samsung ≥ 18, Firefox ≥ 100); sin dependencias de CDN
  (three.js va en `public/arquitectura`); respaldos para `crypto.randomUUID`, `matchMedia().addEventListener` y almacenamiento bloqueado.
* `python3 tools/verificar_movil.py http://localhost:3111 capturas/` recorre la aplicación en iPhone, Pixel y Android pequeño
  **emulados** (Chromium) y con brillo reducido. No prueba Safari (WebKit) ni Firefox reales: hágalo en un iPhone y un Android.
* Regenerar recursos: `tools/generar_pistas.py` (música) y `tools/generar_rutas_demo.py` (rutas de demostración).

## Cómo habla con el servicio

* REST: el navegador llama a `/api/v1/*` en su propio origen y `next.config.ts` lo reenvía a `BACKEND_URL`
  (sin CORS). La sesión es de invitado (`POST /auth/guest`) y se renueva sola (el *refresh* es de un solo uso).
* Tiempo real: si `NEXT_PUBLIC_WS_URL` está definida abre `WS /ws/v1/buses/stream`, manda el token en el
  primer mensaje (nunca en la URL), aplica `snapshot`/`delta` por `seq` y pide `resync` si hay un salto.
  Reconecta con espera exponencial (1 s … 30 s). Mientras el socket está caído, consulta
  `GET /buses/active` cada `NEXT_PUBLIC_POLL_SECONDS`. Sin la variable, usa solo ese sondeo.
* En Vercel los rewrites no sirven WebSocket: apunte `NEXT_PUBLIC_WS_URL` directo al servicio (`wss://…`) o
  deje el sondeo.

## Pendiente / no verificado

* No se ha probado contra un servicio desplegado ni en un celular real; solo compila, pasan las pruebas y se recorrió en
  navegadores móviles emulados. El estilo de mapa por defecto (OpenFreeMap) no se pudo comprobar desde el entorno de desarrollo.
* Sin registro de cuentas, alertas ni bandeja: solo mapa, lista y detalle.
