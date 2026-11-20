"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BOARD, DISTRICTS, districtSquares } from "@/game/board";
import { type Action, type GameState, type Trade, type TradeSide, ownedBy, tradeProblem } from "@/game/engine";

/** Colour band for a card chip: the district colour, or grey for stations. */
function chipColor(square: number): string {
  const sq = BOARD[square];
  return sq.kind === "PROPERTY" ? DISTRICTS[sq.district].color : "#56606a";
}

function hasUpgrades(s: GameState, square: number): boolean {
  const sq = BOARD[square];
  return sq.kind === "PROPERTY" && districtSquares(sq.district).some((i) => (s.holdings[i]?.level ?? 0) > 0);
}

function CardChips({ squares }: { squares: number[] }) {
  return (
    <>
      {squares.map((sq) => (
        <span key={sq} className="trade-chip" style={{ "--chip": chipColor(sq) } as React.CSSProperties}>
          {BOARD[sq].name}
        </span>
      ))}
    </>
  );
}

function SideSummary({ side }: { side: TradeSide }) {
  return (
    <span className="trade-side-summary">
      <CardChips squares={side.squares} />
      {side.cash > 0 && <span className="trade-cash">${side.cash}</span>}
    </span>
  );
}

/**
 * Make a trade offer: pick a player, the cards and cash you give, and the cards and cash
 * you want from them. The rules are checked live (and again by the server).
 */
