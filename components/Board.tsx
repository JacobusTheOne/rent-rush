"use client";

import { BOARD, DISTRICTS, TOKEN_COLORS, gridPosition, isOwnable, roundProgress } from "@/game/board";
import { ALL_ART, BACKGROUND_ART, CARD_ART, CENTER_ART, DIE_ART, SQUARE_ART } from "@/game/art";
import { rentFor, type GameState } from "@/game/engine";
import { useAvailableArt } from "@/lib/useArt";
import type { BoardView } from "@/lib/useBoardAnimation";
import { Token } from "./Token";

const ALL_SRCS = ALL_ART.map((a) => a.src);
const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const ICON: Partial<Record<string, string>> = {
  START: "➜",
  CELL: "▦",
  REST: "★",
  GO_TO_CELL: "⚠",
  FORTUNE: "?",
  TAX: "$",
  STATION: "🚉",
};

/** CSS background for an image that exists, otherwise nothing (CSS fallback look). */
function bg(art: Set<string>, src: string): React.CSSProperties | undefined {
  return art.has(src) ? { backgroundImage: `url("${src}")` } : undefined;
}

/** view: what to show while animating (lib/useBoardAnimation); omitted = the state as-is. */
export function Board({
  state,
  view,
  children,
  hud = true,
}: {
  state: GameState;
  view?: BoardView;
  children?: React.ReactNode;
  /** false: leave the centre empty (the game screen draws its HUD in a layer that doesn't zoom). */
  hud?: boolean;
}) {
  const art = useAvailableArt(ALL_SRCS);
  const current = state.players[state.current];
  const hasCenter = art.has(CENTER_ART.src);
  const posOf = (id: string, fallback: number) => view?.positions[id] ?? fallback;
  return (
    <div
      className={`board ${art.has(BACKGROUND_ART.src) ? "has-art" : ""}`}
      style={bg(art, BACKGROUND_ART.src)}
      role="grid"
      aria-label="Game board"
    >
      {BOARD.map((sq, i) => {
        const { row, col } = gridPosition(i);
        const squareSrc = SQUARE_ART[i].src;
        const hasArt = art.has(squareSrc);
        const holding = state.holdings[i];
        const owner = holding ? state.players.find((p) => p.id === holding.owner) : undefined;
        const here = state.players.filter((p) => !p.bankrupt && posOf(p.id, p.position) === i);
        const corner = i % 6 === 0;
        const title = [
          sq.name,
          isOwnable(sq) ? `Price $${sq.price}` : null,
          sq.kind === "TAX" ? `Pay $${sq.amount}` : null,
          owner ? `Owner: ${owner.name}${holding.level ? `, level ${holding.level}` : ""}, rent $${rentFor(state, i)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            key={i}
            className={`square ${corner ? "corner" : ""} ${hasArt ? "has-art" : ""} ${current && posOf(current.id, current.position) === i ? "active" : ""}`}
            style={{
              gridRow: row,
              gridColumn: col,
              borderColor: owner ? TOKEN_COLORS[owner.token] : undefined,
              ...bg(art, squareSrc),
            }}
            title={title}
            aria-label={title}
          >
            {/* With artwork, the image carries the name/price; the game only overlays live info. */}
            {!hasArt && (
              <>
                {sq.kind === "PROPERTY" && <div className="strip" style={{ background: DISTRICTS[sq.district].color }} />}
                <div className="sq-name">
                  {ICON[sq.kind] && <span className="sq-icon">{ICON[sq.kind]}</span>}
                  {sq.name}
                </div>
                {isOwnable(sq) && !owner && <div className="sq-price">${sq.price}</div>}
              </>
            )}
            {owner && (
              <div className="sq-owner" style={{ color: TOKEN_COLORS[owner.token] }}>
                ●{holding.level > 0 && <span className="pips">{"▲".repeat(holding.level)}</span>}
              </div>
            )}
            {here.length > 0 && (
              <div className={`tokens count-${here.length}`}>
                {here.map((p) => (
                  <Token
                    key={p.id}
                    index={p.token} icon={p.icon}
                    name={p.name}
                    art={art}
                    active={p.id === current?.id && state.phase !== "OVER"}
                    hopping={p.id === view?.moving}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className={`board-center ${hasCenter ? "has-art" : ""}`} style={bg(art, CENTER_ART.src)}>
        {!hasCenter && <div className="board-title">RENT RUSH</div>}
        {/* With centre art, this becomes a panel at the bottom so the artwork's middle stays visible. */}
        {hud && (
          <CenterHud state={state} view={view}>
            {children}
          </CenterHud>
        )}
      </div>
    </div>
  );
}

/** Round, dice, Jackpot and the last Fortune card; `children` adds e.g. the turn controls. */
export function CenterHud({
  state,
  view,
  children,
  showDice = true,
  className = "",
}: {
  state: GameState;
  view?: BoardView;
  children?: React.ReactNode;
  /** false when the 3D dice cup shows the dice instead. */
  showDice?: boolean;
  className?: string;
}) {
  const art = useAvailableArt(ALL_SRCS);
  const dice = view ? view.dice : state.dice;
  const diceArt = dice?.every((d) => art.has(DIE_ART[d - 1].src));
  return (
    <div className={`center-hud ${className}`}>
        <div className="center-info muted small">
          {roundProgress(state.round, state.maxRounds)}
        </div>
        {showDice && dice && (
          <div
            className={`dice ${view?.rolling ? "rolling" : ""}`}
            aria-label={view?.rolling ? "Rolling dice" : `Dice: ${dice[0]} and ${dice[1]}`}
          >
            {diceArt ? (
              dice.map((d, k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={k} className="die-img" src={DIE_ART[d - 1].src} alt="" />
              ))
            ) : (
              <>
                <span className="die-glyph">{DICE[dice[0]]}</span> <span className="die-glyph">{DICE[dice[1]]}</span>
              </>
            )}
          </div>
        )}
        <div className="jackpot">
          ★ Jackpot <strong>${state.jackpot}</strong>
        </div>
        {state.lastCard && (
          <div className={`card ${art.has(CARD_ART.src) ? "has-art" : ""}`} style={bg(art, CARD_ART.src)}>
            <span>Fortune: {state.lastCard}</span>
          </div>
        )}
        {/* Extra centre content, e.g. the turn controls on wide screens. */}
        {children && <div className="hud-slot">{children}</div>}
        </div>
  );
}
