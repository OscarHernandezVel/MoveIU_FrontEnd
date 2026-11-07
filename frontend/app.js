// Cliente web de MoveIU: ocupación de buses en vivo.
// Usa solo la API pública del backend: /api/v1/auth/*, /routes, /buses/{id}/cabin, /stops/*/next-buses,
// /findings, /ai/analysis y el WebSocket /ws/v1/buses/stream.
"use strict";

const cfg = window.APP_CONFIG || {};
const API = (cfg.apiBaseUrl || window.location.origin).replace(/\/+$/, "");
const WS_URL = API.replace(/^http/, "ws") + "/ws/v1/buses/stream";
const MAX_ROUTES = 5;
const GLIDE_MS = 2800;
// Colores de ruta que se distinguen sobre el mapa claro y no se confunden con los de ocupación.
const ROUTE_COLORS = ["#0072B5", "#E05018", "#7B2CBF", "#00897B", "#C2185B", "#5D4037", "#1565C0", "#AD1457", "#6A8E00", "#EF6C00"];
// Icono de cada estado: la ocupación nunca depende solo del color (UX-07).
const STATE_ICON = {
  available_seats: "M5 12h14M12 5v14", standing_only: "M12 4v16M8 8l4-4 4 4",
  full: "M6 6l12 12M18 6 6 18", overcrowded: "M12 3v10M12 18v.5", no_data: "M8 12h8",
};
const STATE_LABEL = {
  available_seats: "Sillas disponibles", standing_only: "Solo de pie",
  full: "Lleno", overcrowded: "Sobrecupo", no_data: "Sin datos",
};
const DIR_LABEL = { outbound: "ida", return: "regreso" };
const CABIN_VIEWS = [["plan", "Plano"], ["front", "3D frontal"], ["rear", "3D trasera"], ["3d", "3D libre"]];
const SEVERITY = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const byId = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const session = { access: null, refresh: null, expiresAt: 0, role: null };
const routes = new Map();      // route_id -> { name, color, stops, path?, layers? }
const feeds = new Map();       // route_id -> { seq, buses: Map(bus_id -> bus) }
const markers = new Map();     // bus_id -> marcador de Leaflet
const cards = new Map();       // bus_id -> <li> de la lista
const selected = new Set((kept("routes") || cfg.defaultRoutes || []).slice(0, MAX_ROUTES));
let socket = null, reconnectDelay = 1000, refreshTimer = null, map = null;
let panelState = null;         // { kind: "bus", id, timer } | { kind: "stop", ... }
let toastTimer = null;
let emuOnMap = true;           // la emulación también pinta sus buses en el mapa

// ---------------------------------------------------------------- utilidades

function store(key, value) {
  try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch (_) {}
}
function load(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
// Preferencias de este navegador (rutas elegidas, paradas favoritas, recorrido visto): localStorage, en JSON.
function keep(key, value) { try { localStorage.setItem("moveiu_" + key, JSON.stringify(value)); } catch (_) {} }
function kept(key) { try { return JSON.parse(localStorage.getItem("moveiu_" + key)); } catch (_) { return null; } }
const norm = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const routeKind = (id) => (id.startsWith("E") ? "Estratégica" : "Complementaria");
const icon = (state) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (STATE_ICON[state] || STATE_ICON.no_data) + '"/></svg>';

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", "Accept-Language": "es", ...(options.headers || {}) };
  if (session.access) headers.Authorization = "Bearer " + session.access;
  let res;
  try { res = await fetch(API + "/api/v1" + path, { ...options, headers }); }
  catch (_) { throw Object.assign(new Error("No hay conexión con el servidor."), { code: "network" }); }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body.error || {};
    throw Object.assign(new Error(err.message || "Error " + res.status), { code: err.code, status: res.status });
  }
  return body;
}

function toast(text, action) {
  const box = byId("toast");
  box.textContent = text;
  if (action) {  // p. ej. «Deshacer» al quitar una parada favorita
    const b = el("button", "undo", action.label);
    b.type = "button";
    b.addEventListener("click", () => { box.hidden = true; action.run(); });
    box.append(b);
  }
  box.hidden = false;
  box.style.animation = "none"; void box.offsetWidth; box.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
}

function etaText(minutes) {
  if (!minutes) return "";
  return minutes <= 1 ? "Llega en 1 min o menos" : "Llega en ~" + minutes + " min";
}

function when(value) {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return isNaN(date) ? "" : date.toLocaleString("es-CO", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

// ---------------------------------------------------------------- HU-01 / HU-02 acceso y sesión

function setTokens(pair) {
  session.access = pair.access_token;
  session.refresh = pair.refresh_token;
  session.expiresAt = pair.expires_at;
  if (pair.role) { session.role = pair.role; store("role", pair.role); }
  store("refresh_token", pair.refresh_token);
  clearTimeout(refreshTimer);
  // El token de acceso dura 15 min: se renueva un minuto antes y se le pasa al WebSocket.
  const wait = Math.max(5, session.expiresAt - Date.now() / 1000 - 60) * 1000;
  refreshTimer = setTimeout(refreshTokens, wait);
}

async function refreshTokens() {
  const refresh = session.refresh || load("refresh_token");
  if (!refresh) return false;
  const wasIn = !!session.access;
  try {
    session.access = null;
    setTokens(await api("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refresh }) }));
    if (!session.role) session.role = load("role");
    if (socket && socket.readyState === WebSocket.OPEN) send({ action: "auth", token: session.access });
    return true;
  } catch (_) {
    logout(wasIn ? "Tu sesión terminó, vuelve a entrar." : null);
    return false;
  }
}

function showTab(which) {
  const login = which === "login";
  byId("tab-login").setAttribute("aria-selected", String(login));
  byId("tab-register").setAttribute("aria-selected", String(!login));
  byId("login-form").hidden = !login;
  byId("register-form").hidden = login;
  (login ? byId("login-form") : byId("register-form")).querySelector("input").focus();
}

function fail(form, err) {
  const card = byId("auth-card");
  card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
  const box = form.querySelector("[data-error]");
  box.textContent = err.message;
  const field = err.code === "email_taken" || err.code === "invalid_credentials" ? "email"
    : /password/.test(err.code || "") ? "password" : null;
  form.querySelectorAll("input").forEach((input) => input.setAttribute("aria-invalid", String(input.name === field)));
  if (err.code === "email_taken") {
    const link = el("a", "", "Entrar con este correo");
    link.href = "#";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      byId("login-form").email.value = form.email.value;
      showTab("login");
      byId("login-form").password.focus();
    });
    box.append(" ", link);
  }
}

async function submitAuth(form, path, body) {
  const button = form.querySelector("button[type=submit]");
  form.querySelector("[data-error]").textContent = "";
  byId("auth-notice").hidden = true;
  button.disabled = true;
  try {
    setTokens(await api(path, { method: "POST", body: JSON.stringify(body) }));
    store("who", body.name || body.email);
    form.reset();
    await start();
  } catch (err) {
    fail(form, err);
  } finally {
    button.disabled = false;
  }
}

byId("tab-login").addEventListener("click", () => showTab("login"));
byId("tab-register").addEventListener("click", () => showTab("register"));
byId("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const f = event.target;
  submitAuth(f, "/auth/login", { email: f.email.value.trim(), password: f.password.value });
});
byId("register-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const f = event.target;
  submitAuth(f, "/auth/register", { name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value });
});

// ---------------------------------------------------------------- HU-07 estado de la conexión

let wasDown = false, bandTimer = null;
function connBand(state) {
  const band = byId("conn-band");
  clearTimeout(bandTimer);
  if (state === "down") {
    wasDown = true;
    band.className = "conn-band";
    band.innerHTML = '<span class="spin" aria-hidden="true"></span>Sin conexión · reintentando';
    band.hidden = false;
  } else if (state === "live" && wasDown) {
    wasDown = false;
    band.className = "conn-band ok";
    band.textContent = "De nuevo en vivo";
    band.hidden = false;
    bandTimer = setTimeout(() => { band.hidden = true; }, 2500);
  } else if (state === "off") {
    wasDown = false;
    band.hidden = true;
  }
}

