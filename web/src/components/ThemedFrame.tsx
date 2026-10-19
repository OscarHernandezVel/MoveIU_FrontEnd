"use client";

import { useEffect, useRef } from "react";

/** Mapea el tema de MoveIU al de la página 3D (que usa `light` / `dark`). */
function frameTheme(): "light" | "dark" | null {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "day" ? "light" : t === "night" || t === "contrast" ? "dark" : null;
}

/** iframe de la vista 3D que sigue el tema elegido en MoveIU (misma procedencia, así que se puede). */
export function ThemedFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const push = () => {
      try {
        const root = ref.current?.contentDocument?.documentElement;
        if (!root) return;
        const theme = frameTheme();
        if (theme) root.setAttribute("data-theme", theme);
        else root.removeAttribute("data-theme");
      } catch {
        /* otro origen: la página 3D seguirá al sistema */
      }
    };
    const frame = ref.current;
    frame?.addEventListener("load", push);
    const observer = new MutationObserver(push);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    push();
    return () => {
      frame?.removeEventListener("load", push);
      observer.disconnect();
    };
  }, []);
  return <iframe ref={ref} className="frame" title={title} src={src} loading="lazy" />;
}
