# MoveIU — Frontend

Clientes del pasajero del **Sistema de detección de capacidad neta de buses en tiempo real**. Ambos consumen
la API y el WebSocket del backend ([MoveIU_BackEnd](https://github.com/OscarHernandezVel/MoveIU_BackEnd)).

| Carpeta | Qué es | Tecnología | Despliegue |
|---|---|---|---|
| [`web/`](web/README.md) | App principal: mapa en vivo, ocupación por bus, plano de cabina, recorrido guiado y vista 3D | Next.js + TypeScript, MapLibre GL, Zustand | Vercel o servidor propio |
| [`frontend/`](frontend/README.md) | Cliente ligero sin compilación: mapa con los buses de hasta 5 rutas | HTML + CSS + JavaScript, Leaflet, OpenStreetMap | S3 + CloudFront |

## Inicio rápido

```bash
# App web
cd web
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000

# Cliente estático
cd frontend
python -m http.server 5500   # http://localhost:5500
```

Los dos necesitan el backend corriendo; la URL se configura en `web/.env.local` y en `frontend/config.js`.

## Repositorios del sistema

- **MoveIU_BackEnd**: API, cálculo de ocupación, alertas y orquestador analítico.
- **MoveIU_FrontEnd**: este repositorio.
- **MoveIU-Edge**: agente a bordo del bus (cámaras, sensores de puerta y GPS).
