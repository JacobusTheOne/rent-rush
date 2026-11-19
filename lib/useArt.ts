"use client";

import { useEffect, useState } from "react";

/** One probe per URL per page load, shared by every component. */
const probes = new Map<string, Promise<boolean>>();

function probe(src: string): Promise<boolean> {
  let p = probes.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
    probes.set(src, p);
  }
  return p;
}

/**
 * Which of these image URLs actually exist. Missing art falls back to the CSS look,
 * so art can be added one file at a time. Returns an empty set until probes finish.
 */
export function useAvailableArt(srcs: readonly string[]): Set<string> {
  const key = srcs.join("|");
  const [available, setAvailable] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let live = true;
    const list = key ? key.split("|") : [];
    Promise.all(list.map((s) => probe(s).then((ok) => (ok ? s : null)))).then((found) => {
      if (live) setAvailable(new Set(found.filter((s): s is string => s !== null)));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return available;
}
