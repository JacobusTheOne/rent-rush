import { util, extensions } from "@aws-appsync/utils";

// Subscription handlers must return a null payload on the request.
export function request() {
  return { payload: null };
}

/**
 * With a gameId argument, only that game's updates are delivered (knowing the id is the
 * invite). Without it (the lobby), only public games: a private table's id must never be
 * broadcast to everyone, or anyone could join it.
 */
export function response(ctx) {
  const filter = ctx.args.gameId ? { gameId: { eq: ctx.args.gameId } } : { isPrivate: { eq: false } };
  extensions.setSubscriptionFilter(util.transform.toSubscriptionFilter(filter));
  return null;
}
