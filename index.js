import express from "express";
import dotenv from "dotenv";

import { createConfig } from "./lib/config.js";
import { createInstallationStore } from "./lib/installations.js";
import { createMemoryStore } from "./lib/memory/index.js";
import { registerRoutes } from "./lib/routes.js";
import { createSlackEventsHandler } from "./lib/slack/events.js";
import { postSlackMessage, updateSlackMessage } from "./lib/slack/api.js";
import { verifySlackRequest } from "./lib/slack/oauth.js";
import { createSupabaseClient } from "./lib/supabase.js";

dotenv.config();

const app = express();
const config = createConfig({ baseDir: process.cwd(), logger: console });
const supabaseClient = createSupabaseClient({
  url: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey
});

const installationStore = createInstallationStore({
  callSupabase: supabaseClient.call,
  logger: console
});

const memoryStore = createMemoryStore({
  callSupabase: supabaseClient.call,
  logger: console
});

const slackEventsHandler = createSlackEventsHandler({
  logger: console,
  verifySlackRequest: (req) =>
    verifySlackRequest(req, process.env.SLACK_SIGNING_SECRET),
  installationStore,
  memoryStore,
  memoryConfig: config.memoryConfig,
  llmClient: config.llmClient,
  llmProvider: config.llmProvider,
  llmMissingEnvVars: config.llmMissingEnvVars,
  postSlackMessage,
  updateSlackMessage
});

app.use(
  express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    }
  })
);

registerRoutes(app, {
  logger: console,
  config,
  installationStore,
  memoryStore,
  slackEventsHandler
});

async function start() {
  const missingSupabaseEnvVars = config.requiredSupabaseEnvVars.filter(
    (name) => !process.env[name]
  );

  if (missingSupabaseEnvVars.length > 0) {
    throw new Error(
      `Missing required Supabase environment variables: ${missingSupabaseEnvVars.join(", ")}`
    );
  }

  await installationStore.ensureReady();
  await memoryStore.ensureReady();

  const missingSlackEnvVars = config.requiredSlackEnvVars.filter(
    (name) => !process.env[name]
  );

  if (missingSlackEnvVars.length > 0) {
    console.warn(
      `Missing environment variables: ${missingSlackEnvVars.join(", ")}. Install flow will not work until they are set.`
    );
  }

  app.listen(config.port, () => {
    console.log(`Running on ${config.port}`);
    console.log(`Install URL: http://localhost:${config.port}/slack/install`);
    console.log(
      `OAuth redirect URI: ${process.env.SLACK_REDIRECT_URI || "not set"}`
    );
    console.log(`Slack scopes: ${config.slackScopes}`);
    console.log(`LLM provider: ${config.llmProvider}`);
    console.log("Storage backend: supabase");
    console.log(
      `Memory config: thread=${config.memoryConfig.maxThreadMessages}, channel=${config.memoryConfig.maxChannelMessages}, contextChars=${config.memoryConfig.maxContextChars}, messageChars=${config.memoryConfig.maxMessageChars}`
    );

    if (config.llmMissingEnvVars.length > 0) {
      console.warn(
        `LLM is not fully configured. Missing env vars: ${config.llmMissingEnvVars.join(", ")}`
      );
    }

    console.log(`Supabase URL: ${config.supabaseUrl}`);
  });
}

start().catch((error) => {
  console.error("Failed to start app", error);
  process.exit(1);
});
