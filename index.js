import crypto from "crypto";
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const INSTALLATIONS_PATH = path.join(__dirname, "data", "installations.json");
const processedEvents = new Set();

const requiredEnvVars = [
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_SIGNING_SECRET",
  "SLACK_REDIRECT_URI"
];

const slackScopes =
  process.env.SLACK_SCOPES || "app_mentions:read,chat:write";

app.use(
  express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    }
  })
);

function getMissingEnvVars() {
  return requiredEnvVars.filter((name) => !process.env[name]);
}

async function ensureInstallationStore() {
  await fs.mkdir(path.dirname(INSTALLATIONS_PATH), { recursive: true });

  try {
    await fs.access(INSTALLATIONS_PATH);
  } catch {
    await fs.writeFile(INSTALLATIONS_PATH, JSON.stringify({}, null, 2));
  }
}

async function readInstallations() {
  await ensureInstallationStore();
  const raw = await fs.readFile(INSTALLATIONS_PATH, "utf8");
  return JSON.parse(raw || "{}");
}

async function writeInstallations(installations) {
  await ensureInstallationStore();
  await fs.writeFile(
    INSTALLATIONS_PATH,
    JSON.stringify(installations, null, 2)
  );
}

function getInstallationKey({ teamId, enterpriseId }) {
  return teamId || enterpriseId || null;
}

async function saveInstallation(installation) {
  const key = getInstallationKey(installation);

  if (!key) {
    throw new Error("Installation is missing both teamId and enterpriseId");
  }

  const installations = await readInstallations();
  installations[key] = {
    ...installation,
    installedAt: new Date().toISOString()
  };
  await writeInstallations(installations);

  return installations[key];
}

async function getInstallationByTeamId(teamId) {
  const installations = await readInstallations();
  return installations[teamId] || null;
}

function createStateSignature(payload) {
  return crypto
    .createHmac("sha256", process.env.SLACK_CLIENT_SECRET)
    .update(payload)
    .digest("hex");
}

