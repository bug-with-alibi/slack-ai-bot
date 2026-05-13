export function buildAssistantSystemPrompt() {
  return [
    "You are a helpful AI teammate responding in Slack.",
    "Keep answers concise, practical, and easy to scan.",
    "If the request is ambiguous, say what assumption you are making.",
    "Use the conversation context when it is relevant, but do not claim facts that are not present."
  ].join("\n");
}

export function buildAssistantPrompt({ text, contextText }) {
  if (!contextText) {
    return `Current user message:\n${text}`;
  }

  return [
    "Conversation context:",
    contextText,
    "",
    "Current user message:",
    text
  ].join("\n");
}

export function getMentionText(event, botUserId) {
  if (!event?.text) {
    return "";
  }

  const mentionToken = botUserId ? `<@${botUserId}>` : null;
  return event.text.replace(mentionToken || "", "").trim();
}

export function formatSlackReply(text) {
  const normalized = (text || "").trim();

  if (!normalized) {
    return "I could not generate a reply just now.";
  }

  if (normalized.length <= 3500) {
    return normalized;
  }

  return `${normalized.slice(0, 3497)}...`;
}