function setStatus(state, text) {
  connBand(state === "reconnecting" ? "down" : state);
  const pill = byId("status");
  pill.dataset.state = state;
  pill.querySelector(".status-text").textContent = text;
  document.querySelector(".map-wrap").classList.toggle("stale", state === "reconnecting");
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function connect() {
  setStatus(reconnectDelay > 1000 ? "reconnecting" : "connecting", reconnectDelay > 1000 ? "Reconectando…" : "Conectando…");
  socket = new WebSocket(WS_URL);
  socket.onopen = () => {
    reconnectDelay = 1000;
    // Los navegadores no pueden enviar cabeceras en un WebSocket: el token va en el primer mensaje.
    send({ action: "auth", token: session.access });
    if (selected.size) send({ action: "subscribe", routes: [...selected] });
    setStatus("live", "En vivo");
  };
  socket.onmessage = (event) => handle(JSON.parse(event.data));
  socket.onclose = async (event) => {
    socket = null;
    if (!session.access) return;
    setStatus("reconnecting", "Reconectando…");
    if (event.code === 4401 && !(await refreshTokens())) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };
}

function handle(msg) {
  if (msg.type === "snapshot") {
    feeds.set(msg.route, { seq: msg.seq, buses: new Map(msg.buses.map((b) => [b.bus, { ...b, route: msg.route }])) });
  } else if (msg.type === "delta") {
    const feed = feeds.get(msg.route);
    if (!feed || msg.seq !== feed.seq + 1) {
      send({ action: "resync", routes: [msg.route] });
      return;
    }
    feed.seq = msg.seq;
    msg.upsert.forEach((b) => feed.buses.set(b.bus, { ...b, route: msg.route }));
    msg.remove.forEach((id) => feed.buses.delete(id));
  } else if (msg.type === "error") {
    toast(msg.message || "Aviso del servidor: " + msg.code);
    return;
  } else {
    return;
  }
  render();
}

// ---------------------------------------------------------------- HU-03 rutas y recorrido

let stopIndex = [];            // paradas únicas de todas las rutas: { stop, key, routes: [route_id] }
let cityStops = null;          // todas las paradas, tenues, cuando no hay rutas elegidas (UX-02)

async function showRoutes() {
  const data = await api("/routes");
  // C1, C2 … C16 y luego E1 … E7: orden natural, no de texto (C10 iba antes que C2)
  const sorted = (data.routes || []).slice().sort((a, b) => a.route_id.localeCompare(b.route_id, "es", { numeric: true }));
  const byStop = new Map();
  sorted.forEach((route, index) => {
    const info = routes.get(route.route_id) || {};
    routes.set(route.route_id, { ...info, name: route.name, stops: route.stops, color: ROUTE_COLORS[index % ROUTE_COLORS.length],
      words: norm(route.route_id + " " + route.name + " " + (route.stops || []).map((s) => s.name).join(" ")) });
    (route.stops || []).forEach((stop) => {
      const entry = byStop.get(stop.stop_id) || { stop, key: norm(stop.name), routes: [] };
      if (!entry.routes.includes(route.route_id)) entry.routes.push(route.route_id);
      byStop.set(stop.stop_id, entry);
    });
  });
  stopIndex = [...byStop.values()];
  [...selected].forEach((id) => routes.has(id) ? drawRoute(id) : selected.delete(id));
  renderRouteResults();
  renderActiveRoutes();
  renderCityStops();
  renderFavs();
}

function badge(id) {
  const b = el("span", "route-badge", id);
  b.style.setProperty("--c", (routes.get(id) || {}).color || "var(--brand)");
  return b;
}

// UX-03: por número («12»), por nombre o por un barrio por el que pasa («tamasagra», sin tildes).
function renderRouteResults() {
  const q = norm(byId("route-search").value);
  const box = byId("route-results");
  box.hidden = !q;
  if (!q) { box.replaceChildren(); return; }
  const found = [...routes.entries()].filter(([id, r]) => r.words.includes(q));
  if (!found.length) {
    box.replaceChildren(el("li", "route-empty", "Ninguna ruta pasa por «" + byId("route-search").value.trim() + "». Prueba con el nombre de una parada o un barrio."));
    return;
  }
  box.replaceChildren(...found.map(([id, r]) => {
    const li = el("li");
    const row = el("button", "route-row");
    row.type = "button";
    const on = selected.has(id);
    row.setAttribute("aria-pressed", String(on));
    const byName = norm(id).includes(q) || norm(r.name).includes(q);
    const stop = byName ? null : (r.stops || []).find((s) => norm(s.name).includes(q));
    const info = el("span", "info");
    info.append(el("strong", "", r.name), el("span", "", routeKind(id) + (stop ? " · pasa por " + stop.name : "")));
    row.append(badge(id), info, el("span", "act", on ? "Quitar" : (selected.size >= MAX_ROUTES ? "Máx. 5" : "Agregar")));
    row.addEventListener("click", () => toggleRoute(id, true));
    li.append(row);
    return li;
  }));
}

function renderActiveRoutes() {
  byId("route-count").textContent = selected.size + " de " + MAX_ROUTES;
  const list = byId("active-routes");
  if (!selected.size) {
    list.replaceChildren(el("li", "active-empty", "Aún no eliges rutas. Búscala arriba o usa «Cerca de mí»."));
    return;
  }
  list.replaceChildren(...[...selected].map((id) => {
    const r = routes.get(id) || { name: "" };
    const li = el("li", "active-route");
    const head = el("div", "head");
    const remove = el("button", "remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Quitar la ruta " + id);
    remove.addEventListener("click", () => toggleRoute(id));
    head.append(badge(id), el("strong", "", r.name), remove);
    const sub = el("span", "sub");
    sub.dataset.route = id;
    li.append(head, sub);
    return li;
  }));
  countActive();
}

// Solo cambia el texto: así las tarjetas no repiten su animación de entrada con cada lectura.
function countActive() {
  const buses = liveBuses();
  document.querySelectorAll(".active-route .sub[data-route]").forEach((sub) => {
    const id = sub.dataset.route;
    const count = buses.filter((b) => b.route === id).length;
    sub.textContent = routeKind(id) + " · " + (feeds.has(id) || Emu.running() ? count + (count === 1 ? " bus en servicio" : " buses en servicio") : "cargando buses…");
  });
}

function toggleRoute(id, fly) {
  if (selected.has(id)) {
    selected.delete(id);
    feeds.delete(id);
    send({ action: "unsubscribe", routes: [id] });
    const layers = routes.get(id).layers;
    if (layers) layers.remove();
  } else {
    if (selected.size >= MAX_ROUTES) { toast("Máximo " + MAX_ROUTES + " rutas a la vez: quita una de «Mis rutas»."); return; }
    selected.add(id);
    send({ action: "subscribe", routes: [id] });
    drawRoute(id, fly);
  }
  keep("routes", [...selected]);
  renderRouteResults();
  renderActiveRoutes();
  renderCityStops();
  render();
}

async function ensurePath(id) {
  const route = routes.get(id);
  if (!route.path) {
    const data = await api("/routes/" + encodeURIComponent(id));
    route.path = data.path || [];
    route.returnPath = data.return_path || null;  // solo si el regreso va por otras calles
  }
  return route.path;
}

// UX-09: al activar una ruta, el mapa vuela a su recorrido, la línea se dibuja y las paradas aparecen escalonadas.
async function drawRoute(id, fly) {
  const route = routes.get(id);
  try { await ensurePath(id); } catch (err) { toast(err.message); return; }
  if (!selected.has(id)) return;
  if (route.layers) route.layers.remove();
  const group = L.layerGroup().addTo(map);
  route.layers = group;
  const latlngs = route.path.map((p) => [p.lat, p.lng]);
  if (route.returnPath && route.returnPath.length > 1) {
    // El regreso por otras calles: punteado y más tenue, debajo de la ida.
    L.polyline(route.returnPath.map((p) => [p.lat, p.lng]), {
      color: route.color, weight: 4, opacity: 0.55, dashArray: "2 9", lineCap: "round", interactive: false,
    }).addTo(group);
  }
  if (latlngs.length > 1) {
    const line = L.polyline(latlngs, { color: route.color, weight: 6, opacity: 0.95, className: "route-line", interactive: false }).addTo(group);
    const path = line.getElement();
    if (path && path.getTotalLength) {
      path.style.setProperty("--len", Math.ceil(path.getTotalLength()));
      // Al terminar de dibujarse se quita el trazo discontinuo: al hacer zoom cambia la longitud.
      path.addEventListener("animationend", () => { path.classList.remove("route-line"); path.style.strokeDasharray = "none"; }, { once: true });
    }
    if (fly && !byId("view-map").hidden) {
      map.flyToBounds(line.getBounds(), { padding: [48, 48], maxZoom: 15, duration: reducedMotion.matches ? 0 : 0.7 });
    }
  }
  (route.stops || []).forEach((stop, i) => {
    const dot = L.circleMarker([stop.location.lat, stop.location.lng], {
      radius: 6, weight: 3, color: route.color, fillColor: "#FFFFFF", fillOpacity: 1, className: "stop-dot",
    }).bindTooltip(stop.name).on("click", () => openStop(id, stop)).addTo(group);
    const node = dot.getElement();
    if (node) node.style.animationDelay = Math.min(i, 40) * 15 + "ms";
  });
}

// UX-02: sin rutas elegidas, las paradas de toda la ciudad se ven tenues para orientarse; tocar una la abre.
function renderCityStops() {
  if (selected.size) { if (cityStops) { cityStops.remove(); cityStops = null; } return; }
  if (cityStops || !map || !stopIndex.length) return;
  const canvas = L.canvas({ padding: 0.3 });
  cityStops = L.layerGroup(stopIndex.map((entry) => L.circleMarker([entry.stop.location.lat, entry.stop.location.lng], {
    renderer: canvas, radius: 4, weight: 1.5, color: "#A0947F", fillColor: "#FFFFFF", fillOpacity: 0.9,
  }).bindTooltip(entry.stop.name + " · " + entry.routes.join(", ")).on("click", () => openStop(entry.routes[0], entry.stop)))).addTo(map);
}

// ---------------------------------------------------------------- HU-04 buses en vivo

function liveBuses() {
  const list = [];
  for (const [route, feed] of feeds) if (selected.has(route)) list.push(...feed.buses.values());
  if (emuOnMap) list.push(...Emu.list().filter((b) => selected.has(b.route)));
  return list.sort((a, b) => a.pct - b.pct);
}

function pinHtml(bus) {
  return '<div class="bus-pin ' + bus.state + (panelState && panelState.id === bus.bus ? " selected" : "") +
    '"><span class="pill">' + icon(bus.state) + bus.bus + " · " + bus.pct + ' %</span><span class="stem"></span></div>';
}

function glide(marker, to) {
  const from = marker.getLatLng();
  cancelAnimationFrame(marker._glide);
  if (reducedMotion.matches || from.distanceTo(to) > 1500) { marker.setLatLng(to); return; }
  // Velocidad constante hasta la próxima lectura (llega cada 3 s): el bus no salta.
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / GLIDE_MS);
    marker.setLatLng([from.lat + (to[0] - from.lat) * k, from.lng + (to[1] - from.lng) * k]);
    if (k < 1) marker._glide = requestAnimationFrame(step);
  };
  marker._glide = requestAnimationFrame(step);
}

