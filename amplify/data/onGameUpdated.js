import { util, extensions } from "@aws-appsync/utils";

// Subscription handlers must return a null payload on the request.
export function request() {
  return { payload: null };
}

/** With a gameId argument, only that game's updates are delivered; without it, all of them. */
export function response(ctx) {
  if (ctx.args.gameId) {
    extensions.setSubscriptionFilter(
      util.transform.toSubscriptionFilter({ gameId: { eq: ctx.args.gameId } }),
    );
  }
  return null;
}
