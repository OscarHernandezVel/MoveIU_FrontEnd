import { backoff } from "./feed.ts";
import type { ServerMessage } from "./types.ts";

export interface SocketHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: "connecting" | "open" | "closed"): void;
  token(): Promise<string>;
}

/**
 * WebSocket client of the core service with automatic reconnection (docs/realtime.md). Browsers cannot set
 * headers, so the token goes in the first message ({"action":"auth"}), never in the URL. Close codes: 4401
 * (token expired: reconnect with a fresh one), 1013 (server full: wait), anything else: backoff.
 * On Vercel the socket is pinned to one instance and closes at maxDuration, so reconnecting is normal.
 */
export class FleetSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private routes: string[] = [];

  constructor(
    private readonly url: string,
    private readonly handlers: SocketHandlers,
  ) {}

  start(routes: string[]): void {
    this.stopped = false;
    this.routes = routes;
    void this.connect();
  }

  subscribe(routes: string[]): void {
    this.routes = routes;
    this.send({ action: "subscribe", routes });
  }

  resync(route: string): void {
    this.send({ action: "resync", routes: [route] });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close(1000);
    this.socket = null;
    this.handlers.onStatus("closed");
  }

  private send(payload: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.handlers.onStatus("connecting");
    let token: string;
    try {
      token = await this.handlers.token();
    } catch {
      return this.retry();
    }
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ action: "auth", token }));
      socket.send(JSON.stringify({ action: "subscribe", routes: this.routes }));
      this.attempt = 0;
      this.handlers.onStatus("open");
    };
    socket.onmessage = (event) => {
      try {
        this.handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* a malformed frame is dropped; the next snapshot repairs the state */
      }
    };
    socket.onclose = () => {
      this.handlers.onStatus("closed");
      this.retry();
    };
    socket.onerror = () => socket.close();
  }

  private retry(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.connect(), backoff(this.attempt++));
  }
}