function render() {
  const buses = liveBuses();
  const seen = new Set();
  const list = byId("buses");
  byId("bus-count").textContent = String(buses.length);

  for (const bus of buses) {
    seen.add(bus.bus);
    const label = STATE_LABEL[bus.state] || bus.state;
    const text = "Bus " + bus.bus + " (" + bus.route + "): " + label + ", " + bus.pct + " %";
    const icon = L.divIcon({ className: "", html: pinHtml(bus), iconSize: [96, 44], iconAnchor: [48, 44] });
    const marker = markers.get(bus.bus);
    if (marker) {
      glide(marker, [bus.lat, bus.lng]);
      marker.setIcon(icon).setTooltipContent(text);
    } else {
      markers.set(bus.bus, L.marker([bus.lat, bus.lng], { icon, title: text, keyboard: true })
        .bindTooltip(text).on("click", () => openBus(bus.bus)).addTo(map));
    }
    let li = cards.get(bus.bus);
    if (!li) { li = busCard(bus.bus); cards.set(bus.bus, li); }
    fillCard(li, bus, label);
    list.append(li);  // append mueve el nodo: la lista queda ordenada sin rehacer las tarjetas
  }
  for (const [id, marker] of markers) if (!seen.has(id)) { marker.remove(); markers.delete(id); }
  for (const [id, li] of cards) if (!seen.has(id)) { li.remove(); cards.delete(id); }

  const empty = list.querySelector(".empty");
  if (buses.length) { if (empty) empty.remove(); }
  else if (!empty) list.append(emptyState());
  else empty.replaceWith(emptyState());

  if (panelState && panelState.kind === "bus") fillBusStats();
  if (!byId("view-ops").hidden) renderKpis();
  countActive();
}

function busCard(id) {
  const li = el("li");
  const button = el("button", "bus-card");
  button.type = "button";
  button.innerHTML = '<span class="bus-top"><strong></strong><span class="bus-route"></span></span>' +
    '<span class="state-line"></span><span class="bar"><span></span></span><span class="free"></span>';
  button.addEventListener("click", () => openBus(id));
  li.append(button);
  return li;
}

function fillCard(li, bus, label) {
  const b = li.firstChild;
  b.querySelector("strong").textContent = "Bus " + bus.bus;
  b.querySelector(".bus-route").textContent = bus.route + (bus.dir ? " · " + (DIR_LABEL[bus.dir] || bus.dir) : "") + (bus.emu ? " · emulado" : "");
  b.querySelector(".bus-route").style.color = (routes.get(bus.route) || {}).color || "";
  const line = b.querySelector(".state-line");
  line.className = "state-line " + bus.state;
  line.textContent = label + " · " + bus.pct + " %" + (bus.off_route ? " · fuera de ruta" : "");
  const fill = b.querySelector(".bar > span");
  fill.className = bus.state;
  requestAnimationFrame(() => { fill.style.width = Math.min(100, bus.pct) + "%"; });
  b.querySelector(".free").textContent = bus.free_seats + " sillas libres · " + bus.free_standing + " de pie" + (bus.approx ? " · conteo aproximado" : "");
  b.setAttribute("aria-current", String(!!panelState && panelState.id === bus.bus));
  b.setAttribute("aria-label", "Bus " + bus.bus + ", ruta " + bus.route + ", " + label + ", " + bus.pct + " %, " + bus.free_seats + " sillas libres");
}

