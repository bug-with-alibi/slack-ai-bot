function trimText(text, maxChars) {
  const normalized = String(text || "").trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildContextLine(message, maxMessageChars) {
  const text = trimText(message.text, maxMessageChars);
  const identity =
    message.role === "assistant"
      ? "assistant"
      : `user:${message.userId || "unknown"}`;

  return `[${identity} ts=${message.messageTs}] ${text}`;
}

export function dedupeMessages(messages) {
  const seen = new Set();
  const unique = [];

  for (const message of messages) {
    const key = `${message.role}:${message.messageTs}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(message);
  }

  return unique;
}

export function sortMessagesAscending(messages) {
  return [...messages].sort((left, right) => {
    return Number(left.messageTs) - Number(right.messageTs);
  });
}

export function buildContextSections({
  threadMessages,
  channelMessages,
  maxContextChars,
  maxMessageChars
}) {
  const sections = [];

  if (threadMessages.length > 0) {
    sections.push({
      title: "Recent thread context",
      messages: threadMessages
    });
  }

  if (channelMessages.length > 0) {
    sections.push({
      title: "Recent channel context",
      messages: channelMessages
    });
  }

  let contextText = "";

  for (const section of sections) {
    let sectionText = `${section.title}:`;

    for (const message of section.messages) {
      const line = buildContextLine(message, maxMessageChars);
      const candidateSectionText = `${sectionText}\n${line}`;
      const candidate = `${contextText}${contextText ? "\n\n" : ""}${candidateSectionText}`;

      if (candidate.length > maxContextChars) {
        break;
      }

      sectionText = candidateSectionText;
    }

    if (sectionText === `${section.title}:`) {
      continue;
    }

    contextText = `${contextText}${contextText ? "\n\n" : ""}${sectionText}`;
  }

  return contextText;
}