export function TradeDialog({
  state,
  me,
  open,
  busy,
  error,
  onClose,
  onSend,
}: {
  state: GameState;
  me: string;
  open: boolean;
  busy: boolean;
  /** The last server error (e.g. a refused offer), shown once an offer has been sent. */
  error: string | null;
  onClose: () => void;
  onSend: (a: Action) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const partners = state.players.filter((p) => p.id !== me && !p.bankrupt);
  const [partnerId, setPartnerId] = useState<string>(partners[0]?.id ?? "");
  const [give, setGive] = useState<number[]>([]);
  const [get, setGet] = useState<number[]>([]);
  const [giveCash, setGiveCash] = useState(0);
  const [getCash, setGetCash] = useState(0);
  // The last offer sent from this window: its result shows here until the player closes the window.
  const [sent, setSent] = useState<{ afterLog: number; to: string; bot: boolean } | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Start fresh each time the window opens.
  useEffect(() => {
    if (!open) return;
    setGive([]);
    setGet([]);
    setGiveCash(0);
    setGetCash(0);
    setSent(null);
    if (!partners.some((p) => p.id === partnerId)) setPartnerId(partners[0]?.id ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const meP = state.players.find((p) => p.id === me);
  const partner = partners.find((p) => p.id === partnerId);
  const giveSide = { squares: give, cash: giveCash };
  const getSide = { squares: get, cash: getCash };
  const problem = useMemo(
    () => (partner ? tradeProblem(state, me, partner.id, giveSide, getSide) : "Nobody to trade with"),
    [state, me, partner, give, get, giveCash, getCash], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const empty = give.length + giveCash === 0 && get.length + getCash === 0;

  const toggle = (list: number[], set: (v: number[]) => void, sq: number) =>
    set(list.includes(sq) ? list.filter((x) => x !== sq) : [...list, sq]);

  const column = (ownerId: string, picked: number[], set: (v: number[]) => void, cash: number, setCash: (n: number) => void, maxCash: number, title: string) => {
    const cards = ownedBy(state, ownerId);
    return (
      <div className="trade-column">
        <h4>{title}</h4>
        {cards.length === 0 ? (
          <p className="muted small">No cards.</p>
        ) : (
          <ul className="trade-cards">
            {cards.map((sq) => {
              const locked = hasUpgrades(state, sq);
              return (
                <li key={sq}>
                  <label className={`trade-pick ${picked.includes(sq) ? "picked" : ""} ${locked ? "locked" : ""}`} title={locked ? "Its district has upgrades: sell them before trading" : undefined}>
                    <input type="checkbox" checked={picked.includes(sq)} disabled={locked} onChange={() => toggle(picked, set, sq)} />
                    <span className="trade-chip" style={{ "--chip": chipColor(sq) } as React.CSSProperties}>
                      {BOARD[sq].name}
                    </span>
                    <span className="muted small">${(BOARD[sq] as { price: number }).price}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <label className="trade-cash-input">
          Cash
          <span>
            $
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={maxCash}
              step={10}
              value={cash || ""}
              placeholder="0"
              onChange={(e) => setCash(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
          </span>
          <span className="muted small">has ${maxCash}</span>
        </label>
      </div>
    );
  };

  return (
    <dialog ref={dialog} className="trade-dialog" onClose={onClose} onCancel={onClose}>
      <h3>🤝 Propose a trade</h3>
      {partners.length === 0 ? (
        <p className="muted">There's nobody left to trade with.</p>
      ) : (
        <>
          <div className="trade-partners" role="radiogroup" aria-label="Trade with">
            {partners.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === partnerId}
                className={p.id === partnerId ? "" : "secondary"}
                onClick={() => {
                  setPartnerId(p.id);
                  setGet([]);
                  setGetCash(0);
                  setSent(null);
                }}
              >
                {p.bot ? "🤖 " : ""}
                {p.name}
              </button>
            ))}
          </div>
          {partner && meP && (
            <div className="trade-columns">
              {column(me, give, setGive, giveCash, setGiveCash, meP.cash, "You give")}
              <div className="trade-arrow" aria-hidden>
                ⇄
              </div>
              {column(partner.id, get, setGet, getCash, setGetCash, partner.cash, `You get from ${partner.name}`)}
            </div>
          )}
          {partner?.bot && (
            <p className="muted small">
              Bots answer straight away. They won&apos;t trade cards while they can still complete a district by buying
              from the bank; after that they take deals worth at least 10% more to them, and never break up a full district.
            </p>
          )}
          {!empty && problem && <p className="error small">{problem}</p>}
          {sent && <TradeResult state={state} sent={sent} busy={busy} error={error} />}
        </>
      )}
      <div className="row">
        <button
          type="button"
          disabled={busy || !!problem || !partner}
          onClick={() => {
            if (!partner) return;
            setSent({ afterLog: state.log.at(-1)?.n ?? 0, to: partner.id, bot: !!partner.bot });
            onSend({ type: "PROPOSE_TRADE", to: partner.id, give: giveSide, get: getSide });
            // Fresh picks for the next offer; the window stays open to show the answer.
            setGive([]);
            setGet([]);
            setGiveCash(0);
            setGetCash(0);
          }}
        >
          Send offer
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** What happened to the offer just sent: a bot's answer (with its reason), or "waiting" for a person. */
function TradeResult({
  state,
  sent,
  busy,
  error,
}: {
  state: GameState;
  sent: { afterLog: number; to: string; bot: boolean };
  busy: boolean;
  error: string | null;
}) {
  const name = state.players.find((p) => p.id === sent.to)?.name ?? "They";
  const news = state.log.filter((e) => e.n > sent.afterLog).map((e) => e.text);
  const done = news.find((t) => t.startsWith("Trade done"));
  const refused = news.find((t) => t.includes("turned the trade down"));
  const offered = news.some((t) => t.includes("offered") && t.includes("a trade"));
  let body: React.ReactNode;
  let tone = "";
  if (done) {
    body = <>✅ {name} accepted. {done}</>;
    tone = "ok";
  } else if (refused) {
    const why = refused.split("turned the trade down:")[1]?.trim().replace(/\.$/, "");
    body = (
      <>
        ❌ <strong>{name}</strong> turned it down{why ? <>: {why}.</> : "."}
      </>
    );
    tone = "no";
  } else if (offered && !sent.bot) {
    body = <>📨 Offer sent. {name} can accept or decline it until your turn ends.</>;
  } else if (error) {
    body = <>⚠️ {error}</>;
    tone = "no";
  } else if (busy) {
    body = <span className="muted">Sending…</span>;
  } else {
    return null;
  }
  return (
    <p className={`trade-result ${tone}`} role="status" aria-live="polite">
      {body}
    </p>
  );
}

/** Open offers to and from you, with Accept / Decline / Cancel. */
export function TradeOffers({
  state,
  me,
  busy,
  onAction,
}: {
  state: GameState;
  me: string;
  busy: boolean;
  onAction: (a: Action) => void;
}) {
  const trades = (state.trades ?? []).filter((t) => t.from === me || t.to === me);
  if (trades.length === 0) return null;
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? "?";
  return (
    <section className="panel trade-offers" aria-label="Trade offers">
      {trades.map((t: Trade) => {
        const incoming = t.to === me;
        const problem = tradeProblem(state, t.from, t.to, t.give, t.get);
        return (
          <div key={t.id} className={`trade-offer ${incoming ? "incoming" : "outgoing"}`}>
            <div className="trade-offer-text">
              {incoming ? (
                <>
                  <strong>{name(t.from)}</strong> offers <SideSummary side={t.give} /> for your <SideSummary side={t.get} />
                </>
              ) : (
                <>
                  You offered <strong>{name(t.to)}</strong> <SideSummary side={t.give} /> for <SideSummary side={t.get} />
                  <span className="muted small"> · waiting for an answer (open until your turn ends)</span>
                </>
              )}
              {problem && <div className="error small">Can't go through right now: {problem}</div>}
            </div>
            <div className="row">
              {incoming ? (
                <>
                  <button type="button" disabled={busy || !!problem} onClick={() => onAction({ type: "ACCEPT_TRADE", id: t.id })}>
                    Accept
                  </button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => onAction({ type: "DECLINE_TRADE", id: t.id })}>
                    Decline
                  </button>
                </>
              ) : (
                <button type="button" className="secondary" disabled={busy} onClick={() => onAction({ type: "CANCEL_TRADE", id: t.id })}>
                  Cancel offer
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