function emptyState() {
  // UX-09: mientras llega el primer dato de una ruta recién elegida, siluetas en lugar de una lista vacía.
  const waiting = [...selected].some((id) => !feeds.has(id)) && !Emu.running();
  if (selected.size && waiting) {
    const li = el("li", "empty-wrap");
    li.classList.add("empty");
    li.style.cssText = "border:0;padding:0;gap:10px;align-items:stretch";
    for (let i = 0; i < 2; i++) {
      const sk = el("div", "skeleton");
      sk.setAttribute("aria-hidden", "true");
      sk.append(el("span"), el("span"), el("span"));
      li.append(sk);
    }
    li.append(el("span", "muted small", "Cargando buses…"));
    return li;
  }
  const li = el("li", "empty");
  li.innerHTML = '<svg viewBox="0 0 110 76" aria-hidden="true"><path d="M8 60 C 30 58, 40 30, 60 28 S 90 20, 104 10" stroke="var(--line-2)" stroke-width="5"/>' +
    '<circle cx="60" cy="28" r="7" fill="var(--surface)" stroke="var(--brand)" stroke-width="3"/></svg>';
  const none = !selected.size;
  li.append(el("strong", "", none ? "Elige una ruta para empezar" : "Ningún bus reportando ahora"),
    el("span", "", none ? "Busca tu ruta arriba o toca «Cerca de mí»." : "Las rutas elegidas no tienen buses en servicio en este momento."));
  return li;
}

// ---------------------------------------------------------------- planear un viaje de A a B (rutas directas)

// Sugerencias tolerantes a tildes y mayúsculas, con las rutas de cada parada; «Mi ubicación» como origen.
let myPlace = null;            // { lat, lng } si el pasajero compartió su ubicación (solo en este navegador)

function suggest(input, list) {
  const q = norm(input.value);
  const items = [];
  if (input.name === "from" && (!q || "mi ubicacion".startsWith(q))) items.push({ me: true });
  const seen = new Set();
  if (q) for (const entry of stopIndex) {
    if (entry.key.includes(q) && !seen.has(entry.key)) { seen.add(entry.key); items.push(entry); }
    if (items.length >= 7) break;
  }
  if (!items.length && !q) { list.hidden = true; return; }
  list.replaceChildren(...(items.length ? items.map((item) => {
    const li = el("li");
    const b = el("button", item.me ? "me" : "");
    b.type = "button";
    b.setAttribute("role", "option");
    const txt = el("span", "txt");
    if (item.me) txt.append(el("strong", "", "Mi ubicación"), el("span", "", "Desde la parada más cercana a ti"));
    else txt.append(el("strong", "", item.stop.name), el("span", "", "Rutas " + item.routes.join(" · ")));
    b.append(el("span", "dot"), txt);
    b.addEventListener("mousedown", (e) => e.preventDefault());  // que el campo no pierda el foco antes del clic
    b.addEventListener("click", async () => {
      list.hidden = true;
      if (item.me) {
        const near = await nearestStops(1);
        if (!near.length) return;
        input.value = near[0].entry.stop.name;
        toast("Desde " + near[0].entry.stop.name + ", a " + walk(near[0].m) + " de ti.");
      } else input.value = item.stop.name;
      const next = input.name === "from" ? byId("trip-to") : null;
      if (next && !next.value) next.focus();
    });
    li.append(b);
    return li;
  }) : [el("li", "empty-sugg", "Ninguna parada se llama así. Prueba con un barrio cercano.")]));
  list.hidden = false;
}

["from", "to"].forEach((name) => {
  const input = byId("trip-" + name), list = byId("sugg-" + name);
  input.addEventListener("input", () => suggest(input, list));
  input.addEventListener("focus", () => suggest(input, list));
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") list.hidden = true; });
});

function openPlanner(open) {
  const trip = byId("trip");
  trip.hidden = !open;
  byId("plan-btn").setAttribute("aria-expanded", String(open));
  if (open) { byId("sheet").classList.remove("collapsed"); byId("trip-from").focus(); }
}
byId("plan-btn").addEventListener("click", () => openPlanner(byId("trip").hidden));

// Rutas que pasan por las dos paradas. El orden de las paradas es el de ida: si «desde» va antes, se viaja de ida;
// si va después, de regreso (el regreso recorre las paradas al revés).
function directTrips(fromName, toName) {
  const trips = [];
  routes.forEach((route, routeId) => {
    const stops = route.stops || [];
    const from = stops.find((s) => norm(s.name) === norm(fromName));
    const to = stops.find((s) => norm(s.name) === norm(toName));
    if (!from || !to || from.stop_id === to.stop_id) return;
    const dir = from.order < to.order ? "outbound" : "return";
    trips.push({ routeId, from, to, dir, stops: Math.abs(to.order - from.order) });
  });
  return trips.sort((a, b) => a.stops - b.stops).slice(0, 6);
}

async function planTrip(fromName, toName) {
  const out = byId("trip-results");
  if (!fromName || !toName) { out.replaceChildren(el("li", "notice", "Escribe la parada de salida y la de llegada.")); return; }
  if (norm(fromName) === norm(toName)) { out.replaceChildren(el("li", "notice", "La salida y la llegada son la misma parada.")); return; }
  const trips = directTrips(fromName, toName);
  if (!trips.length) {
    out.replaceChildren(el("li", "notice", "Ninguna ruta pasa por las dos paradas. Prueba con una parada cercana."));
    return;
  }
  out.replaceChildren(el("li", "spinner"));
  const results = await Promise.all(trips.map(async (trip) => {
    try {
      const q = "?route_id=" + encodeURIComponent(trip.routeId) + "&direction=" + trip.dir + "&limit=2";
      const data = await api("/stops/" + encodeURIComponent(trip.from.stop_id) + "/next-buses" + q);
      trip.bus = data.buses.find((b) => b.recommended) || data.buses[0] || null;
    } catch (_) { trip.bus = null; }
    return trip;
  }));
  // Primero los que tienen un bus en camino, por tiempo de llegada; luego los demás, por número de paradas.
  results.sort((a, b) => (a.bus ? a.bus.eta_min : 1e9) - (b.bus ? b.bus.eta_min : 1e9) || a.stops - b.stops);
  out.replaceChildren(...results.map((trip, i) => {
    const li = el("li");
    const card = el("button", "trip-card" + (i === 0 && trip.bus ? " best" : ""));
    card.type = "button";
    card.style.setProperty("--c", routes.get(trip.routeId).color);
    const top = el("span", "bus-top");
    top.append(el("strong", "", trip.routeId + " · " + DIR_LABEL[trip.dir]), el("span", "muted", trip.stops + (trip.stops === 1 ? " parada" : " paradas")));
    if (i === 0 && trip.bus) top.append(el("span", "badge", "Mejor opción"));
    card.append(top);
    if (trip.bus) {
      const occ = trip.bus.bus.occupancy;
      card.append(el("span", "eta", "Bus " + trip.bus.bus.bus_id + " · " + etaText(trip.bus.eta_min).toLowerCase()),
        el("span", "state-line " + occ.state, (occ.label || STATE_LABEL[occ.state]) + " · " + occ.percentage + " %"));
    } else {
      card.append(el("span", "muted", "Ningún bus en camino ahora mismo"));
    }
    card.append(el("span", "free", "Sube en " + trip.from.name + " · baja en " + trip.to.name));
    card.addEventListener("click", () => {
      if (!selected.has(trip.routeId)) toggleRoute(trip.routeId, true);
      openStop(trip.routeId, trip.from, trip.dir);
    });
    li.append(card);
    return li;
  }));
}

byId("trip-form").addEventListener("submit", (event) => {
  event.preventDefault();
  planTrip(event.target.from.value.trim(), event.target.to.value.trim());
});
byId("trip-swap").addEventListener("click", () => {
  const f = byId("trip-form");
  [f.from.value, f.to.value] = [f.to.value, f.from.value];
});

// ---------------------------------------------------------------- UX-04 paradas cerca de mí

let meMarker = null, nearLayer = null;
const walk = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km") + " · " + Math.max(1, Math.round(m / 80)) + " min a pie";

