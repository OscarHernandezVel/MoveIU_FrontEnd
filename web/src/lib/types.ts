/** Shapes of the core-service API (docs/api.md, docs/realtime.md). Kept by hand: the contract is small. */

export type OccupancyState = "available_seats" | "standing_only" | "full" | "overcrowded" | "no_data";

export interface Occupancy {
  percentage: number;
  state: OccupancyState;
  label: string;
  icon: string;
  seated: number;
  standing: number;
  free_seats: number;
  free_standing: number;
  wheelchair_free: boolean;
  people_on_board: number;
  approximate: boolean;
  confidence: number;
}

/** A bus as returned by REST `GET /buses/active`. */
export interface RestBus {
  bus_id: string;
  route_id: string;
  direction: "outbound" | "return";
  location: { lat: number; lng: number };
  occupancy: Occupancy;
  off_route: boolean;
  updated_at: number;
}

/** A bus as pushed by the WebSocket (compact form). */
export interface WsBus {
  bus: string;
  dir: "outbound" | "return";
  lat: number;
  lng: number;
  pct: number;
  state: OccupancyState;
  seated: number;
  standing: number;
  free_seats: number;
  free_standing: number;
  wheelchair: boolean;
  conf: number;
  approx: boolean;
  off_route: boolean;
  ts: number;
}

/** What the UI works with, whatever the transport. */
export interface Bus {
  id: string;
  routeId: string;
  direction: "outbound" | "return";
  lat: number;
  lng: number;
  percentage: number;
  state: OccupancyState;
  seated: number;
  standing: number;
  freeSeats: number;
  freeStanding: number;
  wheelchairFree: boolean;
  confidence: number;
  approximate: boolean;
  offRoute: boolean;
  updatedAt: number;
}

export interface RouteInfo {
  route_id: string;
  name: string;
  stops: { stop_id: string; name: string; order: number; location: { lat: number; lng: number } }[];
  path?: { lat: number; lng: number }[];
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_at: number;
  role: string;
}

export interface CabinSnapshot {
  bus_id: string;
  route_id: string;
  updated_at: number;
  fresh: boolean;
  occupied: string[];
  counts: {
    seated: number;
    standing: number;
    standing_out_of_position: number;
    people_on_board: number;
    free_seats: number;
    free_standing: number;
  };
  confidence: number;
  approximate: boolean;
}

export type ServerMessage =
  | { v: 1; type: "subscribed"; channel: string; routes: string[] }
  | { v: 1; type: "snapshot"; channel: string; route: string; seq: number; ts: number; buses: WsBus[] }
  | { v: 1; type: "delta"; channel: string; route: string; seq: number; ts: number; upsert: WsBus[]; remove: string[] }
  | { v: 1; type: "error"; code: string; detail?: string }
  | { v: 1; type: "heartbeat" }
  | { v: 1; type: "pong" };
