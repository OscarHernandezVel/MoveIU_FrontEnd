"use client";

import { create } from "zustand";
import { api } from "./api.ts";
import { fromRest } from "./convert.ts";
import { applyMessage, type RouteState } from "./feed.ts";
import { DEMO_SETTING, isDemo, setDemo, wantsDemoAtStart } from "./demo.ts";
import { FleetSocket } from "./ws.ts";
import { session } from "./api.ts";
import type { Bus, RouteInfo } from "./types.ts";

export type Link = "ws" | "polling" | "offline";

interface FleetState {
  routes: RouteInfo[];
  selected: string[];
  buses: Bus[];
  link: Link;
  error: string | null;
  lastUpdate: number | null;
  /** Datos simulados (modo demostración) en lugar de los del back-end. */
  demo: boolean;
  init(): Promise<void>;
  setDemoMode(on: boolean): Promise<void>;
  select(routeIds: string[]): void;
  stop(): void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "";
const POLL_MS = Math.max(3, Number(process.env.NEXT_PUBLIC_POLL_SECONDS ?? 3)) * 1000;
const DEMO_POLL_MS = 1000; // sin red de por medio: una vez por segundo se ve el movimiento
const MAX_ROUTES = 5;

let socket: FleetSocket | null = null;
let poller: ReturnType<typeof setInterval> | null = null;
const feed = new Map<string, RouteState>();

export const useFleet = create<FleetState>((set, get) => {
  const flatten = (): Bus[] => [...feed.values()].flatMap((r) => [...r.buses.values()]);

  async function poll(): Promise<void> {
    const ids = get().selected;
    if (!ids.length) return set({ buses: [] });
    try {
      const rows = await api.activeBuses(ids);
      set({ buses: rows.flatMap((r) => r.buses.map(fromRest)), link: "polling", error: null, lastUpdate: Date.now() });
    } catch (e) {
      set({ link: "offline", error: e instanceof Error ? e.message : "error" });
    }
  }

  function startPolling(): void {
    if (poller) return;
    void poll();
    poller = setInterval(() => void poll(), isDemo() ? DEMO_POLL_MS : POLL_MS);
  }

  function stopPolling(): void {
    if (poller) clearInterval(poller);
    poller = null;
  }

  function openSocket(): void {
    if (!WS_URL || socket) return;
    socket = new FleetSocket(WS_URL, {
      token: async () => (await session()).access_token,
      onStatus: (status) => {
        if (status === "open") {
          stopPolling();
          set({ link: "ws", error: null });
        } else if (get().link !== "polling") {
          startPolling(); // while the socket is down, the REST list keeps the map alive
        }
      },
      onMessage: (message) => {
        const effect = applyMessage(feed, message);
        if (effect?.kind === "resync") socket?.resync(effect.route);
        if (effect?.kind === "error") set({ error: effect.code });
        if (message.type === "snapshot" || message.type === "delta") {
          set({ buses: flatten(), lastUpdate: Date.now() });
        }
      },
    });
    socket.start(get().selected);
  }

  /** `forced` = null: decide por la dirección y la configuración, con respaldo automático si no hay back-end. */
  async function boot(forced: boolean | null): Promise<void> {
    const wantDemo = forced ?? (typeof window !== "undefined" && wantsDemoAtStart(window.location.search));
    setDemo(wantDemo);
    const load = async (): Promise<void> => {
      const routes = await api.routes();
      const first = routes.slice(0, 1).map((r) => r.route_id);
      set({ routes, selected: first, demo: isDemo(), error: null });
      if (isDemo()) {
        startPolling();
        return;
      }
      if (WS_URL) openSocket();
      else startPolling();
      if (WS_URL) startPolling(); // hasta que el socket abra
    };
    try {
      await load();
    } catch (e) {
      if (forced !== null || DEMO_SETTING === "off") {
        set({ link: "offline", error: e instanceof Error ? e.message : "error", demo: isDemo() });
        return;
      }
      // Sin back-end: la aplicación sigue siendo útil con la flota simulada y lo dice en pantalla.
      setDemo(true);
      try {
        await load();
      } catch (inner) {
        set({ link: "offline", error: inner instanceof Error ? inner.message : "error" });
      }
    }
  }

  return {
    routes: [],
    selected: [],
    buses: [],
    link: "offline",
    error: null,
    lastUpdate: null,
    demo: false,
    async init() {
      await boot(null);
    },
    async setDemoMode(on) {
      get().stop();
      feed.clear();
      set({ buses: [], routes: [], selected: [], error: null });
      await boot(on);
    },
    select(routeIds) {
      const selected = routeIds.slice(0, MAX_ROUTES);
      feed.clear();
      set({ selected, buses: [] });
      socket?.subscribe(selected);
      if (poller) void poll();
    },
    stop() {
      socket?.stop();
      socket = null;
      stopPolling();
    },
  };
});
