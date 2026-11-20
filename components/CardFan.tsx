"use client";

import { useRef, useState } from "react";
import { BOARD, DISTRICTS, districtSquares } from "@/game/board";
import { type Action, type GameState, rentFor } from "@/game/engine";
import { DeedActions } from "./PlayerCards";

export interface FanItem {
  key: string;
  /** Board square of a street/station, or null for a Walk Free card. */
  square: number | null;
  /** Card artwork, or null to draw the built-in card face. */
  card: string | null;
}

/** hand: your big fan; row: an opponent's small horizontal fan; column: a vertical stack beside the board. */
export type FanVariant = "hand" | "row" | "column";

interface Props {
  state: GameState;
  owner: string;
  items: FanItem[];
  variant?: FanVariant;
  /** Extra class on the fan, e.g. which side of the table it's on. */
  className?: string;
  /** Owner's name, shown in the enlarged view of someone else's card. */
  ownerName?: string;
  canManage: boolean;
  canBuild: boolean;
  busy: boolean;
  onAction: (a: Action) => void;
}

const ZOOM_MS = 320;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Your hand: cards overlap in a slight fan. Hovering lifts and enlarges a card;
 * clicking flies it to the middle of the screen at full size, where the
 * Upgrade / Sell buttons are.
 */
export function CardFan({ state, owner, items, variant = "hand", className = "", ownerName, canManage, canBuild, busy, onAction }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const zoomed = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ item: FanItem; from: DOMRect } | null>(null);

  // Transform that puts the big card exactly over the small one it came from.
  const fromTransform = (from: DOMRect) => {
    const el = zoomed.current!;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${from.width / to.width})`;
  };

  const show = (item: FanItem, el: HTMLElement) => {
    const from = el.getBoundingClientRect();
    setOpen({ item, from });
    // Wait for React to render the big card, then animate it from the small card's spot.
    requestAnimationFrame(() => {
      dialog.current?.showModal();
      if (!zoomed.current || reducedMotion()) return;
      zoomed.current.animate([{ transform: fromTransform(from), opacity: 0.6 }, { transform: "none", opacity: 1 }], {
        duration: ZOOM_MS,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    });
  };

  const hide = () => {
    if (!open || !zoomed.current || reducedMotion()) {
      dialog.current?.close();
      return;
    }
    const anim = zoomed.current.animate([{ transform: "none" }, { transform: fromTransform(open.from), opacity: 0.4 }], {
      duration: ZOOM_MS * 0.8,
      easing: "cubic-bezier(0.4, 0, 0.8, 0.4)",
    });
    anim.onfinish = () => dialog.current?.close();
  };

  const n = items.length;
  return (
    <>
      <ul
        className={`fan ${variant} ${className}`}
        // One grid track per card: each card is bigger than its track, so it overlaps the next one.
        // Columns shrink when space is tight, so a big hand overlaps more instead of scrolling.
        // A vertical stack shows the top of each card (district band and name).
        style={
          variant === "column"
            ? { gridTemplateRows: n > 1 ? `repeat(${n - 1}, var(--step)) auto` : "auto" }
            : {
                gridTemplateColumns:
                  n > 1
                    ? `repeat(${n - 1}, minmax(0, ${variant === "row" ? "var(--step)" : `${n <= 4 ? 120 : 84}px`})) var(--card)`
                    : "var(--card)",
              }
        }
        aria-label={ownerName ? `${ownerName}'s cards` : "Your cards"}
      >
        {items.map((item, k) => {
          // Fan: tilt and drop the cards away from the middle of the hand.
          const offset = n > 1 ? k - (n - 1) / 2 : 0;
          const spread = variant === "column" ? 0 : variant === "row" ? 2 : n > 6 ? 2 : 3.5;
          const tilt = Math.max(-12, Math.min(12, offset * spread));
          const label = item.square === null ? "Walk Free card" : BOARD[item.square].name;
          const level = item.square === null ? 0 : (state.holdings[item.square]?.level ?? 0);
          return (
            <li
              key={item.key}
              className="fan-slot"
              style={{ "--tilt": `${tilt}deg`, "--drop": `${variant === "column" ? 0 : Math.abs(offset) ** 1.4 * (variant === "row" ? 1.5 : 3)}px`, "--z": k + 1 } as React.CSSProperties}
            >
              {/* The button is the mouse target and never moves: it stays where the small card is,
                  so an enlarged card can't cover (and steal the hover from) the cards next to it. */}
              <button
                type="button"
                className="fan-card"
                aria-label={`${label}: open card`}
                onClick={(e) => show(item, e.currentTarget)}
              />
              {/* What you see: lifts and enlarges on hover, but lets the mouse pass through. */}
              <span className="fan-visual" aria-hidden>
                <CardFace item={item} />
                {item.square !== null && state.holdings[item.square] && (
                  <span className="fan-badge">
                    {level > 0 && <span className="fan-pips">{"▲".repeat(level)}</span>}${rentFor(state, item.square)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <dialog
        ref={dialog}
        className="card-stage"
        onClose={() => setOpen(null)}
        onCancel={(e) => {
          e.preventDefault();
          hide();
        }}
        onClick={(e) => e.target === dialog.current && hide()}
      >
        {open && (
          <div ref={zoomed} className="stage-card">
            <CardFace item={open.item} large />
            <StageInfo
              state={state}
              owner={owner}
              ownerName={ownerName}
              item={open.item}
              canManage={canManage}
              canBuild={canBuild}
              busy={busy}
              onAction={(a) => {
                onAction(a);
                if (a.type === "SELL_PROPERTY") hide();
              }}
            />
            <button type="button" className="secondary" onClick={hide}>
              Close
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}

function CardFace({ item, large = false }: { item: FanItem; large?: boolean }) {
  if (item.card) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="card-face" src={item.card} alt="" loading={large ? "eager" : "lazy"} />;
  }
  // Built-in face for a missing image (or a Walk Free card).
  const sq = item.square === null ? null : BOARD[item.square];
  const color = !sq ? "#c9a227" : sq.kind === "PROPERTY" ? DISTRICTS[sq.district].color : "#56606a";
  const head = !sq ? "Fortune card" : sq.kind === "PROPERTY" ? DISTRICTS[sq.district].name : "Station";
  return (
    <span className={`card-face plain ${large ? "large" : ""}`}>
      <span className="plain-head" style={{ background: color }}>
        {head}
      </span>
      <strong>{sq ? sq.name : "Walk Free"}</strong>
      {!sq && <span className="small">Leave the Holding Cell for free.</span>}
      {sq && "price" in sq && <span className="small">Price ${sq.price}</span>}
    </span>
  );
}

function StageInfo({
  state,
  owner,
  ownerName,
  item,
  canManage,
  canBuild,
  busy,
  onAction,
}: {
  state: GameState;
  owner: string;
  ownerName?: string;
  item: FanItem;
  canManage: boolean;
  canBuild: boolean;
  busy: boolean;
  onAction: (a: Action) => void;
}) {
  if (item.square === null) {
    return (
      <p className="stage-info muted small">
        {ownerName ? `${ownerName} can use it to leave the Holding Cell for free.` : "Use it from your turn panel while you're in the Holding Cell."}
      </p>
    );
  }
  const square = item.square;
  const sq = BOARD[square];
  if (!state.holdings[square]) return <p className="stage-info muted small">{ownerName ? `${ownerName} no longer owns this card.` : "You no longer own this card."}</p>;
  const level = state.holdings[square].level;
  const district =
    sq.kind === "PROPERTY"
      ? `${districtSquares(sq.district).filter((i) => state.holdings[i]?.owner === owner).length}/${districtSquares(sq.district).length} of district`
      : null;
  return (
    <div className="stage-info">
      {ownerName && <div className="muted small">Owned by {ownerName}</div>}
      <div>
        Rent now <strong>${rentFor(state, square)}</strong>
        {level > 0 && <span className="muted"> · level {level}</span>}
        {district && <span className="muted"> · {district}</span>}
      </div>
      {canManage ? (
        <DeedActions state={state} square={square} owner={owner} canBuild={canBuild} busy={busy} onAction={onAction} />
      ) : ownerName ? null : (
        <span className="muted small">Upgrade or sell during your turn.</span>
      )}
    </div>
  );
}
