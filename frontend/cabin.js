// Plano de la cabina (HU-05): 10 filas L1 L2 | pasillo P | R2 R1, puerta en las filas 1 y 10, banca trasera de 5.
// Se arma solo con los identificadores de posición que manda el bus (S02-L1, P04...): ninguna imagen sale del bus.
"use strict";

window.Cabin = (() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };

  function build(occupied) {
    const taken = new Set(occupied || []);
    let i = 0;  // orden de relleno: las sillas ocupadas aparecen una tras otra (20 ms)
    const seat = (id, cls) => {
      const node = el("span", cls);
      node.title = id;
      if (taken.has(id)) { node.classList.add("on"); node.style.setProperty("--i", i++); }
      return node;
    };

    const box = el("div", "cabin");
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", taken.size + " posiciones ocupadas en la cabina");
    const head = el("div", "cabin-head");
    head.append(el("span", "", "FRENTE"), el("span", "", "puerta a la derecha"));
    box.append(head);

    for (let n = 1; n <= 10; n++) {
      const r = String(n).padStart(2, "0");
      const row = el("div", "cabin-row");
      row.append(el("span", "n", r), seat("S" + r + "-L1", "seat"), seat("S" + r + "-L2", "seat"));
      if (n === 1 || n === 10) row.append(el("span", "door", "puerta"));
      else row.append(seat("P" + r, "stand"), seat("S" + r + "-R2", "seat"), seat("S" + r + "-R1", "seat"));
      if (n !== 1 && n !== 10) row.children[3].textContent = "P" + r;
      box.append(row);
    }
    const bench = el("div", "bench");
    bench.append(el("span", "n", "11"));
    for (let t = 1; t <= 5; t++) bench.append(seat("S11-T" + t, "seat"));
    box.append(bench);

    const legend = el("div", "cabin-legend");
    legend.innerHTML = '<span><i class="k-on"></i>Ocupada</span><span><i class="k-off"></i>Libre</span><span><i class="k-stand"></i>Sitio de pie</span>';
    box.append(legend);
    return box;
  }

  // Cada 3 s llega otra lista: solo cambian las sillas que cambiaron, así solo las nuevas se animan.
  function update(box, occupied) {
    const taken = new Set(occupied || []);
    let i = 0;
    box.querySelectorAll(".seat, .stand").forEach((node) => {
      const on = taken.has(node.title);
      if (on && !node.classList.contains("on")) node.style.setProperty("--i", i++);
      node.classList.toggle("on", on);
    });
    box.setAttribute("aria-label", taken.size + " posiciones ocupadas en la cabina");
  }

  return { build, update };
})();
