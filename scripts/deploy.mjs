#!/usr/bin/env node
/**
 * Deploys Rent Rush to production from this machine:
 *   1. backend: `ampx pipeline-deploy` to the Amplify app in package.json config
 *      (Cognito, AppSync, Lambda, DynamoDB in the project's Region)
 *   2. frontend: `next build` against the PRODUCTION amplify_outputs, then
 *      `wrangler deploy` of ./out to Cloudflare (see wrangler.jsonc)
 * Local dev keeps pointing at your sandbox: ./amplify_outputs.json is restored at the end.
 *
 * Why from this machine: the AWS project's managed policies block GitHub OIDC
 * federation, and we don't store long-lived AWS keys in GitHub.
 *
 * Usage:
 *   npm run deploy:backend             # backend only: then commit amplify_outputs.production.json
 *                                      # and push main; Cloudflare (linked to GitHub) rebuilds the site
 *   npm run deploy                     # backend + a manual frontend upload from this machine
 *   npm run deploy -- --skip-backend   # manual frontend upload only
 * Requires: `aws login --profile <awsProfile>`; for a manual upload also `npx wrangler login`.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";

const root = new URL("..", import.meta.url);
const file = (name) => new URL(name, root);
const { amplifyAppId, awsProfile, awsRegion } = JSON.parse(readFileSync(file("package.json"), "utf8")).config;
const skipBackend = process.argv.includes("--skip-backend");
const backendOnly = process.argv.includes("--backend-only");

const LOCAL = file("amplify_outputs.json");
const PROD = file("amplify_outputs.production.json");
const BACKUP = file("amplify_outputs.sandbox-backup.json");

const env = { ...process.env, AWS_PROFILE: awsProfile, AWS_REGION: awsRegion, CI: "true" };
const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", env, cwd: root });
};

const hadLocal = existsSync(LOCAL);
if (hadLocal) copyFileSync(LOCAL, BACKUP);

try {
  if (!skipBackend) {
    run(`npx ampx pipeline-deploy --branch main --app-id ${amplifyAppId}`);
    copyFileSync(LOCAL, PROD); // pipeline-deploy writes ./amplify_outputs.json
  }
  if (!existsSync(PROD)) throw new Error("No amplify_outputs.production.json yet: run without --skip-backend first.");
  if (backendOnly) {
    console.log(
      "\nBackend deployed. Commit amplify_outputs.production.json if it changed and push main: Cloudflare rebuilds the site.",
    );
  } else {
    copyFileSync(PROD, LOCAL);
    run("npm run build");
    run("npx wrangler deploy");
  }
} finally {
  if (hadLocal) renameSync(BACKUP, LOCAL);
  else rmSync(LOCAL, { force: true });
  console.log("\nLocal amplify_outputs.json restored (sandbox).");
}