function locate() {
  return new Promise((resolve, reject) => {
    if (myPlace) return resolve(myPlace);
    if (!navigator.geolocation) return reject(new Error("Este navegador no puede dar tu ubicación."));
    navigator.geolocation.getCurrentPosition(
      (pos) => { myPlace = { lat: pos.coords.latitude, lng: pos.coords.longitude }; resolve(myPlace); },
      () => reject(new Error("No tenemos tu ubicación. Actívala en el candado junto a la dirección de la página, o busca tu parada por nombre.")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

async function nearestStops(n) {
  let here;
  try { here = await locate(); } catch (err) { toast(err.message); return []; }
  const at = L.latLng(here.lat, here.lng);
  return stopIndex.map((entry) => ({ entry, m: at.distanceTo([entry.stop.location.lat, entry.stop.location.lng]) }))
    .sort((a, b) => a.m - b.m).slice(0, n);
}

async function showNear() {
  const box = byId("near"), list = byId("near-list");
  box.hidden = false;
  list.replaceChildren(el("li", "spinner"));
  const near = await nearestStops(3);
  if (!near.length) { box.hidden = true; return; }
  if (meMarker) meMarker.remove();
  if (nearLayer) nearLayer.remove();
  nearLayer = L.layerGroup(near.map(({ entry }, i) => L.marker([entry.stop.location.lat, entry.stop.location.lng], {
    icon: L.divIcon({ className: "", html: '<div class="near-pin" style="animation-delay:' + i * 90 + 'ms">' + (i + 1) + "</div>", iconSize: [30, 30] }),
    title: entry.stop.name,
  }).on("click", () => openStop(entry.routes[0], entry.stop)))).addTo(map);
  meMarker = L.marker([myPlace.lat, myPlace.lng], { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18] }), keyboard: false, title: "Tu ubicación" }).addTo(map);
  const bounds = L.latLngBounds([[myPlace.lat, myPlace.lng], ...near.map((x) => [x.entry.stop.location.lat, x.entry.stop.location.lng])]);
  map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 17, duration: reducedMotion.matches ? 0 : 0.8 });
  list.replaceChildren(...near.map(({ entry, m }, i) => {
    const li = el("li");
    const row = el("button", "stop-row");
    row.type = "button";
    row.style.animationDelay = i * 90 + "ms";
    const info = el("span", "info");
    info.append(el("strong", "", entry.stop.name), el("span", "", walk(m) + " · rutas " + entry.routes.join(" · ")));
    row.append(el("span", "n", String(i + 1)), info);
    row.addEventListener("click", () => openStop(entry.routes[0], entry.stop));
    li.append(row);
    return li;
  }));
}
byId("near-btn").addEventListener("click", showNear);
byId("near-close").addEventListener("click", () => {
  byId("near").hidden = true;
  if (meMarker) { meMarker.remove(); meMarker = null; }
  if (nearLayer) { nearLayer.remove(); nearLayer = null; }
});

// ---------------------------------------------------------------- UX-08 paradas favoritas

const favs = () => kept("favs") || [];   // [{ route, stop_id, name, lat, lng }]
const isFav = (stopId) => favs().some((f) => f.stop_id === stopId);

function setFav(route, stop, on) {
  const rest = favs().filter((f) => f.stop_id !== stop.stop_id);
  keep("favs", on ? [...rest, { route, stop_id: stop.stop_id, name: stop.name, lat: stop.location.lat, lng: stop.location.lng }] : rest);
  renderFavs();
}

async function renderFavs() {
  const list = favs();
  byId("favs").hidden = !list.length;
  const box = byId("fav-list");
  box.replaceChildren(...list.map((f) => {
    const li = el("li");
    const row = el("button", "stop-row");
    row.type = "button";
    row.innerHTML = '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
    const info = el("span", "info");
    const next = el("span", "next", "Buscando el próximo bus…");
    info.append(el("strong", "", f.name), el("span", "", "Ruta " + f.route), next);
    row.append(info);
    row.addEventListener("click", () => openStop(f.route, { stop_id: f.stop_id, name: f.name, location: { lat: f.lat, lng: f.lng } }));
    li.append(row);
    api("/stops/" + encodeURIComponent(f.stop_id) + "/next-buses?route_id=" + encodeURIComponent(f.route) + "&limit=1")
      .then((d) => {
        const b = d.buses[0];
        next.textContent = b ? "Bus " + b.bus.bus_id + " · " + etaText(b.eta_min).toLowerCase() + " · " + (b.bus.occupancy.label || STATE_LABEL[b.bus.occupancy.state]) : "Ningún bus en camino ahora";
      })
      .catch(() => { next.textContent = "Sin datos del próximo bus"; });
    return li;
  }));
}

// ---------------------------------------------------------------- UX-06 recorrido guiado

const TOUR = [
  { target: "route-search", title: "Encuentra tu ruta", body: "Escribe el número de la ruta o un barrio por el que pasa: «12» o «Tamasagra». Puedes seguir hasta 5 rutas a la vez." },
  { target: "buses", title: "Mira cuánto espacio hay", body: "Cada bus muestra su ocupación con un color, un icono y un número: verde hay sillas, amarillo solo de pie, rojo lleno." },
  { target: "near-btn", title: "Planea tu viaje", body: "Toca «Cerca de mí» para ver tus paradas más próximas, o «Planear viaje» para ir de una parada a otra." },
];
let tourStep = -1;

function tour(step) {
  document.querySelectorAll(".tour-target").forEach((n) => n.classList.remove("tour-target"));
  const box = byId("tour");
  if (step < 0 || step >= TOUR.length) { box.hidden = true; tourStep = -1; keep("tour_done", true); return; }
  tourStep = step;
  const s = TOUR[step];
  byId("tour-step").textContent = "Paso " + (step + 1) + " de " + TOUR.length;
  byId("tour-title").textContent = s.title;
  byId("tour-body").textContent = s.body;
  byId("tour-dots").replaceChildren(...TOUR.map((_, i) => el("span", i === step ? "on" : "")));
  byId("tour-back").hidden = step === 0;
  byId("tour-next").textContent = step === TOUR.length - 1 ? "Empezar" : "Siguiente";
  box.hidden = false;
  const target = byId(s.target);
  const card = box.querySelector(".tour-card");
  box.classList.toggle("no-target", !target || !target.offsetParent);
  if (target && target.offsetParent) {
    target.classList.add("tour-target");
    target.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
    const r = target.getBoundingClientRect();
    const phone = window.innerWidth <= 720;
    card.style.left = phone ? "16px" : Math.min(window.innerWidth - 400, r.right + 20) + "px";
    card.style.top = phone ? "auto" : Math.max(80, Math.min(window.innerHeight - 280, r.top)) + "px";
    card.style.bottom = phone ? "16px" : "auto";
  }
  byId("tour-next").focus();
}
byId("tour-next").addEventListener("click", () => tour(tourStep + 1));
byId("tour-back").addEventListener("click", () => tour(tourStep - 1));
byId("tour-skip").addEventListener("click", () => tour(-1));
byId("help-btn").addEventListener("click", () => { showView("map"); tour(0); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tourStep >= 0) tour(-1); });

// ---------------------------------------------------------------- panel lateral

function openPanel(kicker, title) {
  closePanel(true);
  byId("panel-kicker").textContent = kicker;
  byId("panel-title").textContent = title;
  byId("panel-body").replaceChildren();
  byId("panel").hidden = false;
  byId("panel").classList.remove("closing");
  byId("scrim").hidden = window.innerWidth > 720;  // en el escritorio el mapa sigue a la vista
  byId("panel-close").focus();
}

function closePanel(instant) {
  if (panelState) { clearInterval(panelState.timer); panelState = null; }
  const panel = byId("panel");
  byId("scrim").hidden = true;
  cards.forEach((li) => li.firstChild.setAttribute("aria-current", "false"));
  markers.forEach((m) => { const pin = m.getElement() && m.getElement().querySelector(".bus-pin"); if (pin) pin.classList.remove("selected"); });
  if (panel.hidden) return;
  if (instant === true || reducedMotion.matches) { panel.hidden = true; return; }
  panel.classList.add("closing");
  panel.addEventListener("animationend", () => { panel.hidden = true; panel.classList.remove("closing"); }, { once: true });
}

