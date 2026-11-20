/** Each player's cash, by player id. */
export type Cash = Record<string, number>;

/** A payment between two players, or with the bank (null): taxes, fines, buying, passing Start. */
export interface Transfer {
  from: string | null;
  to: string | null;
  amount: number;
}

/**
 * Explains a change in everyone's cash as payments: whoever lost money pays whoever gained it
 * (e.g. rent, a trade); anything left over went to or came from the bank.
 */
export function transfersFor(before: Cash, after: Cash): Transfer[] {
  const ids = Object.keys(after);
  const losers = ids.filter((id) => (before[id] ?? after[id]) > after[id]).map((id) => ({ id, left: before[id] - after[id] }));
  const gainers = ids.filter((id) => (before[id] ?? after[id]) < after[id]).map((id) => ({ id, left: after[id] - before[id] }));
  const out: Transfer[] = [];
  for (const l of losers) {
    for (const g of gainers) {
      const amount = Math.min(l.left, g.left);
      if (amount <= 0) continue;
      out.push({ from: l.id, to: g.id, amount });
      l.left -= amount;
      g.left -= amount;
    }
  }
  for (const l of losers) if (l.left > 0) out.push({ from: l.id, to: null, amount: l.left });
  for (const g of gainers) if (g.left > 0) out.push({ from: null, to: g.id, amount: g.left });
  return out;
}

/** How many coins to throw for an amount: a few for small sums, at most ten. */
export function coinCount(amount: number): number {
  return Math.max(3, Math.min(10, Math.ceil(amount / 50)));
}
