// Cabina 3D con transformaciones CSS: el respaldo del gemelo cuando el navegador no tiene WebGL.
// Sillas, sitios de pie y pasajeros son bloques de la página en perspectiva; se gira 360° arrastrando,
// se acerca con la rueda o el pellizco y da una vuelta lenta hasta que la persona la toca.
// Se arma con los mismos identificadores de posición que el plano (S02-L1, P04…): ninguna imagen sale del bus.
"use strict";

window.Cabin3D = (() => {
  // Medidas en px de la maqueta: x a lo largo del bus (el frente en x = 0), y a lo ancho (puerta a la derecha), z hacia arriba.
  const SEAT = 30, ROW = 40, X0 = 46;
  const Y = { L1: 10, L2: 44, P: 84, R2: 126, R1: 160 };
  const WIDTH = 200, LENGTH = X0 + 11 * ROW + 10;
  // Puertas a la derecha: se sube por la delantera (fila 1) y se baja por la trasera (fila 10).
  const ENTRY = { x: X0 + 2, y: WIDTH + 14 }, EXIT = { x: X0 + 9 * ROW + 2, y: WIDTH + 14 };
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const div = (cls, style) => {
    const node = document.createElement("div");
    node.className = cls;
    if (style) node.style.cssText = style;
    return node;
  };

  // Un bloque con tapa y cuatro caras; el color sale de --c y las caras laterales se oscurecen en CSS.
  function box(x, y, z, w, d, h, cls) {
    const b = div("c3-box " + (cls || ""), "transform: translate3d(" + x + "px," + y + "px," + z + "px)");
    b.append(
      div("c3-face top", "width:" + w + "px;height:" + d + "px;transform:translateZ(" + h + "px)"),
      div("c3-face side", "width:" + w + "px;height:" + h + "px;transform-origin:top;transform:rotateX(90deg)"),
      div("c3-face side", "width:" + w + "px;height:" + h + "px;transform-origin:top;transform:translateY(" + d + "px) rotateX(90deg)"),
      div("c3-face end", "width:" + h + "px;height:" + d + "px;transform-origin:left;transform:rotateY(-90deg)"),
      div("c3-face end", "width:" + h + "px;height:" + d + "px;transform-origin:left;transform:translateX(" + w + "px) rotateY(-90deg)"),
    );
    return b;
  }

  // Pasajero genérico: cuerpo y cabeza amarilla, como las figuras de la maqueta. Sin rasgos: nadie es identificable.
  function person(x, y, seated) {
    const p = div("c3-person");
    const base = seated ? 10 : 0, body = seated ? 18 : 32;
    p.append(box(x + 8, y + 9, base, 14, 12, body, "body"), box(x + 10, y + 10, base + body, 10, 10, 10, "head"));
    return p;
  }

  function build(occupied) {
    const scene = div("c3");
    scene.setAttribute("role", "img");
    scene.tabIndex = 0;
    const world = div("c3-world");
    const positions = new Map();  // identificador -> { node, person }

    world.append(div("c3-floor", "width:" + LENGTH + "px;height:" + WIDTH + "px"));
    // Paredes bajas y transparentes para que se vea adentro; las puertas, en ámbar, a la derecha (filas 1 y 10).
    world.append(div("c3-wall", "width:" + LENGTH + "px;height:38px;transform-origin:top;transform:rotateX(90deg)"));
    world.append(div("c3-wall", "width:" + LENGTH + "px;height:38px;transform-origin:top;transform:translateY(" + WIDTH + "px) rotateX(90deg)"));
    world.append(div("c3-wall front", "width:38px;height:" + WIDTH + "px;transform-origin:left;transform:rotateY(-90deg)"));
    [1, 10].forEach((n) => world.append(div("c3-door", "width:" + (ROW - 4) + "px;height:40px;transform-origin:top;transform:translate3d(" +
      (X0 + (n - 1) * ROW) + "px," + (WIDTH + 1) + "px,0) rotateX(90deg)")));

    const seat = (id, x, y) => {
      const node = div("c3-seat");
      node.append(box(x, y, 0, SEAT, SEAT, 10, "cushion"), box(x + SEAT - 6, y, 10, 6, SEAT, 24, "back"));
      const who = person(x, y, true);
      world.append(node, who);
      positions.set(id, { node, person: who, x, y });
    };
    for (let n = 1; n <= 10; n++) {
      const r = String(n).padStart(2, "0"), x = X0 + (n - 1) * ROW;
      seat("S" + r + "-L1", x, Y.L1);
      seat("S" + r + "-L2", x, Y.L2);
      if (n === 1 || n === 10) continue;  // puerta a la derecha
      seat("S" + r + "-R2", x, Y.R2);
      seat("S" + r + "-R1", x, Y.R1);
      const spot = div("c3-stand", "width:" + SEAT + "px;height:" + SEAT + "px;transform:translate3d(" + x + "px," + (Y.P + 2) + "px,1px)");
      const who = person(x, Y.P + 2, false);
      world.append(spot, who);
      positions.set("P" + r, { node: spot, person: who, x, y: Y.P + 2 });
    }
    const benchX = X0 + 10 * ROW;
    for (let t = 1; t <= 5; t++) seat("S11-T" + t, benchX, 6 + (t - 1) * 38);

    scene.append(world, div("c3-hint", "") );
    scene.lastChild.textContent = "Entrada adelante · salida atrás · arrastra para girar";
    const view = { theta: -35, tilt: 58, zoom: 0.72, spin: !matchMedia("(prefers-reduced-motion: reduce)").matches };
    const place = () => {
      world.style.transform = "scale(" + view.zoom + ") rotateX(" + view.tilt + "deg) rotateZ(" + view.theta + "deg) translate(" + -LENGTH / 2 + "px," + -WIDTH / 2 + "px)";
    };
    place();

    // Arrastrar gira (360° alrededor, inclinación entre 15° y 85°); dos dedos o la rueda acercan.
    const pointers = new Map();
    let pinch = 0;
    scene.addEventListener("pointerdown", (e) => { scene.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); view.spin = false; scene.classList.add("drag"); });
    scene.addEventListener("pointermove", (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) view.zoom = Math.min(2.2, Math.max(0.6, view.zoom * d / pinch));
        pinch = d;
      } else {
        view.theta -= (e.clientX - last[0]) * 0.5;
        view.tilt = Math.min(85, Math.max(15, view.tilt - (e.clientY - last[1]) * 0.3));
      }
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      place();
    });
    const up = (e) => { pointers.delete(e.pointerId); pinch = 0; if (!pointers.size) scene.classList.remove("drag"); };
    scene.addEventListener("pointerup", up);
    scene.addEventListener("pointercancel", up);
    scene.addEventListener("wheel", (e) => { e.preventDefault(); view.spin = false; view.zoom = Math.min(2.2, Math.max(0.6, view.zoom * Math.exp(-e.deltaY * 0.001))); place(); }, { passive: false });
    scene.addEventListener("keydown", (e) => {  // también con el teclado: flechas giran, + y - acercan
      const step = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key];
      if (step) { view.theta += step[0]; view.tilt = Math.min(85, Math.max(15, view.tilt + step[1])); }
      else if (e.key === "+" || e.key === "-") view.zoom = Math.min(2.2, Math.max(0.6, view.zoom * (e.key === "+" ? 1.1 : 0.9)));
      else return;
      e.preventDefault(); view.spin = false; place();
    });
    let t0 = performance.now();
    const spin = (now) => {
      if (!scene.isConnected) return;  // el panel se cerró: se detiene solo
      if (view.spin) { view.theta += (now - t0) * 0.012; place(); }
      t0 = now;
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);

    scene._positions = positions;
    update(scene, occupied, true);
    return scene;
  }

  // Compara con la lectura anterior: quien sube entra caminando desde la puerta delantera hasta su puesto, y quien
  // baja camina hasta la trasera y desaparece. Devuelve cuántos subieron y bajaron.
  function update(scene, occupied, first) {
    const taken = new Set(occupied || []);
    let boarded = 0, alighted = 0;
    scene._positions.forEach((pos, id) => {
      const on = taken.has(id), was = pos.node.classList.contains("on");
      if (on === was) return;
      const p = pos.person;
      clearTimeout(p._walk);
      pos.node.classList.toggle("on", on);
      if (first || REDUCED) { p.classList.toggle("on", on); return; }
      if (on) {
        boarded++;
        p.classList.remove("walking");
        p.style.transform = "translate3d(" + (ENTRY.x - pos.x) + "px," + (ENTRY.y - pos.y) + "px,0)";
        p.classList.add("on");
        void p.offsetWidth;
        p.classList.add("walking");
        p.style.transform = "";
        p._walk = setTimeout(() => p.classList.remove("walking"), 1700);
      } else {
        alighted++;
        p.classList.add("walking");
        p.style.transform = "translate3d(" + (EXIT.x - pos.x) + "px," + (EXIT.y - pos.y) + "px,0)";
        p._walk = setTimeout(() => { p.classList.remove("on", "walking"); p.style.transform = ""; }, 1700);
      }
    });
    scene.setAttribute("aria-label", "Cabina en 3D: " + taken.size + " posiciones ocupadas. Arrastra o usa las flechas para girarla.");
    return { boarded, alighted };
  }

  return { build, update };
})();
