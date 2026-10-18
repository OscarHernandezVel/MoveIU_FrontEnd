import { fromWs } from "./convert.ts";
import type { Bus, ServerMessage } from "./types.ts";

/**
 * Applies WebSocket messages to the per-route state (docs/realtime.md, section 2): a snapshot replaces the
 * route, a delta with seq = previous + 1 upserts/removes, and a jump in seq asks for a resync.
 * Pure and synchronous, so it can be tested without a socket.
 */
export interface RouteState {
  seq: number;
  buses: Map<string, Bus>;
}

export type Effect = { kind: "resync"; route: string } | { kind: "error"; code: string } | null;

export function applyMessage(routes: Map<string, RouteState>, message: ServerMessage): Effect {
  switch (message.type) {
    case "snapshot": {
      const buses = new Map<string, Bus>();
      for (const bus of message.buses) buses.set(bus.bus, fromWs(message.route, bus));
      routes.set(message.route, { seq: message.seq, buses });
      return null;
    }
    case "delta": {
      const state = routes.get(message.route);
      if (!state || message.seq !== state.seq + 1) {
        if (message.seq <= (state?.seq ?? -1)) return null; // old or duplicate: ignore
        routes.delete(message.route);
        return { kind: "resync", route: message.route };
      }
      for (const bus of message.upsert) state.buses.set(bus.bus, fromWs(message.route, bus));
      for (const id of message.remove) state.buses.delete(id);
      state.seq = message.seq;
      return null;
    }
    case "error":
      return { kind: "error", code: message.code };
    default:
      return null;
  }
}

/** Reconnect delay: 1 s, 2 s, 4 s ... up to 30 s, with up to 25% jitter. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + 0.25 * random()));
}
