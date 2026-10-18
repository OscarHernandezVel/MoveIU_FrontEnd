import { mockBuses, mockCabin, mockRoutes } from "../mock/fleet.ts";
import { demoNow, isDemo } from "./demo.ts";
import type { CabinSnapshot, RestBus, RouteInfo, TokenPair } from "./types.ts";

const BASE = "/api/v1";
let pair: TokenPair | null = null;
let pending: Promise<TokenPair> | null = null;

/** `crypto.randomUUID` no existe en iOS anterior a 15.4 ni en páginas sin HTTPS: se arma el UUID a mano. */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deviceId(): string {
  try {
    const saved = localStorage.getItem("device_id");
    if (saved) return saved;
    const fresh = uuid();
    localStorage.setItem("device_id", fresh);
    return fresh;
  } catch {
    return uuid();
  }
}

async function raw<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(response.status, body?.code ?? "error", body?.message ?? response.statusText);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function post<T>(path: string, body: unknown): Promise<T> {
  return raw<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** A guest session (role `guest`, no personal data): enough to see the map. Refreshes before expiry. */
export async function session(): Promise<TokenPair> {
  if (pair && pair.expires_at - Date.now() / 1000 > 30) return pair;
  pending ??= (async () => {
    try {
      if (pair) {
        try {
          return (pair = await post<TokenPair>("/auth/refresh", { refresh_token: pair.refresh_token }));
        } catch {
          pair = null; // refresh tokens are single use: start over as a guest
        }
      }
      return (pair = await post<TokenPair>("/auth/guest", {
        device_id: deviceId(),
        platform: "android",
        push_token: "web-no-push",
      }));
    } finally {
      pending = null;
    }
  })();
  return pending;
}

async function authed<T>(path: string): Promise<T> {
  const { access_token } = await session();
  return raw<T>(path, { headers: { authorization: `Bearer ${access_token}` } });
}

export const api = {
  routes: (): Promise<RouteInfo[]> =>
    isDemo() ? Promise.resolve(mockRoutes()) : authed<{ routes: RouteInfo[] }>("/routes").then((r) => r.routes),
  route: (id: string): Promise<RouteInfo> => {
    if (!isDemo()) return authed<RouteInfo>(`/routes/${encodeURIComponent(id)}`);
    const found = mockRoutes().find((r) => r.route_id === id);
    return found ? Promise.resolve(found) : Promise.reject(new ApiError(404, "not_found", "Ruta no encontrada"));
  },
  activeBuses: (routeIds: string[]): Promise<{ route_id: string; buses: RestBus[] }[]> =>
    isDemo()
      ? Promise.resolve(mockBuses(routeIds, demoNow()))
      : authed<{ routes: { route_id: string; buses: RestBus[] }[] }>(
          "/buses/active?" + routeIds.map((r) => `route_id=${encodeURIComponent(r)}`).join("&"),
        ).then((r) => r.routes),
  cabin: (busId: string): Promise<CabinSnapshot> => {
    if (!isDemo()) return authed<CabinSnapshot>(`/buses/${encodeURIComponent(busId)}/cabin`);
    const cabin = mockCabin(busId, demoNow());
    return cabin ? Promise.resolve(cabin) : Promise.reject(new ApiError(404, "not_found", "Bus no encontrado"));
  },
};
