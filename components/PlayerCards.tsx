"use client";

import { useEffect, useRef, useState } from "react";
import { BOARD, DISTRICTS, RULES, STATION_INDEXES, baseRent, districtSquares, upgradeCost } from "@/game/board";
import { SQUARE_ART, TOKEN_ART } from "@/game/art";
import {
  type Action,
  type GameState,
  canSellProperty,
  canUpgrade,
  ownedBy,
  ownsDistrict,
  rentFor,
} from "@/game/engine";
import { useAvailableArt } from "@/lib/useArt";
import { Token } from "./Token";

const ART_SRCS = [...SQUARE_ART, ...TOKEN_ART].map((a) => a.src);

interface Props {
  state: GameState;
  me: string;
  busy: boolean;
  myTurn: boolean;
  onAction: (a: Action) => void;
}

/**
 * "Cards" section: every property a player owns shown as a title-deed card
 * (rent table with the current rent highlighted, upgrade cost, sell value),
 * plus Walk Free cards. Tabs switch between players; only your own cards
 * have Upgrade/Sell buttons.
 */
export function PlayerCards({ state, me, busy, myTurn, onAction }: Props) {
  const inGame = state.players.some((p) => p.id === me);
  const [viewing, setViewing] = useState<string>(inGame ? me : state.players[0].id);
  // If the viewed player disappears (shouldn't happen), fall back.
  useEffect(() => {
    if (!state.players.some((p) => p.id === viewing)) setViewing(state.players[0].id);
  }, [state.players, viewing]);

  const art = useAvailableArt(ART_SRCS);
  const player = state.players.find((p) => p.id === viewing)!;
  const owned = ownedBy(state, player.id);
  const mine = player.id === me;
  const canManage = mine && myTurn && state.phase !== "BUY" && !player.bankrupt;
  const canBuild = mine && myTurn && (state.phase === "ROLL" || state.phase === "END");
  const districts = new Set(
    owned.flatMap((i) => {
      const sq = BOARD[i];
      return sq.kind === "PROPERTY" && ownsDistrict(state, player.id, i) ? [sq.district] : [];
    }),
  );

  return (
    <div className="panel cards-panel">
      <h3>Cards</h3>
      <div className="card-tabs" role="tablist" aria-label="Whose cards">
        {state.players.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === viewing}
            className={`card-tab ${p.id === viewing ? "selected" : ""}`}
            onClick={() => setViewing(p.id)}
          >
            <Token index={p.token} art={art} />
            {p.id === me ? "You" : p.name}
            <span className="count">{ownedBy(state, p.id).length + p.freeCards}</span>
          </button>
        ))}
      </div>

      <p className="muted small cards-summary">
        {player.bankrupt
          ? `${player.name} is out of the game.`
          : `${owned.length} ${owned.length === 1 ? "property" : "properties"}` +
            (districts.size ? ` · ${districts.size} full ${districts.size === 1 ? "district" : "districts"}` : "") +
            (player.freeCards ? ` · ${player.freeCards} Walk Free` : "")}
      </p>

      {owned.length === 0 && player.freeCards === 0 ? (
        <p className="muted small">
          {mine ? "No cards yet. Land on an unowned street or station to buy it." : "No cards yet."}
        </p>
      ) : (
        <ul className="deeds">
          {owned.map((i) => (
            <Deed
              key={i}
              state={state}
              square={i}
              owner={player.id}
              image={art.has(SQUARE_ART[i].src) ? SQUARE_ART[i].src : null}
              canManage={canManage}
              canBuild={canBuild}
              busy={busy}
              onAction={onAction}
            />
          ))}
          {Array.from({ length: player.freeCards }, (_, k) => (
            <li key={`free-${k}`} className="deed walk-free">
              <div className="deed-head" style={{ background: "#c9a227" }}>
                <span>Fortune card</span>
              </div>
              <div className="deed-body">
                <strong>Walk Free</strong>
                <p className="small">Leave the Holding Cell for free. {mine ? "Use it from your turn panel." : ""}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canBuild && owned.length > 0 && (
        <p className="muted small">Own every street in a district to double rent and unlock upgrades (▲).</p>
      )}
    </div>
  );
}

export function Deed({
  state,
  square,
  owner,
  image,
  card = null,
  canManage,
  canBuild,
  busy,
  onAction,
}: {
  state: GameState;
  square: number;
  owner: string;
  image: string | null;
  /** Full title-deed artwork (public/board/deeds); replaces the built-in card when present. */
  card?: string | null;
  canManage: boolean;
  canBuild: boolean;
  busy: boolean;
  onAction: (a: Action) => void;
}) {
  const sq = BOARD[square];
  if (sq.kind !== "PROPERTY" && sq.kind !== "STATION") return null;
  const level = state.holdings[square].level;
  const current = rentFor(state, square);
  const head =
    sq.kind === "PROPERTY"
      ? { color: DISTRICTS[sq.district].color, label: DISTRICTS[sq.district].name }
      : { color: "#56606a", label: "Station" };

  // Rent table rows: [label, amount, isCurrent]
  let rows: [string, number, boolean][];
  if (sq.kind === "PROPERTY") {
    const base = baseRent(sq);
    const full = ownsDistrict(state, owner, square);
    rows = [
      ["Rent", base, level === 0 && !full],
      ["Full district", base * 2, level === 0 && full],
      ...[1, 2, 3].map((n): [string, number, boolean] => [`▲${n}`, base * RULES.levelMultipliers[n], level === n]),
    ];
  } else {
    const count = STATION_INDEXES.filter((i) => state.holdings[i]?.owner === owner).length;
    rows = [1, 2, 3].map((n): [string, number, boolean] => [
      `${n} station${n > 1 ? "s" : ""}`,
      RULES.stationBaseRent * 2 ** (n - 1),
      n === count,
    ]);
  }

  const districtNote =
    sq.kind === "PROPERTY"
      ? `${districtSquares(sq.district).filter((i) => state.holdings[i]?.owner === owner).length}/${districtSquares(sq.district).length} of district`
      : null;

  if (card) {
    return (
      <DeedCard
        name={sq.name}
        card={card}
        level={level}
        current={current}
        districtNote={districtNote}
        actions={
          canManage ? (
            <DeedActions state={state} square={square} owner={owner} canBuild={canBuild} busy={busy} onAction={onAction} />
          ) : null
        }
      />
    );
  }

  return (
    <li className="deed">
      <div className="deed-head" style={{ background: head.color }}>
        <span>{head.label}</span>
        {level > 0 && <span className="pips">{"▲".repeat(level)}</span>}
      </div>
      {image && <div className="deed-art" style={{ backgroundImage: `url("${image}")` }} aria-hidden />}
      <div className="deed-body">
        <strong>{sq.name}</strong>
        <table className="rent-table">
          <tbody>
            {rows.map(([label, amount, isCurrent]) => (
              <tr key={label} className={isCurrent ? "current" : ""}>
                <td>{label}</td>
                <td>${amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="deed-foot muted small">
          {districtNote && <span>{districtNote}</span>}
          {sq.kind === "PROPERTY" && <span>Upgrade ${upgradeCost(sq)}</span>}
          <span>Sells for ${sq.price * RULES.sellBackRate}</span>
        </div>
        <div className="deed-rent" aria-label={`Current rent ${current}`}>
          Rent now <strong>${current}</strong>
        </div>
        {canManage && (
          <DeedActions state={state} square={square} owner={owner} canBuild={canBuild} busy={busy} onAction={onAction} />
        )}
      </div>
    </li>
  );
}

export function DeedActions({
  state,
  square,
  owner,
  canBuild,
  busy,
  onAction,
}: {
  state: GameState;
  square: number;
  owner: string;
  canBuild: boolean;
  busy: boolean;
  onAction: (a: Action) => void;
}) {
  const sq = BOARD[square];
  if (sq.kind !== "PROPERTY" && sq.kind !== "STATION") return null;
  const level = state.holdings[square].level;
  return (
    <div className="deed-actions">
            {sq.kind === "PROPERTY" && canBuild && !canUpgrade(state, owner, square) && (
              <button
                type="button"
                className="tiny"
                disabled={busy}
                onClick={() => onAction({ type: "UPGRADE", square })}
              >
                ▲ ${upgradeCost(sq)}
              </button>
            )}
            {sq.kind === "PROPERTY" && level > 0 && (
              <button
                type="button"
                className="tiny secondary"
                disabled={busy}
                onClick={() => onAction({ type: "SELL_UPGRADE", square })}
              >
                ▼ +${upgradeCost(sq) * RULES.sellBackRate}
              </button>
            )}
            {!canSellProperty(state, owner, square) && (
              <button
                type="button"
                className="tiny secondary"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Sell ${sq.name} back to the bank for $${sq.price * RULES.sellBackRate}?`)) {
                    onAction({ type: "SELL_PROPERTY", square });
                  }
                }}
              >
                Sell
              </button>
            )}
          </div>
  );
}

/** A title deed shown as its card artwork, with the live rent and actions underneath. Click to enlarge. */
function DeedCard({
  name,
  card,
  level,
  current,
  districtNote,
  actions,
}: {
  name: string;
  card: string;
  level: number;
  current: number;
  districtNote: string | null;
  actions: React.ReactNode;
}) {
  const zoom = useRef<HTMLDialogElement>(null);
  return (
    <li className="deed has-card">
      <button type="button" className="deed-card" onClick={() => zoom.current?.showModal()} title={`${name}: click to enlarge`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card} alt={`${name} title deed`} loading="lazy" />
        {level > 0 && <span className="deed-level">{"▲".repeat(level)}</span>}
      </button>
      <div className="deed-live">
        <div className="deed-rent">
          Rent now <strong>${current}</strong>
          {districtNote && <span className="muted small"> · {districtNote}</span>}
        </div>
        {actions}
      </div>
      <dialog
        ref={zoom}
        className="card-zoom"
        onClick={(e) => e.target === zoom.current && zoom.current.close()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card} alt={`${name} title deed`} />
        <button type="button" className="secondary" onClick={() => zoom.current?.close()}>
          Close
        </button>
      </dialog>
    </li>
  );
}
