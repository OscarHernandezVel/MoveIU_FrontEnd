// Emulación (vista «Emulación»): buses ficticios que recorren el trazado real de cada ruta y suben o bajan
// pasajeros. Corre solo en este navegador: no envía nada al backend ni lo ven otros usuarios.
// Produce los mismos datos que el servidor (bus del WebSocket y respuesta de /buses/{id}/cabin),
// así el mapa, la lista, el panel y el gemelo 3D los muestran sin un camino aparte.
"use strict";

window.Emu = (() => {
  const SEATS = [], STANDS = [];
  for (let n = 1; n <= 10; n++) {
    const r = String(n).padStart(2, "0");
    SEATS.push("S" + r + "-L1", "S" + r + "-L2");
    if (n !== 1 && n !== 10) { SEATS.push("S" + r + "-R2", "S" + r + "-R1"); STANDS.push("P" + r); }
  }
  for (let t = 1; t <= 5; t++) SEATS.push("S11-T" + t);
  const CAPACITY = SEATS.length + STANDS.length;  // 41 sillas + 8 sitios de pie
  // Fracción de la capacidad que se busca en cada escenario (a mitad de recorrido es donde más gente va).
  const SCENARIOS = { valle: 0.35, normal: 0.75, pico: 1.12 };

  const buses = new Map();  // bus_id -> estado interno
  let timer = null, scenario = "normal", listener = null;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function measure(path) {
    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const dy = (b.lat - a.lat) * 111320, dx = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    return cum;
  }

  function pointAt(bus, s) {
    const { path, cum } = bus;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const k = cum[i] === cum[i - 1] ? 0 : (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
    return { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * k, lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * k };
  }

  // Ajusta un conjunto de posiciones a la cantidad pedida: solo suben o bajan las que hacen falta.
  // Nadie cambia de silla «por arte de magia»: una posición solo se ocupa o se libera.
  function settle(set, pool, goal) {
    while (set.size < goal) set.add(pick(pool.filter((id) => !set.has(id))));
    while (set.size > goal) set.delete(pick([...set]));
  }

  // Entre paradas el bus avanza con la misma gente; al detenerse en una parada unos bajan y otros suben.
  function step(bus) {
    const length = bus.cum[bus.cum.length - 1];
    if (bus.dwell > 0) {
      bus.dwell -= 1;
    } else {
      bus.s += bus.speed * 3;
      if (bus.s >= length) { bus.s -= length; bus.dir = bus.dir === "outbound" ? "return" : "outbound"; }
      bus.untilStop -= 1;
      if (bus.untilStop > 0) return;
      bus.untilStop = 3 + Math.floor(Math.random() * 4);  // la siguiente parada, en 9 a 18 s
      bus.dwell = 1;                                       // 3 s detenido
    }
    const progress = bus.s / length;
    const target = CAPACITY * SCENARIOS[scenario] * (0.45 + 0.55 * Math.sin(Math.PI * progress)) * bus.mood;
    bus.people = Math.max(0, Math.round(bus.people + Math.sign(target - bus.people) * rand(0, 4) + rand(-1.5, 1.5)));
    const seated = Math.min(SEATS.length, bus.people);
    const standing = Math.min(STANDS.length, bus.people - seated);
    bus.oop = Math.max(0, bus.people - seated - standing);
    settle(bus.seats, SEATS, seated);
    settle(bus.stands, STANDS, standing);
  }

  function state(bus) {
    const seated = bus.seats.size, standing = bus.stands.size;
    const where = pointAt(bus, bus.s);
    const st = seated < SEATS.length ? "available_seats" : standing < STANDS.length ? "standing_only" : bus.oop ? "overcrowded" : "full";
    return {
      bus: bus.id, route: bus.route, dir: bus.dir, lat: where.lat, lng: where.lng,
      pct: Math.round(bus.people / CAPACITY * 100), state: st, seated, standing: standing + bus.oop,
      free_seats: SEATS.length - seated, free_standing: STANDS.length - standing,
      conf: 0.93, approx: false, off_route: false, ts: Date.now() / 1000, emu: true, at_stop: bus.dwell > 0,
    };
  }

  function cabin(id) {
    const bus = buses.get(id);
    if (!bus) return null;
    const seated = bus.seats.size, standing = bus.stands.size;
    return {
      bus_id: id, route_id: bus.route, updated_at: Date.now() / 1000, fresh: true,
      occupied: [...bus.seats, ...bus.stands].sort(),
      counts: {
        seated, standing, standing_out_of_position: bus.oop, people_on_board: bus.people,
        free_seats: SEATS.length - seated, free_standing: STANDS.length - standing,
      },
      confidence: 0.93, approximate: false,
    };
  }

  // routes: [{ route_id, path: [{lat, lng}] }]
  function start(routes, perRoute, scen) {
    stop();
    scenario = scen in SCENARIOS ? scen : "normal";
    for (const route of routes) {
      if (!route.path || route.path.length < 2) continue;
      const cum = measure(route.path);
      for (let n = 1; n <= perRoute; n++) {
        const id = route.route_id + "-" + String(n).padStart(2, "0");
        const bus = {
          id, route: route.route_id, path: route.path, cum, dir: "outbound",
          s: cum[cum.length - 1] * (n - 1 + Math.random() * 0.5) / perRoute,
          speed: rand(5, 8.5), mood: rand(0.75, 1.15), people: 0, oop: 0, seats: new Set(), stands: new Set(),
          dwell: 0, untilStop: 1 + n,
        };
        bus.people = Math.round(CAPACITY * SCENARIOS[scenario] * bus.mood * 0.7);
        bus.dwell = 1;  // arranca en una parada, para llenar la cabina de entrada
        step(bus);
        buses.set(id, bus);
      }
    }
    timer = setInterval(() => { buses.forEach(step); if (listener) listener(); }, 3000);
    if (listener) listener();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    buses.clear();
    if (listener) listener();
  }

  return {
    start, stop, cabin,
    running: () => timer !== null,
    setScenario: (s) => { if (s in SCENARIOS) scenario = s; },
    list: () => [...buses.values()].map(state),
    get: (id) => (buses.has(id) ? state(buses.get(id)) : null),
    onTick: (fn) => { listener = fn; },
  };
})();
