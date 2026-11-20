"use client";

/**
 * Game sound effects via the Web Audio API: sounds are decoded once and can
 * overlap with no latency (piece steps come as fast as every 80 ms).
 * Browsers only allow audio after the first click/tap/key press on the page,
 * so the AudioContext is resumed on the first user gesture.
 */
export const SOUNDS = {
  dice: "/sound/dice.wav",
  step: "/sound/piece-move.wav",
} as const;
export type SoundName = keyof typeof SOUNDS;

const MUTE_KEY = "rent-rush:muted";
const VOLUME: Record<SoundName, number> = { dice: 0.8, step: 0.5 };

let ctx: AudioContext | null = null;
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};
let loading: Promise<void> | null = null;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Creates the audio context and starts loading the sounds (call once on the client). */
export function initSound(): void {
  if (typeof window === "undefined" || ctx || !("AudioContext" in window)) return;
  ctx = new AudioContext();
  const unlock = () => {
    if (ctx?.state === "suspended") void ctx.resume();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(ev, unlock, { passive: true });
  }
  loading ??= Promise.all(
    (Object.keys(SOUNDS) as SoundName[]).map(async (name) => {
      try {
        const res = await fetch(SOUNDS[name]);
        if (!res.ok) return;
        buffers[name] = await ctx!.decodeAudioData(await res.arrayBuffer());
      } catch {
        // A missing or broken sound file just stays silent.
      }
    }),
  ).then(() => undefined);
}

export function playSound(name: SoundName, opts: { rate?: number; volume?: number } = {}): void {
  if (muted || !ctx) return;
  if (ctx.state === "suspended") {
    // The click that triggered this sound may be the one unlocking audio right now: play once it's
    // running, but only if that happens promptly (otherwise the sound would come out late).
    const asked = performance.now();
    void ctx.resume().then(() => {
      if (performance.now() - asked < 250) start(name, opts);
    });
    return;
  }
  start(name, opts);
}

function start(name: SoundName, opts: { rate?: number; volume?: number }): void {
  const buffer = buffers[name];
  if (!ctx || ctx.state !== "running" || muted || !buffer) return;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = VOLUME[name] * (opts.volume ?? 1);
  source.playbackRate.value = opts.rate ?? 1;
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.start();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Private mode etc.: the setting just isn't remembered.
  }
  listeners.forEach((fn) => fn(value));
}

export function onMutedChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
