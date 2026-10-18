/**
 * Flota simulada para el modo demostración. Todo es una **función pura del tiempo**: el mapa, la lista y el plano de
 * la cabina leen el mismo instante y por eso siempre coinciden, sin hilos ni estado que mantener.
 * Los buses recorren los trazados reales de `demo_data` (Pasto) y su ocupación sube y baja para que, en pocos
 * minutos, se vean los cinco estados de la aplicación.
 */
import { buildLayout } from "../lib/layout.ts";
import type { CabinSnapshot, Occupancy, OccupancyState, RestBus, RouteInfo } from "../lib/types.ts";
import { MOCK_ROUTES } from "./routes.ts";

export const SEATS = 41;
export const STANDING = 8;
const CAPACITY = SEATS + STANDING;

interface MockBus {
  id: string;
  route: string;
  /** Posición inicial en el recorrido, de 0 a 1. */
  phase: number;
  /** Segundos que tarda una vuelta completa. */
  lap: number;
  /** Personas a bordo: base ± amplitud, con la fase y el periodo (segundos) de la onda. */
  base: number;
  amp: number;
  wave: number;
  wavePhase: number;
}

export const MOCK_BUSES: MockBus[] = [
  { id: "2101", route: "C1", phase: 0.05, lap: 420, base: 30, amp: 24, wave: 150, wavePhase: 0.0 },
  { id: "2102", route: "C1", phase: 0.55, lap: 420, base: 14, amp: 10, wave: 180, wavePhase: 0.3 },
  { id: "2201", route: "C2", phase: 0.2, lap: 360, base: 38, amp: 15, wave: 140, wavePhase: 0.6 },
  { id: "2202", route: "C2", phase: 0.7, lap: 360, base: 22, amp: 14, wave: 160, wavePhase: 0.1 },
  { id: "2301", route: "C3", phase: 0.4, lap: 390, base: 28, amp: 22, wave: 170, wavePhase: 0.8 },
  { id: "2401", route: "C4", phase: 0.1, lap: 400, base: 8, amp: 8, wave: 200, wavePhase: 0.5 },
];

export const MOCK_BUS_IDS = MOCK_BUSES.map((b) => b.id);

const DEG_LAT = 1; // los trazados son locales (unos km): una escala plana por coseno de la latitud basta
function lengths(path: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1]!;
    const [x2, y2] = path[i]!;
    const k = Math.cos((y1 * Math.PI) / 180);
    out.push(out[i - 1]! + Math.hypot((x2 - x1) * k, (y2 - y1) * DEG_LAT));
  }
  return out;
}

const CUMULATIVE = new Map(MOCK_ROUTES.map((r) => [r.route_id, lengths(r.path)]));

/** Punto (lat, lng) a la fracción `fraction` (0-1) del largo de la ruta. */
export function positionAt(routeId: string, fraction: number): { lat: number; lng: number } {
  const route = MOCK_ROUTES.find((r) => r.route_id === routeId);
  const cumulative = CUMULATIVE.get(routeId);
  if (!route || !cumulative || route.path.length === 0) return { lat: 0, lng: 0 };
  const f = ((fraction % 1) + 1) % 1;
  const target = f * cumulative[cumulative.length - 1]!;
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i]! < target) i++;
  const span = cumulative[i]! - cumulative[i - 1]! || 1;
  const u = Math.min(1, Math.max(0, (target - cumulative[i - 1]!) / span));
  const [x1, y1] = route.path[i - 1]!;
  const [x2, y2] = route.path[i] ?? route.path[i - 1]!;
  return { lng: x1 + (x2 - x1) * u, lat: y1 + (y2 - y1) * u };
}

export function progressAt(bus: MockBus, nowMs: number): number {
  return (bus.phase + nowMs / 1000 / bus.lap) % 1;
}

/** Personas a bordo (0-56): puede pasar de 49 para mostrar el estado «sobrecupo». */
export function peopleAt(bus: MockBus, nowMs: number): number {
  const wave = Math.sin(2 * Math.PI * (nowMs / 1000 / bus.wave + bus.wavePhase));
  return Math.round(Math.min(56, Math.max(0, bus.base + bus.amp * wave)));
}

export function stateFor(people: number): OccupancyState {
  if (people <= 0) return "available_seats";
  if (people < SEATS) return "available_seats";
  if (people < CAPACITY) return "standing_only";
  if (people === CAPACITY) return "full";
  return "overcrowded";
}

export function occupancyFor(people: number): Occupancy {
  const seated = Math.min(SEATS, people);
  const standing = Math.max(0, people - SEATS);
  return {
    percentage: Math.round((people / CAPACITY) * 100),
    state: stateFor(people),
    label: "",
    icon: "",
    seated,
    standing,
    free_seats: SEATS - seated,
    free_standing: Math.max(0, STANDING - standing),
    wheelchair_free: false,
    people_on_board: people,
    approximate: false,
    confidence: 0.92,
  };
}

export function mockRoutes(): RouteInfo[] {
  return MOCK_ROUTES.map((r) => ({
    route_id: r.route_id,
    name: r.name,
    stops: r.stops.map((s, i) => ({ stop_id: s.stop_id, name: s.name, order: i + 1, location: { lat: s.lat, lng: s.lng } })),
    path: r.path.map(([lng, lat]) => ({ lat, lng })),
  }));
}

export function mockBuses(routeIds: string[], nowMs: number): { route_id: string; buses: RestBus[] }[] {
  return routeIds.map((route_id) => ({
    route_id,
    buses: MOCK_BUSES.filter((b) => b.route === route_id).map((b) => ({
      bus_id: b.id,
      route_id,
      direction: "outbound" as const,
      location: positionAt(route_id, progressAt(b, nowMs)),
      occupancy: occupancyFor(peopleAt(b, nowMs)),
      off_route: false,
      updated_at: nowMs / 1000,
    })),
  }));
}

// ------------------------------------------------------------------ plano de la cabina

function seeded(text: string): () => number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const SPOTS = buildLayout();

/** Cada bus tiene su propio orden de ocupación: al subir una persona se llena una silla más, no cambian las demás. */
export function mockCabin(busId: string, nowMs: number): CabinSnapshot | null {
  const bus = MOCK_BUSES.find((b) => b.id === busId);
  if (!bus) return null;
  const people = peopleAt(bus, nowMs);
  const seatOrder = shuffled(SPOTS.filter((s) => s.kind === "seat").map((s) => s.id), seeded(`${busId}-seats`));
  const standOrder = shuffled(SPOTS.filter((s) => s.kind === "stand").map((s) => s.id), seeded(`${busId}-stand`));
  const seated = Math.min(SEATS, people);
  const standing = Math.max(0, people - SEATS);
  const inPosition = Math.min(STANDING, standing);
  return {
    bus_id: busId,
    route_id: bus.route,
    updated_at: nowMs / 1000,
    fresh: true,
    occupied: [...seatOrder.slice(0, seated), ...standOrder.slice(0, inPosition)],
    counts: {
      seated,
      standing,
      standing_out_of_position: standing - inPosition,
      people_on_board: people,
      free_seats: SEATS - seated,
      free_standing: Math.max(0, STANDING - standing),
    },
    confidence: 0.92,
    approximate: false,
  };
}
