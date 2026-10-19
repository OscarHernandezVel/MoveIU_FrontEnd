"use client";

import { useEffect, useState } from "react";

type Choice = "auto" | "day" | "night" | "contrast";
const KEY = "moveiu_theme";
const OPTIONS: { value: Choice; label: string }[] = [
  { value: "auto", label: "Automático" },
  { value: "day", label: "Día" },
  { value: "night", label: "Noche (poco brillo)" },
  { value: "contrast", label: "Alto contraste" },
];

function apply(choice: Choice): void {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Tema de color: sigue al sistema por omisión; la elección se recuerda en este navegador (si se permite). */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("auto");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "day" || saved === "night" || saved === "contrast") setChoice(saved);
    } catch {
      /* almacenamiento bloqueado (modo privado): el tema solo dura esta visita */
    }
  }, []);

  return (
    <label className="theme-picker">
      <span className="muted">Tema</span>
      <select
        value={choice}
        onChange={(e) => {
          const next = e.target.value as Choice;
          setChoice(next);
          apply(next);
          try {
            if (next === "auto") localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, next);
          } catch {
            /* sin almacenamiento */
          }
        }}
        aria-label="Tema de color"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
