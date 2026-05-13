import {
  buildSlackInstallUrl,
  getMissingSlackEnvVars,
  isValidSlackOAuthState
} from "./slack/oauth.js";
import { exchangeOAuthCodeForInstallation } from "./slack/api.js";

export function registerRoutes(app, {
  logger = console,
  config,
  installationStore,
  memoryStore,
  slackEventsHandler
}) {
  app.get("/", async (_req, res) => {
    const installationCount = await installationStore.count();
    logger.log(
      `[health] root check ok - installed workspaces: ${installationCount}`
    );

    res.status(200).json({
      ok: true,
      service: "slack-ai-bot",
      installedWorkspaces: installationCount,
      installationStoreBackend: installationStore.backend,
      llmProvider: config.llmProvider,
      llmConfigured: config.llmMissingEnvVars.length === 0,
      memoryBackend: memoryStore.backend,
      memoryConfig: config.memoryConfig,
      installPath: "/slack/install",
      eventsPath: "/slack/events"
    });
  });

  app.get("/slack/install", (req, res) => {
    const missing = getMissingSlackEnvVars(config.requiredSlackEnvVars);
    logger.log(
      `[oauth] install requested - redirect=${req.query.redirect !== "false"}`
    );

    if (missing.length > 0) {
      logger.warn(`[oauth] install blocked - missing env vars: ${missing.join(", ")}`);
      return res.status(500).json({
        ok: false,
        error: "missing_env_vars",
        missing
      });
    }

    const installUrl = buildSlackInstallUrl({
      clientId: process.env.SLACK_CLIENT_ID,
      slackScopes: config.slackScopes,
      redirectUri: process.env.SLACK_REDIRECT_URI,
      clientSecret: process.env.SLACK_CLIENT_SECRET
    });

    if (req.query.redirect === "false") {
      logger.log("[oauth] returning Slack install URL as JSON");
      return res.status(200).json({
        ok: true,
        installUrl
      });
    }

    logger.log("[oauth] redirecting user to Slack install page");
    return res.redirect(installUrl);
  });

  app.get("/slack/oauth/callback", async (req, res) => {
    const { code, state, error } = req.query;
    logger.log("[oauth] callback received");

    if (error) {
      logger.warn(`[oauth] callback returned error from Slack: ${error}`);
      return res.status(400).send(`Slack OAuth failed: ${error}`);
    }

    if (!isValidSlackOAuthState(state, process.env.SLACK_CLIENT_SECRET)) {
      logger.warn("[oauth] callback rejected - invalid or expired state");
      return res.status(400).send("Invalid or expired OAuth state.");
    }

    if (!code || typeof code !== "string") {
      logger.warn("[oauth] callback rejected - missing OAuth code");
      return res.status(400).send("Missing OAuth code.");
    }

    try {
      logger.log("[oauth] exchanging OAuth code for installation");
      const oauthResult = await exchangeOAuthCodeForInstallation({
        clientId: process.env.SLACK_CLIENT_ID,
        clientSecret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirectUri: process.env.SLACK_REDIRECT_URI
      });

      const installation = await installationStore.save({
        appId: oauthResult.app_id,
        teamId: oauthResult.team?.id || null,
        teamName: oauthResult.team?.name || null,
        enterpriseId: oauthResult.enterprise?.id || null,
        enterpriseName: oauthResult.enterprise?.name || null,
        botToken: oauthResult.access_token,
        botUserId: oauthResult.bot_user_id || null,
        scope: oauthResult.scope || config.slackScopes,
        authedUserId: oauthResult.authed_user?.id || null
      });

      logger.log(
        `[oauth] installation saved - teamId=${installation.teamId || "n/a"} enterpriseId=${installation.enterpriseId || "n/a"} workspace=${installation.teamName || installation.enterpriseName || "unknown"}`
      );

      return res.status(200).send(`
        <h1>Slack app installed</h1>
        <p>Workspace: ${installation.teamName || installation.enterpriseName || "unknown"}</p>
        <p>You can close this tab and mention the app in Slack.</p>
      `);
    } catch (callbackError) {
      logger.error("[oauth] Slack OAuth callback failed", callbackError);
      return res.status(500).send("Slack OAuth exchange failed.");
    }
  });

  app.post("/slack/events", slackEventsHandler);
}
