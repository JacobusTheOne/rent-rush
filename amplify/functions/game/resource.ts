import { defineFunction } from "@aws-amplify/backend";

export const game = defineFunction({
  name: "rent-rush-game",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 10,
  memoryMB: 256,
  // Lives in the data stack: it is an AppSync resolver AND owns the games
  // table, so separate stacks would create a circular dependency.
  resourceGroupName: "data",
});