function findBus(id) {
  for (const feed of feeds.values()) if (feed.buses.has(id)) return feed.buses.get(id);
  return Emu.get(id);
}

// HU-05: detalle del bus y «Mostrar ocupación real del bus #»
function openBus(id) {
  const bus = findBus(id);
  if (!bus) return;
  openPanel("Ruta " + bus.route + (bus.dir ? " · " + (DIR_LABEL[bus.dir] || bus.dir) : ""), "Bus " + id);
  panelState = { kind: "bus", id, timer: null };
  const body = byId("panel-body");
  const stats = el("div", "stats");
  stats.id = "bus-stats";
  const state = el("p", "state-line");
  state.id = "bus-state";
  const toggle = el("button", "btn primary", "Mostrar ocupación real del bus #" + id);
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "cabin-box");
  const cabinBox = el("div", "cabin-box");
  cabinBox.id = "cabin-box";
  cabinBox.hidden = true;
  // Plano 2D o gemelo 3D (gemelo/index.html): los dos se arman con los mismos identificadores de posición.
  const views = el("div", "seg");
  views.setAttribute("role", "group");
  views.setAttribute("aria-label", "Vista de la cabina");
  const stage = el("div", "cabin-stage");
  CABIN_VIEWS.forEach(([key, label]) => {
    const b = el("button", "seg-btn", label);
    b.type = "button";
    b.dataset.view = key;
    b.setAttribute("aria-pressed", String(key === "front"));  // se abre en 3D, desde la cámara frontal
    b.addEventListener("click", () => {
      views.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      stage.replaceChildren();
      showCabin(stage, key);
    });
    views.append(b);
  });
  cabinBox.append(views, stage);
  const privacy = el("p", "privacy");
  privacy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>';
  privacy.append("Plano armado con identificadores de posición. Ninguna imagen ni rostro sale del bus." +
    (bus.emu ? " Este bus es emulado: sus datos no son reales." : ""));
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = (open ? "Ocultar" : "Mostrar") + " ocupación real del bus #" + id;
    toggle.classList.toggle("primary", !open);
    cabinBox.hidden = !open;
    clearInterval(panelState.timer);
    if (open) { loadCabin(id, stage); panelState.timer = setInterval(() => loadCabin(id, stage), 3000); }
  });
  body.append(stats, state, toggle, cabinBox, privacy);
  fillBusStats();
  cards.forEach((li, key) => li.firstChild.setAttribute("aria-current", String(key === id)));
  const pin = markers.get(id) && markers.get(id).getElement();
  if (pin && pin.querySelector(".bus-pin")) pin.querySelector(".bus-pin").classList.add("selected");
  if (markers.get(id) && !byId("view-map").hidden) map.panTo(markers.get(id).getLatLng(), { animate: !reducedMotion.matches });
}

function fillBusStats() {
  const bus = findBus(panelState.id);
  const stats = byId("bus-stats");
  if (!stats) return;
  if (!bus) { byId("bus-state").textContent = "Este bus dejó de reportar."; return; }
  const items = [[bus.pct + " %", "ocupación", bus.state], [bus.free_seats, "sillas libres"], [bus.free_standing, "de pie libres"]];
  stats.replaceChildren(...items.map(([value, label, cls]) => {
    const box = el("div", "stat");
    const b = el("b", cls || "", String(value));
    box.append(b, el("span", "", label));
    return box;
  }));
  const line = byId("bus-state");
  line.className = "state-line " + bus.state;
  line.textContent = (STATE_LABEL[bus.state] || bus.state) + " · " + bus.seated + " sentados, " + bus.standing + " de pie" +
    (bus.approx ? " · conteo aproximado" : "") + (bus.conf !== undefined ? " · confianza " + Math.round(bus.conf * 100) + " %" : "") +
    (bus.emu ? " · emulado" : "");
}

// Pinta la última lectura de la cabina en la vista elegida (plano o gemelo 3D).
function showCabin(stage, view) {
  const data = panelState && panelState.cabin;
  if (view === "plan") {
    let plan = stage.querySelector(".cabin");
    if (!data) return;
    if (plan) Cabin.update(plan, data.occupied);
    else stage.prepend(Cabin.build(data.occupied));
  } else {
    let frame = stage.querySelector("iframe");
    if (!frame) {
      frame = el("iframe", "twin");
      frame.title = "Gemelo 3D de la cabina";
      frame.src = "gemelo/index.html?embed=1&feed=parent" + (view === "3d" ? "" : "&view=" + view) + "#twin";
      frame.addEventListener("load", () => showCabin(stage, view));
      stage.prepend(frame);
    }
    const twin = frame.contentWindow && frame.contentWindow.__twin;
    if (twin && data) twin.applyCabin(data);
  }
  let note = stage.querySelector(".notice");
  if (data && !data.fresh) {
    if (!note) { note = el("p", "notice"); stage.append(note); }
    note.textContent = "La cabina no está al día: la última lectura es de las " + when(data.updated_at) + ". Se muestran los conteos.";
  } else if (note) note.remove();
}

async function loadCabin(id, stage) {
  try {
    const data = Emu.cabin(id) || await api("/buses/" + encodeURIComponent(id) + "/cabin");
    if (!panelState || panelState.id !== id) return;
    panelState.cabin = data;
    const pressed = stage.parentNode.querySelector(".seg-btn[aria-pressed=true]");
    showCabin(stage, pressed ? pressed.dataset.view : "plan");
  } catch (err) {
    stage.replaceChildren(el("p", "notice", err.message));
  }
}