function createSlackOAuthState() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${nonce}.${timestamp}`;
  const signature = createStateSignature(payload);

  return `${payload}.${signature}`;
}

function isValidSlackOAuthState(state) {
  if (!state) {
    return false;
  }

  const [nonce, timestamp, signature] = state.split(".");

  if (!nonce || !timestamp || !signature) {
    return false;
  }

  const payload = `${nonce}.${timestamp}`;
  const expectedSignature = createStateSignature(payload);
  const ageMs = Date.now() - Number(timestamp);

  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) {
    return false;
  }

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex")
  );
}

function buildSlackInstallUrl() {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    scope: slackScopes,
    redirect_uri: process.env.SLACK_REDIRECT_URI,
    state: createSlackOAuthState()
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

function verifySlackRequest(req) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];

  if (!timestamp || !signature || !req.rawBody) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));

  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) {
    return false;
  }

  const baseString = `v0:${timestamp}:${req.rawBody}`;
  const expectedSignature = `v0=${crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
    .update(baseString)
    .digest("hex")}`;

  if (String(signature).length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(String(signature), "utf8"),
    Buffer.from(expectedSignature, "utf8")
  );
}

async function exchangeOAuthCodeForInstallation(code) {
  const response = await axios.post(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  if (!response.data.ok) {
    throw new Error(response.data.error || "Slack OAuth failed");
  }

  return response.data;
}

async function postSlackMessage(token, channel, text) {
  const response = await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.data.ok) {
    throw new Error(response.data.error || "Failed to post message");
  }
}

app.get("/", async (_req, res) => {
  const installations = await readInstallations();
  console.log(
    `[health] root check ok - installed workspaces: ${Object.keys(installations).length}`
  );

  res.status(200).json({
    ok: true,
    service: "slack-ai-bot",
    installedWorkspaces: Object.keys(installations).length,
    installPath: "/slack/install",
    eventsPath: "/slack/events"
  });
});

app.get("/slack/install", (req, res) => {
  const missing = getMissingEnvVars();
  console.log(
    `[oauth] install requested - redirect=${req.query.redirect !== "false"}`
  );

  if (missing.length > 0) {
    console.warn(`[oauth] install blocked - missing env vars: ${missing.join(", ")}`);
    return res.status(500).json({
      ok: false,
      error: "missing_env_vars",
      missing
    });
  }

  if (req.query.redirect === "false") {
    console.log("[oauth] returning Slack install URL as JSON");
    return res.status(200).json({
      ok: true,
      installUrl: buildSlackInstallUrl()
    });
  }

  console.log("[oauth] redirecting user to Slack install page");
  return res.redirect(buildSlackInstallUrl());
});

app.get("/slack/oauth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  console.log("[oauth] callback received");

  if (error) {
    console.warn(`[oauth] callback returned error from Slack: ${error}`);
    return res.status(400).send(`Slack OAuth failed: ${error}`);
  }

  if (!isValidSlackOAuthState(state)) {
    console.warn("[oauth] callback rejected - invalid or expired state");
    return res.status(400).send("Invalid or expired OAuth state.");
  }

  if (!code || typeof code !== "string") {
    console.warn("[oauth] callback rejected - missing OAuth code");
    return res.status(400).send("Missing OAuth code.");
  }

  try {
    console.log("[oauth] exchanging OAuth code for installation");
    const oauthResult = await exchangeOAuthCodeForInstallation(code);

    const installation = await saveInstallation({
      appId: oauthResult.app_id,
      teamId: oauthResult.team?.id || null,
      teamName: oauthResult.team?.name || null,
      enterpriseId: oauthResult.enterprise?.id || null,
      enterpriseName: oauthResult.enterprise?.name || null,
      botToken: oauthResult.access_token,
      botUserId: oauthResult.bot_user_id || null,
      scope: oauthResult.scope || slackScopes,
      authedUserId: oauthResult.authed_user?.id || null
    });

    console.log(
      `[oauth] installation saved - teamId=${installation.teamId || "n/a"} enterpriseId=${installation.enterpriseId || "n/a"} workspace=${installation.teamName || installation.enterpriseName || "unknown"}`
    );

    return res.status(200).send(`
      <h1>Slack app installed</h1>
      <p>Workspace: ${installation.teamName || installation.enterpriseName || "unknown"}</p>
      <p>You can close this tab and mention the app in Slack.</p>
    `);
  } catch (error) {
    console.error("Slack OAuth callback failed", error);
    return res.status(500).send("Slack OAuth exchange failed.");
  }
});

app.post("/slack/events", async (req, res) => {
  if (!verifySlackRequest(req)) {
    console.warn("[events] rejected request - invalid Slack signature");
    return res.status(401).json({ ok: false, error: "invalid_signature" });
  }

  if (req.body.type === "url_verification") {
    console.log("[events] responding to Slack URL verification challenge");
    return res.status(200).json({ challenge: req.body.challenge });
  }

  const eventId = req.body.event_id;
  console.log(
    `[events] received event - type=${req.body.event?.type || "unknown"} eventId=${eventId || "n/a"} teamId=${req.body.team_id || req.body.authorizations?.[0]?.team_id || "n/a"}`
  );

  if (eventId && processedEvents.has(eventId)) {
    console.log(`[events] duplicate ignored - eventId=${eventId}`);
    return res.sendStatus(200);
  }

  if (eventId) {
    processedEvents.add(eventId);
    console.log(`[events] tracking event for dedupe - eventId=${eventId}`);
    setTimeout(() => processedEvents.delete(eventId), 5 * 60 * 1000);
  }

  res.sendStatus(200);
  console.log("[events] acknowledged event to Slack");

  const event = req.body.event;

  if (!event || event.type !== "app_mention") {
    console.log(`[events] no action for event type=${event?.type || "unknown"}`);
    return;
  }

  const teamId =
    req.body.team_id ||
    req.body.authorizations?.[0]?.team_id ||
    req.body.event_context?.team_id;

  if (!teamId) {
    console.warn("Unable to resolve team for incoming Slack event");
    return;
  }

  try {
    console.log(`[events] looking up installation for workspace ${teamId}`);
    const installation = await getInstallationByTeamId(teamId);

    if (!installation?.botToken) {
      console.warn(`No installation found for workspace ${teamId}`);
      return;
    }

    console.log(
      `[events] posting fixed reply - workspace=${installation.teamName || installation.enterpriseName || teamId} channel=${event.channel}`
    );
    await postSlackMessage(
      installation.botToken,
      event.channel,
      "Hey 👋 I'm alive! (I can't say anything else for now)"
    );
    console.log("[events] fixed reply sent successfully");
  } catch (error) {
    console.error("Failed to handle Slack event", error);
  }
});

ensureInstallationStore()
  .then(() => {
    const missing = getMissingEnvVars();

    if (missing.length > 0) {
      console.warn(
        `Missing environment variables: ${missing.join(", ")}. Install flow will not work until they are set.`
      );
    }

    app.listen(PORT, () => {
      console.log(`Running on ${PORT}`);
      console.log(`Install URL: http://localhost:${PORT}/slack/install`);
      console.log(`OAuth redirect URI: ${process.env.SLACK_REDIRECT_URI || "not set"}`);
      console.log(`Slack scopes: ${slackScopes}`);
      console.log(`Installation store: ${INSTALLATIONS_PATH}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start app", error);
    process.exit(1);
  });
