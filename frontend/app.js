// Cliente web minimo del sistema de capacidad de buses.
// Usa solo la API publica del backend: /api/v1/auth/*, /api/v1/routes y el WebSocket /ws/v1/buses/stream.
"use strict";

const cfg = window.APP_CONFIG || {};
const API = (cfg.apiBaseUrl || window.location.origin).replace(/\/+$/, "");
const WS_URL = API.replace(/^http/, "ws") + "/ws/v1/buses/stream";
const MAX_ROUTES = 5;

const byId = (id) => document.getElementById(id);
const statusEl = byId("status");
const session = { access: null, refresh: null, expiresAt: 0 };
const feeds = new Map();       // route_id -> { seq, buses: Map(bus_id -> bus) }
const markers = new Map();     // bus_id -> marcador de Leaflet
const selected = new Set((cfg.defaultRoutes || []).slice(0, MAX_ROUTES));
let socket = null, reconnectDelay = 1000, refreshTimer = null, map = null;

const STATE_LABEL = {
  available_seats: "Asientos disponibles", standing_only: "Solo de pie",
  full: "Lleno", overcrowded: "Sobrecupo", no_data: "Sin datos",
};

function store(key, value) {
  try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch (_) {}
}
function load(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", "Accept-Language": "es", ...(options.headers || {}) };
  if (session.access) headers.Authorization = "Bearer " + session.access;
  const res = await fetch(API + "/api/v1" + path, { ...options, headers });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || "Error " + res.status);
  return body;
}

function setTokens(pair) {
  session.access = pair.access_token;
  session.refresh = pair.refresh_token;
  session.expiresAt = pair.expires_at;
  store("refresh_token", pair.refresh_token);
  clearTimeout(refreshTimer);
  // El token de acceso dura 15 min: se renueva un minuto antes y se le pasa al WebSocket.
  const wait = Math.max(5, session.expiresAt - Date.now() / 1000 - 60) * 1000;
  refreshTimer = setTimeout(refreshTokens, wait);
}

async function refreshTokens() {
  const refresh = session.refresh || load("refresh_token");
  if (!refresh) return false;
  try {
    session.access = null;
    setTokens(await api("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refresh }) }));
    if (socket && socket.readyState === WebSocket.OPEN) send({ action: "auth", token: session.access });
    return true;
  } catch (_) {
    logout();
    return false;
  }
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function connect() {
  statusEl.textContent = "Conectando...";
  socket = new WebSocket(WS_URL);
  socket.onopen = () => {
    reconnectDelay = 1000;
    // Los navegadores no pueden enviar cabeceras en un WebSocket: el token va en el primer mensaje.
    send({ action: "auth", token: session.access });
    if (selected.size) send({ action: "subscribe", routes: [...selected] });
    statusEl.textContent = "En vivo";
  };
  socket.onmessage = (event) => handle(JSON.parse(event.data));
  socket.onclose = async (event) => {
    socket = null;
    if (!session.access) return;
    statusEl.textContent = "Reconectando...";
    if (event.code === 4401 && !(await refreshTokens())) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };
}

function handle(msg) {
  if (msg.type === "snapshot") {
    feeds.set(msg.route, { seq: msg.seq, buses: new Map(msg.buses.map((b) => [b.bus, b])) });
  } else if (msg.type === "delta") {
    const feed = feeds.get(msg.route);
    if (!feed || msg.seq !== feed.seq + 1) {
      send({ action: "resync", routes: [msg.route] });
      return;
    }
    feed.seq = msg.seq;
    msg.upsert.forEach((b) => feed.buses.set(b.bus, b));
    msg.remove.forEach((id) => feed.buses.delete(id));
  } else if (msg.type === "error") {
    statusEl.textContent = "Aviso: " + msg.code;
    return;
  } else {
    return;
  }
  render();
}

function render() {
  const list = byId("buses");
  list.replaceChildren();
  const seen = new Set();
  for (const [route, feed] of feeds) {
    if (!selected.has(route)) continue;
    for (const bus of feed.buses.values()) {
      seen.add(bus.bus);
      const label = STATE_LABEL[bus.state] || bus.state;
      const li = document.createElement("li");
      const title = document.createElement("div");
      title.textContent = "Ruta " + route + " - Bus " + bus.bus;
      const state = document.createElement("div");
      state.className = "state " + bus.state;
      state.textContent = label + " (" + bus.pct + "%)";
      const detail = document.createElement("div");
      detail.textContent = bus.free_seats + " asientos libres - " + bus.free_standing + " de pie libres";
      li.append(title, state, detail);
      list.append(li);

      const text = "Bus " + bus.bus + " (" + route + "): " + label + ", " + bus.pct + "%";
      const marker = markers.get(bus.bus);
      if (marker) marker.setLatLng([bus.lat, bus.lng]).setTooltipContent(text);
      else markers.set(bus.bus, L.marker([bus.lat, bus.lng], { title: text }).bindTooltip(text).addTo(map));
    }
  }
  for (const [id, marker] of markers) {
    if (!seen.has(id)) { marker.remove(); markers.delete(id); }
  }
  if (!list.children.length) {
    const li = document.createElement("li");
    li.textContent = "No hay buses reportando en las rutas elegidas.";
    list.append(li);
  }
}

async function showRoutes() {
  const data = await api("/routes");
  const box = byId("routes");
  box.replaceChildren();
  for (const route of data.routes || []) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(route.route_id);
    input.addEventListener("change", () => {
      if (input.checked && selected.size >= MAX_ROUTES) { input.checked = false; return; }
      if (input.checked) {
        selected.add(route.route_id);
        send({ action: "subscribe", routes: [route.route_id] });
      } else {
        selected.delete(route.route_id);
        feeds.delete(route.route_id);
        send({ action: "unsubscribe", routes: [route.route_id] });
        render();
      }
    });
    label.append(input, document.createTextNode(route.route_id + " - " + route.name));
    box.append(label);
  }
}

async function start() {
  byId("login").hidden = true;
  byId("app").hidden = false;
  if (!map) {
    map = L.map("map").setView(cfg.mapCenter || [1.2136, -77.2811], cfg.mapZoom || 14);
    L.tileLayer(cfg.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: cfg.tileAttribution || "&copy; OpenStreetMap",
    }).addTo(map);
  }
  await showRoutes();
  connect();
}

function logout() {
  const refresh = session.refresh;
  session.access = null;
  session.refresh = null;
  store("refresh_token", null);
  clearTimeout(refreshTimer);
  if (refresh) {
    fetch(API + "/api/v1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => {});
  }
  if (socket) socket.close(1000);
  feeds.clear();
  markers.forEach((m) => m.remove());
  markers.clear();
  byId("app").hidden = true;
  byId("login").hidden = false;
  statusEl.textContent = "Desconectado";
}

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  byId("login-error").textContent = "";
  try {
    setTokens(await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    }));
    await start();
  } catch (err) {
    byId("login-error").textContent = err.message;
  }
});
byId("logout").addEventListener("click", logout);

// Si queda una sesion abierta en esta pestana, se reanuda sin pedir la contrasena.
(async () => {
  if (load("refresh_token") && (await refreshTokens())) await start();
})();
