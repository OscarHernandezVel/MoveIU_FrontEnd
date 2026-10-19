"use client";

import { create } from "zustand";
import { clamp01, neighbour, parseCatalog, type Repeat, type Track } from "./music.ts";

/** Reproductor interno: un único <audio> para toda la aplicación, independiente del módulo de ocupación. */
interface PlayerState {
  tracks: Track[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  repeat: Repeat;
  error: string | null;
  load(): Promise<void>;
  play(index?: number): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  setVolume(value: number): void;
  cycleRepeat(): void;
  stop(): void;
}

let audio: HTMLAudioElement | null = null;

function element(get: () => PlayerState, set: (patch: Partial<PlayerState>) => void): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = "none"; // no descarga nada hasta que la persona pulse reproducir
  el.addEventListener("timeupdate", () => set({ position: el.currentTime }));
  el.addEventListener("loadedmetadata", () => set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }));
  el.addEventListener("play", () => set({ playing: true, error: null }));
  el.addEventListener("pause", () => set({ playing: false }));
  el.addEventListener("error", () => set({ playing: false, error: "No se pudo reproducir esta pista." }));
  el.addEventListener("ended", () => {
    const { index, tracks, repeat } = get();
    const target = neighbour(index, tracks.length, 1, repeat);
    if (target === null) set({ playing: false, position: 0 });
    else get().play(target);
  });
  audio = el;
  return el;
}

function announce(track: Track | undefined, controls: Pick<PlayerState, "next" | "previous" | "toggle" | "seek">): void {
  // Controles de la pantalla de bloqueo y de los auriculares (Media Session); no todos los navegadores lo tienen.
  if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !track) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: "MoveIU" });
  navigator.mediaSession.setActionHandler("play", controls.toggle);
  navigator.mediaSession.setActionHandler("pause", controls.toggle);
  navigator.mediaSession.setActionHandler("nexttrack", controls.next);
  navigator.mediaSession.setActionHandler("previoustrack", controls.previous);
}

export const usePlayer = create<PlayerState>((set, get) => ({
  tracks: [],
  index: 0,
  playing: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  repeat: "all",
  error: null,

  async load() {
    if (get().tracks.length) return;
    try {
      const response = await fetch("/musica/catalogo.json", { cache: "force-cache" });
      if (!response.ok) throw new Error(String(response.status));
      set({ tracks: parseCatalog(await response.json()), error: null });
    } catch {
      set({ error: "No se pudo cargar el catálogo de música." });
    }
  },

  play(index) {
    const { tracks, volume } = get();
    const target = index ?? get().index;
    const track = tracks[target];
    if (!track) return;
    const el = element(get, set);
    if (target !== get().index || !el.src.endsWith(track.file)) {
      el.src = track.file;
      set({ index: target, position: 0, duration: track.seconds });
    }
    el.volume = volume;
    announce(track, get());
    // play() devuelve una promesa que se rechaza si el navegador exige un gesto del usuario.
    void el.play().catch(() => set({ playing: false, error: "Pulse reproducir para iniciar el audio." }));
  },

  toggle() {
    const el = element(get, set);
    if (!el.src) get().play();
    else if (el.paused) void el.play().catch(() => set({ playing: false }));
    else el.pause();
  },

  next() {
    const { index, tracks, repeat } = get();
    const target = neighbour(index, tracks.length, 1, repeat === "one" ? "all" : repeat);
    if (target !== null) get().play(target);
  },

  previous() {
    const { index, tracks, repeat, position } = get();
    if (position > 3) return get().seek(0); // como en cualquier reproductor: primero vuelve al inicio
    const target = neighbour(index, tracks.length, -1, repeat === "one" ? "all" : repeat);
    if (target !== null) get().play(target);
  },

  seek(seconds) {
    const el = element(get, set);
    el.currentTime = Math.max(0, Math.min(seconds, get().duration || seconds));
  },

  setVolume(value) {
    const volume = clamp01(value);
    if (audio) audio.volume = volume;
    set({ volume });
  },

  cycleRepeat() {
    const order: Repeat[] = ["off", "all", "one"];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
  },

  stop() {
    audio?.pause();
    if (audio) audio.removeAttribute("src");
    set({ playing: false, position: 0 });
  },
}));
