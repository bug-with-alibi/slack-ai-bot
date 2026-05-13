import express from "express";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

import { createConfig } from "./lib/config.js";
import { createInstallationStore } from "./lib/installations.js";
import { createMemoryStore } from "./lib/memory/index.js";
import { registerRoutes } from "./lib/routes.js";
import { createSlackEventsHandler } from "./lib/slack/events.js";
import { postSlackMessage, updateSlackMessage } from "./lib/slack/api.js";
import { verifySlackRequest } from "./lib/slack/oauth.js";
import { createSupabaseClient } from "./lib/supabase.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const config = createConfig({ baseDir: __dirname, logger: console });
const supabaseClient = createSupabaseClient({
  url: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey
});

const installationStore = createInstallationStore({
  backend: config.installationStoreBackend,
  filePath: config.installationsPath,
  callSupabase: supabaseClient.call,
  logger: console
});

const memoryStore = createMemoryStore({
  backend: config.installationStoreBackend,
  filePath: config.memoryStorePath,
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
    console.log(`Installation store backend: ${installationStore.backend}`);
    console.log(`LLM provider: ${config.llmProvider}`);
    console.log(`Memory backend: ${memoryStore.backend}`);
    console.log(
      `Memory config: thread=${config.memoryConfig.maxThreadMessages}, channel=${config.memoryConfig.maxChannelMessages}, contextChars=${config.memoryConfig.maxContextChars}, messageChars=${config.memoryConfig.maxMessageChars}`
    );

    if (config.llmMissingEnvVars.length > 0) {
      console.warn(
        `LLM is not fully configured. Missing env vars: ${config.llmMissingEnvVars.join(", ")}`
      );
    }

    if (installationStore.backend === "supabase") {
      console.log(`Supabase URL: ${config.supabaseUrl}`);
    } else {
      console.log(`Installation store file: ${config.installationsPath}`);
      console.log(`Memory store file: ${config.memoryStorePath}`);
    }
  });
}

start().catch((error) => {
  console.error("Failed to start app", error);
  process.exit(1);
});
