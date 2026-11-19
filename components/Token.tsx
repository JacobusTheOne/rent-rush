"use client";

import { TOKEN_COLORS } from "@/game/board";
import { TOKEN_ART } from "@/game/art";

/** A player's token: their token image if present (cropped to a circle), else a coloured dot. */
export function Token({
  index,
  name,
  art,
  active = false,
}: {
  index: number;
  name?: string;
  art: Set<string>;
  /** Highlight as the player whose turn it is. */
  active?: boolean;
}) {
  const src = TOKEN_ART[index]?.src;
  const hasArt = !!src && art.has(src);
  return (
    <span
      className={`token ${hasArt ? "has-art" : ""} ${active ? "active" : ""}`}
      style={{
        // backgroundColor, not the `background` shorthand: the shorthand would reset
        // background-size and the image would show at natural size (only a corner visible).
        backgroundColor: TOKEN_COLORS[index],
        // Ring colour comes from CSS via --player so states like .active can override it.
        ["--player" as string]: TOKEN_COLORS[index],
        ...(hasArt ? { backgroundImage: `url("${src}")` } : {}),
      }}
      title={name}
      aria-label={name}
    />
  );
}
