/**
 * Paso «Cómo lo sabe MoveIU»: de las cámaras del bus a la pantalla. Es HTML y no un dibujo escalado, para que el texto
 * mantenga su tamaño en el celular (en vertical) y se acomode en fila en pantallas anchas.
 */
const NODES = [
  { name: "Cámaras del bus", note: "Ven la cabina." },
  { name: "Equipo a bordo", note: "Cuenta las posiciones ocupadas y descarta la imagen.", accent: true },
  { name: "Servidor (Back)", note: "Guarda solo conteos e identificadores de posición." },
  { name: "MoveIU en su celular", note: "Dibuja el plano con sillas ocupadas y libres." },
];
const LINKS = ["imagen (no sale del bus)", "ids: S02-L1, P04…", "conteos y plano"];

export function TourFlow() {
  return (
    <ol className="flow-list" aria-label="Recorrido de los datos, de las cámaras a su celular">
      {NODES.flatMap((n, i) => [
        <li key={n.name} className={n.accent ? "flow-node accent" : "flow-node"}>
          <strong>{n.name}</strong>
          <span className="muted">{n.note}</span>
        </li>,
        i < LINKS.length ? (
          <li key={`l${i}`} className="flow-link" aria-hidden="true">
            <span className="down">↓</span>
            <span className="right">→</span> {LINKS[i]}
          </li>
        ) : null,
      ])}
    </ol>
  );
}
