import crypto from "crypto";

export function getMissingSlackEnvVars(requiredEnvVars) {
  return requiredEnvVars.filter((name) => !process.env[name]);
}

function createStateSignature(payload, clientSecret) {
  return crypto.createHmac("sha256", clientSecret).update(payload).digest("hex");
}

function createSlackOAuthState(clientSecret) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${nonce}.${timestamp}`;
  const signature = createStateSignature(payload, clientSecret);

  return `${payload}.${signature}`;
}

export function buildSlackInstallUrl({
  clientId,
  slackScopes,
  redirectUri,
  clientSecret
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: slackScopes,
    redirect_uri: redirectUri,
    state: createSlackOAuthState(clientSecret)
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export function isValidSlackOAuthState(state, clientSecret) {
  if (!state) {
    return false;
  }

  const [nonce, timestamp, signature] = state.split(".");

  if (!nonce || !timestamp || !signature) {
    return false;
  }

  const payload = `${nonce}.${timestamp}`;
  const expectedSignature = createStateSignature(payload, clientSecret);
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

export function verifySlackRequest(req, signingSecret) {
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
    .createHmac("sha256", signingSecret)
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
