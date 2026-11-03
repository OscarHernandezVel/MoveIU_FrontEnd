// Cliente web de MoveIU: ocupación de buses en vivo.
// Usa solo la API pública del backend: /api/v1/auth/*, /routes, /buses/{id}/cabin, /stops/*/next-buses,
// /findings, /ai/analysis y el WebSocket /ws/v1/buses/stream.
"use strict";

const cfg = window.APP_CONFIG || {};
const API = (cfg.apiBaseUrl || window.location.origin).replace(/\/+$/, "");
const WS_URL = API.replace(/^http/, "ws") + "/ws/v1/buses/stream";
const MAX_ROUTES = 5;
const GLIDE_MS = 2800;
const ROUTE_COLORS = ["#2EE6C5", "#FFB547", "#7C8CFF", "#F472B6", "#34D399"];
const STATE_LABEL = {
  available_seats: "Sillas disponibles", standing_only: "Solo de pie",
  full: "Lleno", overcrowded: "Sobrecupo", no_data: "Sin datos",
};
const DIR_LABEL = { outbound: "ida", return: "regreso" };
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
const selected = new Set((cfg.defaultRoutes || []).slice(0, MAX_ROUTES));
let socket = null, reconnectDelay = 1000, refreshTimer = null, map = null;
let panelState = null;         // { kind: "bus", id, timer } | { kind: "stop", ... }
let toastTimer = null;

// ---------------------------------------------------------------- utilidades

function store(key, value) {
  try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch (_) {}
}
function load(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }

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

function toast(text) {
  const box = byId("toast");
  box.textContent = text;
  box.hidden = false;
  box.style.animation = "none"; void box.offsetWidth; box.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
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

function setStatus(state, text) {
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

async function showRoutes() {
  const data = await api("/routes");
  const box = byId("routes");
  box.replaceChildren();
  (data.routes || []).forEach((route, index) => {
    const info = routes.get(route.route_id) || {};
    routes.set(route.route_id, { ...info, name: route.name, stops: route.stops, color: ROUTE_COLORS[index % ROUTE_COLORS.length] });
    const chip = el("button", "chip");
    chip.type = "button";
    chip.style.setProperty("--c", routes.get(route.route_id).color);
    chip.setAttribute("aria-pressed", String(selected.has(route.route_id)));
    chip.title = route.name;
    chip.append(el("span", "bullet"), document.createTextNode(route.route_id));
    chip.addEventListener("click", () => toggleRoute(route.route_id, chip));
    box.append(chip);
  });
  [...selected].forEach((id) => routes.has(id) ? drawRoute(id) : selected.delete(id));
  countRoutes();
}

function countRoutes() { byId("route-count").textContent = selected.size + " de " + MAX_ROUTES; }

function toggleRoute(id, chip) {
  if (selected.has(id)) {
    selected.delete(id);
    feeds.delete(id);
    send({ action: "unsubscribe", routes: [id] });
    const layers = routes.get(id).layers;
    if (layers) layers.remove();
    chip.setAttribute("aria-pressed", "false");
    render();
  } else {
    if (selected.size >= MAX_ROUTES) { toast("Máximo " + MAX_ROUTES + " rutas a la vez."); return; }
    selected.add(id);
    send({ action: "subscribe", routes: [id] });
    chip.setAttribute("aria-pressed", "true");
    drawRoute(id);
    render();
  }
  countRoutes();
}

async function drawRoute(id) {
  const route = routes.get(id);
  try {
    if (!route.path) route.path = (await api("/routes/" + encodeURIComponent(id))).path || [];
  } catch (err) { toast(err.message); return; }
  if (!selected.has(id)) return;
  if (route.layers) route.layers.remove();
  const group = L.layerGroup().addTo(map);
  route.layers = group;
  const latlngs = route.path.map((p) => [p.lat, p.lng]);
  if (latlngs.length > 1) {
    const line = L.polyline(latlngs, { color: route.color, weight: 5, opacity: 0.9, className: "route-line", interactive: false }).addTo(group);
    const path = line.getElement();
    if (path && path.getTotalLength) {
      path.style.setProperty("--len", Math.ceil(path.getTotalLength()));
      // Al terminar de dibujarse se quita el trazo discontinuo: al hacer zoom cambia la longitud.
      path.addEventListener("animationend", () => { path.classList.remove("route-line"); path.style.strokeDasharray = "none"; }, { once: true });
    }
  }
  (route.stops || []).forEach((stop) => {
    L.circleMarker([stop.location.lat, stop.location.lng], {
      radius: 6, weight: 3, color: route.color, fillColor: "#0B1020", fillOpacity: 1, className: "stop-dot",
    }).bindTooltip(stop.name).on("click", () => openStop(id, stop)).addTo(group);
  });
}

// ---------------------------------------------------------------- HU-04 buses en vivo

function liveBuses() {
  const list = [];
  for (const [route, feed] of feeds) if (selected.has(route)) list.push(...feed.buses.values());
  return list.sort((a, b) => a.pct - b.pct);
}

function pinHtml(bus) {
  return '<div class="bus-pin ' + bus.state + (panelState && panelState.id === bus.bus ? " selected" : "") +
    '"><span class="pill">' + bus.bus + " · " + bus.pct + ' %</span><span class="stem"></span></div>';
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
  b.querySelector(".bus-route").textContent = bus.route + (bus.dir ? " · " + (DIR_LABEL[bus.dir] || bus.dir) : "");
  b.querySelector(".bus-route").style.color = (routes.get(bus.route) || {}).color || "";
  const line = b.querySelector(".state-line");
  line.className = "state-line " + bus.state;
  line.textContent = label + " · " + bus.pct + " %" + (bus.off_route ? " · fuera de ruta" : "");
  const fill = b.querySelector(".bar > span");
  fill.className = bus.state;
  requestAnimationFrame(() => { fill.style.width = Math.min(100, bus.pct) + "%"; });
  b.querySelector(".free").textContent = bus.free_seats + " sillas libres · " + bus.free_standing + " de pie" + (bus.approx ? " · conteo aproximado" : "");
  b.setAttribute("aria-current", String(!!panelState && panelState.id === bus.bus));
}

function emptyState() {
  const li = el("li", "empty");
  li.innerHTML = '<svg viewBox="0 0 110 76" aria-hidden="true"><path d="M8 60 C 30 58, 40 30, 60 28 S 90 20, 104 10" stroke="var(--line-2)" stroke-width="5"/>' +
    '<circle cx="60" cy="28" r="7" fill="var(--surface)" stroke="var(--accent)" stroke-width="3"/></svg>';
  const none = !selected.size;
  li.append(el("strong", "", none ? "Elige una ruta para empezar" : "Ningún bus reportando"),
    el("span", "", none ? "Toca una ruta de arriba: verás su recorrido y sus buses." : "Prueba otra ruta o espera unos segundos."));
  return li;
}

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
  return null;
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
  const cabinBox = el("div");
  cabinBox.id = "cabin-box";
  cabinBox.hidden = true;
  const privacy = el("p", "privacy");
  privacy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>';
  privacy.append("Plano armado con identificadores de posición. Ninguna imagen ni rostro sale del bus.");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = (open ? "Ocultar" : "Mostrar") + " ocupación real del bus #" + id;
    toggle.classList.toggle("primary", !open);
    cabinBox.hidden = !open;
    clearInterval(panelState.timer);
    if (open) { loadCabin(id, cabinBox); panelState.timer = setInterval(() => loadCabin(id, cabinBox), 3000); }
  });
  body.append(stats, state, toggle, cabinBox, privacy);
  fillBusStats();
  cards.forEach((li, key) => li.firstChild.setAttribute("aria-current", String(key === id)));
  const pin = markers.get(id) && markers.get(id).getElement();
  if (pin && pin.querySelector(".bus-pin")) pin.querySelector(".bus-pin").classList.add("selected");
  if (markers.get(id)) map.panTo(markers.get(id).getLatLng(), { animate: !reducedMotion.matches });
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
    (bus.approx ? " · conteo aproximado" : "") + (bus.conf !== undefined ? " · confianza " + Math.round(bus.conf * 100) + " %" : "");
}

