"use client";

import { TOKEN_ICONS } from "@/game/board";
import { TOKEN_ART } from "@/game/art";
import type { Game } from "@/lib/api";
import { useAvailableArt } from "@/lib/useArt";
import { Token } from "./Token";

const ICON_SRCS = TOKEN_ART.map((a) => a.src);

/** A player's animal next to their name in the waiting room. */
export function SeatIcon({ seat, icon }: { seat: number; icon?: number | null }) {
  const art = useAvailableArt(ICON_SRCS);
  return <Token index={seat} icon={icon} art={art} name={icon != null ? TOKEN_ICONS[icon] : undefined} />;
}

/**
 * Before the game starts: pick your animal. Each animal can be taken by one player; taken ones
 * show who has them.
 */
export function IconPicker({ game, me, busy, onPick }: { game: Game; me: string; busy: boolean; onPick: (icon: number) => void }) {
  const art = useAvailableArt(ICON_SRCS);
  const mine = game.players.find((p) => p.id === me)?.icon ?? null;
  return (
    <section className="icon-picker" aria-label="Choose your token">
      <h3>Choose your token</h3>
      <div className="icon-grid" role="radiogroup" aria-label="Tokens">
        {TOKEN_ICONS.map((name, i) => {
          const owner = game.players.find((p) => p.id !== me && p.icon === i);
          const chosen = mine === i;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={chosen}
              className={`icon-choice ${chosen ? "chosen" : ""} ${owner ? "taken" : ""}`}
              disabled={busy || !!owner}
              title={owner ? `${owner.name} has the ${name}` : chosen ? `Your token: ${name}` : `Choose the ${name}`}
              onClick={() => !chosen && onPick(i)}
            >
              <span className="icon-art">
                {art.has(TOKEN_ART[i].src) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={TOKEN_ART[i].src} alt="" />
                ) : (
                  <span className="icon-fallback">{name[0]}</span>
                )}
              </span>
              <span className="icon-name">{name}</span>
              {owner && <span className="icon-owner">{owner.name}</span>}
              {chosen && <span className="icon-owner you">You</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