// HU-06: este bus o el siguiente, en una parada
function openStop(routeId, stop, startDir = "outbound") {
  openPanel("Parada · ruta " + routeId, stop.name);
  panelState = { kind: "stop", id: stop.stop_id, timer: null };
  const body = byId("panel-body");
  const seg = el("div", "seg");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Sentido");
  const list = el("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:12px";
  ["outbound", "return"].forEach((dir) => {
    const b = el("button", "seg-btn", dir === "outbound" ? "Ida" : "Regreso");
    b.type = "button";
    b.setAttribute("aria-pressed", String(dir === startDir));
    b.addEventListener("click", () => {
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      loadNext(routeId, stop.stop_id, dir, list);
    });
    seg.append(b);
  });
  const tools = el("div", "stop-tools");
  const fav = el("button", "btn fav-btn");
  fav.type = "button";
  fav.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
  const paintFav = () => {
    const on = isFav(stop.stop_id);
    fav.setAttribute("aria-pressed", String(on));
    fav.setAttribute("aria-label", on ? "Quitar de mis paradas" : "Guardar en mis paradas");
  };
  paintFav();
  fav.addEventListener("click", () => {
    const on = !isFav(stop.stop_id);
    setFav(routeId, stop, on);
    paintFav();
    toast(on ? "Guardada en Mis paradas" : "Quitada de Mis paradas",
      { label: "Deshacer", run: () => { setFav(routeId, stop, !on); paintFav(); } });
  });
  const goFrom = el("button", "btn", "Ir desde aquí");
  const goTo = el("button", "btn primary", "Ir hasta aquí");
  [goFrom, goTo].forEach((b) => { b.type = "button"; });
  goFrom.addEventListener("click", () => { byId("trip-from").value = stop.name; closePanel(); openPlanner(true); byId("trip-to").focus(); });
  goTo.addEventListener("click", () => { byId("trip-to").value = stop.name; closePanel(); openPlanner(true); });
  tools.append(fav, goFrom, goTo);
  body.append(tools, seg, list);
  loadNext(routeId, stop.stop_id, startDir, list);
  panelState.timer = setInterval(() => {
    const dir = seg.querySelector('[aria-pressed="true"]').textContent === "Ida" ? "outbound" : "return";
    loadNext(routeId, stop.stop_id, dir, list, true);
  }, 10000);
}

async function loadNext(routeId, stopId, dir, list, quiet) {
  if (!quiet) list.replaceChildren(el("div", "spinner"));
  try {
    const q = "?route_id=" + encodeURIComponent(routeId) + "&direction=" + dir + "&limit=2";
    const data = await api("/stops/" + encodeURIComponent(stopId) + "/next-buses" + q);
    if (!panelState || panelState.id !== stopId) return;
    if (!data.buses.length) {
      list.replaceChildren(el("p", "notice", "Ningún bus de la ruta " + routeId + " viene hacia esta parada en " + DIR_LABEL[dir] + "."));
      return;
    }
    list.replaceChildren(...data.buses.map((item) => {
      const bus = item.bus, occ = bus.occupancy;
      const card = el("button", "next-card bus-card" + (item.recommended ? " recommended" : ""));
      card.type = "button";
      const top = el("span", "bus-top");
      top.append(el("strong", "", "Bus " + bus.bus_id));
      if (item.recommended) top.append(el("span", "badge", "Recomendado"));
      const bar = el("span", "bar");
      const fill = el("span", occ.state);
      bar.append(fill);
      card.append(top, el("span", "state-line " + occ.state, (occ.label || STATE_LABEL[occ.state]) + " · " + occ.percentage + " %"), bar,
        el("span", "eta", etaText(item.eta_min)),
        el("span", "free", "A " + item.stops_remaining + " paradas · " + (item.distance_m >= 1000 ? (item.distance_m / 1000).toFixed(1) + " km" : item.distance_m + " m") +
          " · " + occ.free_seats + " sillas libres"));
      requestAnimationFrame(() => { fill.style.width = Math.min(100, occ.percentage) + "%"; });
      card.addEventListener("click", () => openBus(bus.bus_id));
      return card;
    }));
  } catch (err) {
    list.replaceChildren(el("p", "notice", err.message));
  }
}

byId("panel-close").addEventListener("click", closePanel);
byId("scrim").addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !byId("panel").hidden) closePanel(); });

// ---------------------------------------------------------------- HU-08 operación (administrador y auditor)

function showView(name) {
  document.querySelectorAll(".nav-link").forEach((b) => b.toggleAttribute("aria-current", b.dataset.view === name));
  document.querySelectorAll(".nav-link[aria-current]").forEach((b) => b.setAttribute("aria-current", "page"));
  byId("view-map").hidden = name !== "map";
  byId("view-ops").hidden = name !== "ops";
  byId("view-emu").hidden = name !== "emu";
  closePanel(true);
  if (name === "map") map.invalidateSize();
  else if (name === "ops") loadFindings();
  else renderEmu();
}

// La flota completa (no solo las rutas elegidas): /buses/active admite 5 rutas por consulta.
let fleet = [], fleetAt = 0, kpiFilter = null;
const FILTERS = { silent: /silent|no_data|stale/i, over: /crowd|overcap|sobrecupo/i };

async function loadFleet() {
  const ids = [...routes.keys()];
  const groups = [];
  for (let i = 0; i < ids.length; i += 5) groups.push(ids.slice(i, i + 5));
  const answers = await Promise.all(groups.map((g) => api("/buses/active?" + g.map((id) => "route_id=" + encodeURIComponent(id)).join("&")).catch(() => ({ routes: [] }))));
  fleet = answers.flatMap((a) => a.routes.flatMap((r) => r.buses));
  fleetAt = Date.now();
  renderKpis();
}

function renderKpis() {
  const box = byId("ops-kpis");
  if (!box) return;
  const now = Date.now() / 1000;
  const live = fleet.filter((b) => now - b.updated_at <= 60);
  const silent = fleet.length - live.length;
  const avg = live.length ? Math.round(live.reduce((n, b) => n + b.occupancy.percentage, 0) / live.length) : 0;
  const over = live.filter((b) => b.occupancy.state === "overcrowded" || b.occupancy.state === "full").length;
  const items = [
    { id: null, label: "Buses en servicio", value: live.length, hint: fleet.length ? "de " + fleet.length + " con datos" : "esperando datos" },
    { id: null, label: "Ocupación promedio", value: avg + " %", hint: "de los buses en servicio" },
    { id: "over", label: "Llenos o con sobrecupo", value: over, hint: "toca para ver sus hallazgos" },
    { id: "silent", label: "Sin reportar", value: silent, hint: "más de 60 s sin datos" },
  ];
  box.replaceChildren(...items.map((k, i) => {
    const b = el(k.id ? "button" : "div", "kpi");
    if (k.id) {
      b.type = "button";
      b.setAttribute("aria-pressed", String(kpiFilter === k.id));
      b.addEventListener("click", () => { kpiFilter = kpiFilter === k.id ? null : k.id; renderKpis(); loadFindings(); });
    }
    b.style.animationDelay = i * 60 + "ms";
    b.append(el("span", "k-label", k.label), el("b", "", String(k.value)), el("span", "k-hint", k.hint));
    return b;
  }));
}

async function loadFindings() {
  if (Date.now() - fleetAt > 15000) loadFleet();
  const source = document.querySelector('.seg-btn[data-source][aria-pressed="true"]').dataset.source;
  const list = byId("findings");
  list.replaceChildren(el("li", "spinner"));
  try {
    const data = await api("/findings?limit=50" + (source ? "&source=" + source : ""));
    const shown = kpiFilter ? data.findings.filter((f) => FILTERS[kpiFilter].test(f.kind)) : data.findings;
    if (!shown.length) { list.replaceChildren(el("li", "empty", kpiFilter ? "Ningún hallazgo de este tipo." : "Sin hallazgos por ahora.")); return; }
    list.replaceChildren(...shown.map((f, i) => {
      const li = el("li", "finding");
      li.style.animationDelay = Math.min(i, 10) * 30 + "ms";
      const what = el("div", "what");
      what.append(el("strong", "", f.description), el("span", "", "Bus " + f.bus_id + " · " + f.kind + " · " + (f.source === "ai" ? "IA" : "reglas")));
      const time = el("time", "", when(f.created_at));
      li.append(el("span", "sev " + f.severity, SEVERITY[f.severity] || f.severity), what, time);
      return li;
    }));
  } catch (err) {
    list.replaceChildren(el("li", "notice", err.message));
  }
}

document.querySelectorAll(".nav-link").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
document.querySelectorAll(".seg-btn[data-source]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".seg-btn[data-source]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  loadFindings();
}));

byId("analysis-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  const out = byId("analysis-result");
  out.hidden = false;
  out.replaceChildren(el("div", "spinner"), el("span", "muted", "Analizando la flota…"));
  button.disabled = true;
  try {
    const data = await api("/ai/analysis", { method: "POST", body: JSON.stringify({ query: event.target.query.value.trim(), route_ids: [...selected] }) });
    const mode = el("span", "mode", data.mode === "ai" ? "Análisis con IA" : "Análisis por reglas" + (data.degraded_reason ? " · " + data.degraded_reason : ""));
    const items = el("ul");
    (data.findings || []).forEach((f) => items.append(el("li", "", (f.bus_id ? "Bus " + f.bus_id + ": " : "") + (f.description || f.kind))));
    out.replaceChildren(mode, el("p", "", data.summary), items, el("span", "muted small", data.recorded_findings + " hallazgos guardados"));
    if (!byId("view-ops").hidden) loadFindings();
  } catch (err) {
    out.replaceChildren(el("p", "error", err.message));
  } finally {
    button.disabled = false;
  }
});

// ---------------------------------------------------------------- emulación de la flota (todas las rutas)