async function loadCabin(id, box) {
  try {
    const data = await api("/buses/" + encodeURIComponent(id) + "/cabin");
    if (!panelState || panelState.id !== id) return;
    let plan = box.querySelector(".cabin");
    if (plan) Cabin.update(plan, data.occupied);
    else { plan = Cabin.build(data.occupied); box.replaceChildren(plan); }
    let note = box.querySelector(".notice");
    if (!data.fresh) {
      if (!note) { note = el("p", "notice"); box.append(note); }
      note.textContent = "El plano no está al día: la última lectura es de las " + when(data.updated_at) + ". Se muestran los conteos.";
    } else if (note) note.remove();
  } catch (err) {
    box.replaceChildren(el("p", "notice", err.message));
  }
}

// HU-06: este bus o el siguiente, en una parada
function openStop(routeId, stop) {
  openPanel("Parada · ruta " + routeId, stop.name);
  panelState = { kind: "stop", id: stop.stop_id, timer: null };
  const body = byId("panel-body");
  const seg = el("div", "seg");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Sentido");
  const list = el("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:12px";
  ["outbound", "return"].forEach((dir, i) => {
    const b = el("button", "seg-btn", dir === "outbound" ? "Ida" : "Regreso");
    b.type = "button";
    b.setAttribute("aria-pressed", String(i === 0));
    b.addEventListener("click", () => {
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      loadNext(routeId, stop.stop_id, dir, list);
    });
    seg.append(b);
  });
  body.append(seg, list);
  loadNext(routeId, stop.stop_id, "outbound", list);
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
  closePanel(true);
  if (name === "map") map.invalidateSize();
  else loadFindings();
}

async function loadFindings() {
  const source = document.querySelector('.seg-btn[data-source][aria-pressed="true"]').dataset.source;
  const list = byId("findings");
  list.replaceChildren(el("li", "spinner"));
  try {
    const data = await api("/findings?limit=50" + (source ? "&source=" + source : ""));
    if (!data.findings.length) { list.replaceChildren(el("li", "empty", "Sin hallazgos por ahora.")); return; }
    list.replaceChildren(...data.findings.map((f, i) => {
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
  closePanel(true);
  feeds.clear();
  markers.forEach((m) => m.remove());
  markers.clear();
  cards.forEach((li) => li.remove());
  cards.clear();
  routes.forEach((r) => { if (r.layers) { r.layers.remove(); r.layers = null; } });
  setStatus("off", "Desconectado");
  byId("shell").hidden = true;
  byId("auth").hidden = false;
  const box = byId("auth-notice");
  box.textContent = typeof notice === "string" ? notice : "";
  box.hidden = typeof notice !== "string";
}

byId("logout").addEventListener("click", () => logout());

// Si queda una sesión abierta en esta pestaña, se reanuda sin pedir la contraseña.
(async () => {
  if (load("refresh_token") && (await refreshTokens())) await start();
})();
