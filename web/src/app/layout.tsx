import type { Metadata, Viewport } from "next";
import { MiniPlayerLoader } from "@/components/MiniPlayerLoader";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoveIU",
  description: "Capacidad neta de los buses urbanos en tiempo real.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f3" },
    { media: "(prefers-color-scheme: dark)", color: "#080c11" },
  ],
};

/** Aplica el tema guardado antes de pintar, para que no haya un destello claro en pantallas oscuras. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("moveiu_theme");if(t==="day"||t==="night"||t==="contrast")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <MiniPlayerLoader />
      </body>
    </html>
  );
}