const emuRows = new Map();     // bus_id -> fila de la vista Emulación

function renderEmu() {
  const buses = Emu.list();
  const kpis = byId("emu-kpis");
  const grid = byId("emu-routes");
  if (!buses.length) {
    emuRows.clear();
    kpis.replaceChildren();
    const empty = el("div", "empty");
    empty.append(el("strong", "", "La emulación está detenida"),
      el("span", "", "Elige cuántos buses por ruta y el escenario, y pulsa «Iniciar emulación»."));
    grid.replaceChildren(empty);
    return;
  }
  const avg = Math.round(buses.reduce((n, b) => n + b.pct, 0) / buses.length);
  const crowded = buses.filter((b) => b.state === "full" || b.state === "overcrowded").length;
  const people = buses.reduce((n, b) => n + b.seated + b.standing, 0);
  kpis.replaceChildren(...[[buses.length, "buses en servicio"], [avg + " %", "ocupación promedio"],
    [people, "pasajeros a bordo"], [crowded, "llenos o con sobrecupo"]].map(([v, label]) => {
    const box = el("div", "stat");
    box.append(el("b", "", String(v)), el("span", "", label));
    return box;
  }));
  if (!emuRows.size) {
    // Primera vuelta: se arma la cuadrícula; después solo cambian los textos y las barras.
    grid.replaceChildren();
    const byRoute = new Map();
    buses.forEach((b) => { if (!byRoute.has(b.route)) byRoute.set(b.route, []); byRoute.get(b.route).push(b); });
    let i = 0;
    for (const [routeId, list] of byRoute) {
      const info = routes.get(routeId) || {};
      const card = el("section", "emu-route");
      card.style.setProperty("--c", info.color || "var(--accent)");
      card.style.animationDelay = Math.min(i++, 12) * 30 + "ms";
      const head = el("div", "emu-route-head");
      head.append(el("span", "bullet"), el("strong", "", routeId), el("span", "muted", info.name || ""));
      const rows = el("div", "emu-buses");
      list.forEach((b) => {
        const row = el("button", "emu-bus");
        row.type = "button";
        row.innerHTML = '<span class="emu-bus-top"><strong></strong><span class="state-line"></span></span><span class="bar"><span></span></span>';
        row.addEventListener("click", () => openBus(b.bus));
        rows.append(row);
        emuRows.set(b.bus, row);
      });
      card.append(head, rows);
      grid.append(card);
    }
  }
  for (const b of buses) {
    const row = emuRows.get(b.bus);
    if (!row) continue;
    row.querySelector("strong").textContent = "Bus " + b.bus + " · " + DIR_LABEL[b.dir];
    const line = row.querySelector(".state-line");
    line.className = "state-line " + b.state;
    line.textContent = (STATE_LABEL[b.state] || b.state) + " · " + b.pct + " %";
    const fill = row.querySelector(".bar > span");
    fill.className = b.state;
    fill.style.width = Math.min(100, b.pct) + "%";
  }
}

// Iniciar o salir de la simulación: el mismo interruptor en la barra superior, en el aviso y en la vista Emulación.
function syncSim() {
  const on = Emu.running();
  const n = Emu.list().length;
  const top = byId("sim-btn");
  top.querySelector(".long").textContent = on ? "Salir de la simulación" : "Iniciar simulación";
  top.querySelector(".short").textContent = on ? "Salir" : "Simular";
  top.setAttribute("aria-pressed", String(on));
  const form = byId("emu-toggle");
  form.textContent = on ? "Salir de la simulación" : "Iniciar simulación";
  form.classList.toggle("primary", !on);
  byId("sim-banner").hidden = !on;
  byId("sim-count").textContent = n + " buses emulados en " + new Set(Emu.list().map((b) => b.route)).size + " rutas";
  document.body.classList.toggle("simulating", on);
}

async function startSim() {
  const form = byId("emu-form");
  const buttons = [byId("sim-btn"), byId("emu-toggle")];
  buttons.forEach((b) => { b.disabled = true; });
  byId("emu-toggle").textContent = "Cargando recorridos…";
  try {
    const ids = [...routes.keys()];
    if (!ids.length) throw new Error("No hay rutas cargadas todavía.");
    await Promise.all(ids.map(ensurePath));
    emuRows.clear();
    Emu.start(ids.map((id) => ({ route_id: id, path: routes.get(id).path })), Number(form.per_route.value), form.scenario.value);
    toast("Simulación iniciada: " + Emu.list().length + " buses en " + ids.length + " rutas.");
  } catch (err) {
    toast(err.message);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    syncSim();
  }
}

function stopSim() {
  if (panelState && panelState.kind === "bus" && Emu.get(panelState.id)) closePanel(true);
  Emu.stop();
  emuRows.clear();
  toast("Saliste de la simulación: solo se muestran datos reales.");
}

const toggleSim = () => (Emu.running() ? stopSim() : startSim());

Emu.onTick(() => {
  render();
  syncSim();
  if (!byId("view-emu").hidden) renderEmu();
});

byId("emu-form").addEventListener("submit", (event) => { event.preventDefault(); toggleSim(); });
byId("sim-btn").addEventListener("click", toggleSim);
byId("sim-exit").addEventListener("click", stopSim);
byId("emu-form").scenario.addEventListener("change", (e) => Emu.setScenario(e.target.value));
byId("emu-form").on_map.addEventListener("change", (e) => { emuOnMap = e.target.checked; render(); });

// ---------------------------------------------------------------- arranque, celular y salida

byId("sheet-handle").addEventListener("click", () => {
  const sheet = byId("sheet");
  const collapsed = sheet.classList.toggle("collapsed");
  byId("sheet-handle").setAttribute("aria-expanded", String(!collapsed));
});

async function start() {
  byId("auth").hidden = true;
  byId("shell").hidden = false;
  const staff = session.role === "admin" || session.role === "auditor";
  byId("nav-ops").hidden = !staff;
  byId("avatar").textContent = (load("who") || "?").slice(0, 1);
  if (!map) {
    map = L.map("map", { zoomControl: false }).setView(cfg.mapCenter || [1.2136, -77.2811], cfg.mapZoom || 14);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer(cfg.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: cfg.tileAttribution || "&copy; OpenStreetMap",
    }).addTo(map);
  }
  requestAnimationFrame(() => map.invalidateSize());
  try { await showRoutes(); } catch (err) { toast(err.message); }
  render();
  connect();
  if (!kept("tour_done")) setTimeout(() => tour(0), 600);  // UX-06: solo la primera vez en este navegador
}

function logout(notice) {
  const refresh = session.refresh;
  Object.assign(session, { access: null, refresh: null, role: null });
  store("refresh_token", null);
  store("role", null);
  clearTimeout(refreshTimer);
  if (refresh) {
    fetch(API + "/api/v1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => {});
  }
  if (socket) socket.close(1000);
  Emu.stop();
  closePanel(true);
  feeds.clear();
  markers.forEach((m) => m.remove());
  markers.clear();
  cards.forEach((li) => li.remove());
  cards.clear();
  routes.forEach((r) => { if (r.layers) { r.layers.remove(); r.layers = null; } });
  if (cityStops) { cityStops.remove(); cityStops = null; }
  tour(-1);
  setStatus("off", "Desconectado");
  byId("shell").hidden = true;
  byId("auth").hidden = false;
  const box = byId("auth-notice");
  box.textContent = typeof notice === "string" ? notice : "";
  box.hidden = typeof notice !== "string";
}

byId("logout").addEventListener("click", () => logout());
byId("route-search").addEventListener("input", renderRouteResults);
byId("route-search").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; renderRouteResults(); } });

// Si queda una sesión abierta en esta pestaña, se reanuda sin pedir la contraseña.
(async () => {
  if (load("refresh_token") && (await refreshTokens())) await start();
})();
