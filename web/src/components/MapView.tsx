"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { STATE_INFO } from "@/lib/occupancy";
import type { Bus, RouteInfo } from "@/lib/types";

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
const PASTO: [number, number] = [-77.2811, 1.2136];

function markerElement(bus: Bus): HTMLElement {
  const el = document.createElement("a");
  el.href = `/bus/${encodeURIComponent(bus.id)}`;
  paint(el, bus);
  return el;
}

function paint(el: HTMLElement, bus: Bus): void {
  const info = STATE_INFO[bus.state];
  el.className = `bus-marker tone-${info.tone}`;
  el.textContent = `${bus.routeId} ${info.glyph} ${bus.state === "no_data" ? "" : bus.percentage + "%"}`.trim();
  el.setAttribute("aria-label", `Bus ${bus.id}, ruta ${bus.routeId}: ${info.label}, ${bus.percentage}% de ocupación`);
}

export function MapView({ buses, routes, selected }: { buses: Bus[]; routes: RouteInfo[]; selected: string[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLElement }>());
  const stopMarkers = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef("");

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({ container: container.current, style: STYLE, center: PASTO, zoom: 12.5 });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current = instance;
    const live = markers.current;
    return () => {
      live.clear();
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const live = markers.current;
    const seen = new Set<string>();
    for (const bus of buses) {
      seen.add(bus.id);
      const entry = live.get(bus.id);
      if (entry) {
        entry.marker.setLngLat([bus.lng, bus.lat]);
        paint(entry.el, bus);
      } else {
        const el = markerElement(bus);
        live.set(bus.id, { el, marker: new maplibregl.Marker({ element: el }).setLngLat([bus.lng, bus.lat]).addTo(instance) });
      }
    }
    for (const [id, entry] of live) {
      if (!seen.has(id)) {
        entry.marker.remove();
        live.delete(id);
      }
    }
  }, [buses]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    stopMarkers.current.forEach((m) => m.remove());
    stopMarkers.current = [];
    const chosen = routes.filter((r) => selected.includes(r.route_id));
    const points: [number, number][] = [];
    for (const route of chosen) {
      for (const stop of route.stops) {
        const dot = document.createElement("span");
        dot.className = "stop-dot";
        dot.title = stop.name;
        stopMarkers.current.push(
          new maplibregl.Marker({ element: dot }).setLngLat([stop.location.lng, stop.location.lat]).addTo(instance),
        );
        points.push([stop.location.lng, stop.location.lat]);
      }
    }
    const key = selected.join(",");
    if (points.length && fitted.current !== key) {
      fitted.current = key;
      const bounds = points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(points[0]!, points[0]!));
      instance.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 });
    }
  }, [routes, selected]);

  return <div ref={container} className="map" role="application" aria-label="Mapa de buses en tiempo real" />;
}
