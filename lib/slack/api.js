import axios from "axios";

export async function exchangeOAuthCodeForInstallation({
  clientId,
  clientSecret,
  code,
  redirectUri
}) {
  const response = await axios.post(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
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

export async function postSlackMessage(token, channel, text, options = {}) {
  const response = await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text, ...options },
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

  return response.data;
}

export async function updateSlackMessage(token, channel, ts, text) {
  const response = await axios.post(
    "https://slack.com/api/chat.update",
    { channel, ts, text },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.data.ok) {
    throw new Error(response.data.error || "Failed to update message");
  }

  return response.data;
}
