"use client";

import { TOKEN_COLORS } from "@/game/board";
import { TOKEN_ART } from "@/game/art";

/** A player's token: their token image if present (cropped to a circle), else a coloured dot. */
export function Token({ index, name, art }: { index: number; name?: string; art: Set<string> }) {
  const src = TOKEN_ART[index]?.src;
  const hasArt = !!src && art.has(src);
  return (
    <span
      className={`token ${hasArt ? "has-art" : ""}`}
      style={{
        background: TOKEN_COLORS[index],
        ...(hasArt ? { backgroundImage: `url("${src}")`, borderColor: TOKEN_COLORS[index] } : {}),
      }}
      title={name}
      aria-label={name}
    />
  );
}
