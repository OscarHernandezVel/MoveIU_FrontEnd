import type { Bus, RestBus, WsBus } from "./types.ts";

export function fromRest(b: RestBus): Bus {
  return {
    id: b.bus_id,
    routeId: b.route_id,
    direction: b.direction,
    lat: b.location.lat,
    lng: b.location.lng,
    percentage: b.occupancy.percentage,
    state: b.occupancy.state,
    seated: b.occupancy.seated,
    standing: b.occupancy.standing,
    freeSeats: b.occupancy.free_seats,
    freeStanding: b.occupancy.free_standing,
    wheelchairFree: b.occupancy.wheelchair_free,
    confidence: b.occupancy.confidence,
    approximate: b.occupancy.approximate,
    offRoute: b.off_route,
    updatedAt: b.updated_at,
  };
}

export function fromWs(routeId: string, b: WsBus): Bus {
  return {
    id: b.bus,
    routeId,
    direction: b.dir,
    lat: b.lat,
    lng: b.lng,
    percentage: b.pct,
    state: b.state,
    seated: b.seated,
    standing: b.standing,
    freeSeats: b.free_seats,
    freeStanding: b.free_standing,
    wheelchairFree: b.wheelchair,
    confidence: b.conf,
    approximate: b.approx,
    offRoute: b.off_route,
    updatedAt: b.ts,
  };
}
