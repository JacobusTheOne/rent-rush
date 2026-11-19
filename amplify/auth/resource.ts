import { defineAuth } from "@aws-amplify/backend";

/**
 * Email + password sign-in. A public player name (preferred_username) is
 * required at sign-up so other players never see email addresses.
 * Note: required attributes cannot be changed after the user pool exists.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    preferredUsername: { required: true, mutable: true },
  },
});
