import { defineBackend } from "@aws-amplify/backend";
import { RemovalPolicy, Stack, Tags } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { game } from "./functions/game/resource";

const backend = defineBackend({ auth, data, game });

// Tag every resource for Tag Editor searches and cleanup.
Tags.of(backend.stack).add("Project", "rent-rush");

const gameLambda = backend.game.resources.lambda;
const userPool = backend.auth.resources.userPool;

// Private table: only the game Lambda can read or write it.
const gamesTable = new Table(Stack.of(gameLambda), "GamesTable", {
  partitionKey: { name: "gameId", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  // Old/abandoned games are deleted automatically.
  timeToLiveAttribute: "expiresAt",
  removalPolicy: RemovalPolicy.DESTROY,
});
// Lobby listing: games by status, newest first.
gamesTable.addGlobalSecondaryIndex({
  indexName: "byStatus",
  partitionKey: { name: "status", type: AttributeType.STRING },
  sortKey: { name: "updatedAt", type: AttributeType.NUMBER },
  projectionType: ProjectionType.ALL,
});

gamesTable.grantReadWriteData(gameLambda);
gameLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:AdminGetUser"],
    resources: [userPool.userPoolArn],
  }),
);

backend.game.addEnvironment("GAMES_TABLE", gamesTable.tableName);
backend.game.addEnvironment("USER_POOL_ID", userPool.userPoolId);
