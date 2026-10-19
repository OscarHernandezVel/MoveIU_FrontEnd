"""Regenera src/mock/routes.ts a partir de demo_data/pasto_c1_c4.json (trazados simplificados + 8 paradas por ruta).

    python3 tools/generar_rutas_demo.py            # busca el archivo en ../backend/demo_data o ../demo_data
"""

from __future__ import annotations

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SOURCE = next(p for p in (HERE.parent / "backend" / "demo_data", HERE.parent / "demo_data") if (p / "pasto_c1_c4.json").exists()) / "pasto_c1_c4.json"


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-12
    best, index = 0.0, 0
    for i in range(1, len(points) - 1):
        x, y = points[i]
        distance = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
        if distance > best:
            best, index = distance, i
    if best > tolerance:
        return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)
    return [points[0], points[-1]]


def main() -> None:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    stops = {s["stop_id"]: s for s in data["stops"]}
    routes = []
    for route in data["routes"]:
        path = simplify([tuple(p) for p in route["path"]], 0.00012)
        ids = route["stops"]
        picked: list[str] = []
        for i in range(8):
            stop_id = ids[round(i * (len(ids) - 1) / 7)]
            if stop_id not in picked:
                picked.append(stop_id)
        routes.append(
            {
                "route_id": route["route_id"],
                "name": route["name"],
                "path": [[round(x, 5), round(y, 5)] for x, y in path],
                "stops": [
                    {"stop_id": i, "name": stops[i]["name"], "lat": stops[i]["lat"], "lng": stops[i]["lng"]} for i in picked
                ],
            }
        )
    header = (HERE / "src" / "mock" / "routes.ts").read_text(encoding="utf-8").split("export const MOCK_ROUTES")[0]
    (HERE / "src" / "mock" / "routes.ts").write_text(
        header + "export const MOCK_ROUTES: MockRoute[] = " + json.dumps(routes, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
