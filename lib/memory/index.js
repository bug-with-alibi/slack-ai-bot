import fs from "fs/promises";
import path from "path";

const DEFAULT_MEMORY_MAX_THREAD_MESSAGES = 6;
const DEFAULT_MEMORY_MAX_CHANNEL_MESSAGES = 8;
const DEFAULT_MEMORY_MAX_CONTEXT_CHARS = 5000;
const DEFAULT_MEMORY_MAX_MESSAGE_CHARS = 600;

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function trimText(text, maxChars) {
  const normalized = String(text || "").trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildMessageId(message) {
  return [
    message.workspaceKey,
    message.channelId,
    message.messageTs,
    message.role
  ].join(":");
}

function mapSupabaseRowToMessage(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    workspaceKey: row.workspace_key,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    messageTs: row.message_ts,
    role: row.role,
    userId: row.user_id,
    text: row.text,
    createdAt: row.created_at
  };
}

function buildContextLine(message, maxMessageChars) {
  const text = trimText(message.text, maxMessageChars);
  const identity =
    message.role === "assistant"
      ? "assistant"
      : `user:${message.userId || "unknown"}`;

  return `[${identity} ts=${message.messageTs}] ${text}`;
}

function dedupeMessages(messages) {
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

function sortMessagesAscending(messages) {
  return [...messages].sort((left, right) => {
    return Number(left.messageTs) - Number(right.messageTs);
  });
}

function buildContextSections({
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

async function ensureFileStore(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify([], null, 2));
  }
}

async function readFileMessages(filePath) {
  await ensureFileStore(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw || "[]");
}

async function writeFileMessages(filePath, messages) {
  await ensureFileStore(filePath);
  await fs.writeFile(filePath, JSON.stringify(messages, null, 2));
}

function buildSupabaseQuery(pathname, filters = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      params.set(key, value);
    }
  }

  return `${pathname}?${params.toString()}`;
}

export function getMemoryConfig() {
  return {
    maxThreadMessages: getPositiveInteger(
      process.env.MEMORY_MAX_THREAD_MESSAGES,
      DEFAULT_MEMORY_MAX_THREAD_MESSAGES
    ),
    maxChannelMessages: getPositiveInteger(
      process.env.MEMORY_MAX_CHANNEL_MESSAGES,
      DEFAULT_MEMORY_MAX_CHANNEL_MESSAGES
    ),
    maxContextChars: getPositiveInteger(
      process.env.MEMORY_MAX_CONTEXT_CHARS,
      DEFAULT_MEMORY_MAX_CONTEXT_CHARS
    ),
    maxMessageChars: getPositiveInteger(
      process.env.MEMORY_MAX_MESSAGE_CHARS,
      DEFAULT_MEMORY_MAX_MESSAGE_CHARS
    )
  };
}

export function createMemoryStore({
  backend,
  filePath,
  callSupabase,
  logger = console
}) {
  if (backend === "supabase" && typeof callSupabase !== "function") {
    throw new Error("Supabase memory store requires callSupabase");
  }

  return {
    backend,
    async ensureReady() {
      if (backend === "file") {
        await ensureFileStore(filePath);
      }
    },
    async saveMessage(message) {
      const normalized = {
        id: buildMessageId(message),
        workspaceKey: message.workspaceKey,
        channelId: message.channelId,
        threadTs: message.threadTs,
        messageTs: message.messageTs,
        role: message.role,
        userId: message.userId || null,
        text: String(message.text || "").trim(),
        createdAt: message.createdAt || new Date().toISOString()
      };

      if (!normalized.text) {
        return null;
      }

      if (backend === "supabase") {
        const rows = await callSupabase(
          "/rest/v1/slack_conversation_messages?on_conflict=id&select=*",
          {
            method: "POST",
            headers: {
              Prefer: "resolution=merge-duplicates,return=representation"
            },
            body: JSON.stringify({
              id: normalized.id,
              workspace_key: normalized.workspaceKey,
              channel_id: normalized.channelId,
              thread_ts: normalized.threadTs,
              message_ts: normalized.messageTs,
              role: normalized.role,
              user_id: normalized.userId,
              text: normalized.text,
              created_at: normalized.createdAt
            })
          }
        );

        logger.log(
          `[memory] saved message - backend=supabase role=${normalized.role} channel=${normalized.channelId} threadTs=${normalized.threadTs}`
        );

        return mapSupabaseRowToMessage(rows?.[0]);
      }

      const messages = await readFileMessages(filePath);
      const existingIndex = messages.findIndex((item) => item.id === normalized.id);

      if (existingIndex >= 0) {
        messages[existingIndex] = normalized;
      } else {
        messages.push(normalized);
      }

      await writeFileMessages(filePath, messages);
      logger.log(
        `[memory] saved message - backend=file role=${normalized.role} channel=${normalized.channelId} threadTs=${normalized.threadTs}`
      );

      return normalized;
    },
    async buildContext({
      workspaceKey,
      channelId,
      threadTs,
      currentMessageTs,
      config
    }) {
      let threadMessages = [];
      let channelMessages = [];

      if (backend === "supabase") {
        const threadRows = await callSupabase(
          buildSupabaseQuery("/rest/v1/slack_conversation_messages", {
            workspace_key: `eq.${workspaceKey}`,
            channel_id: `eq.${channelId}`,
            thread_ts: `eq.${threadTs}`,
            message_ts: `lt.${currentMessageTs}`,
            select: "*",
            order: "message_ts.desc",
            limit: String(config.maxThreadMessages)
          })
        );

        const channelRows = await callSupabase(
          buildSupabaseQuery("/rest/v1/slack_conversation_messages", {
            workspace_key: `eq.${workspaceKey}`,
            channel_id: `eq.${channelId}`,
            message_ts: `lt.${currentMessageTs}`,
            select: "*",
            order: "message_ts.desc",
            limit: String(config.maxThreadMessages + config.maxChannelMessages)
          })
        );

        threadMessages = threadRows.map(mapSupabaseRowToMessage).filter(Boolean);
        channelMessages = channelRows.map(mapSupabaseRowToMessage).filter(Boolean);
      } else {
        const allMessages = await readFileMessages(filePath);
        const priorMessages = allMessages.filter((message) => {
          return (
            message.workspaceKey === workspaceKey &&
            message.channelId === channelId &&
            Number(message.messageTs) < Number(currentMessageTs)
          );
        });

        threadMessages = priorMessages
          .filter((message) => message.threadTs === threadTs)
          .sort((left, right) => Number(right.messageTs) - Number(left.messageTs))
          .slice(0, config.maxThreadMessages);

        channelMessages = priorMessages
          .sort((left, right) => Number(right.messageTs) - Number(left.messageTs))
          .slice(0, config.maxThreadMessages + config.maxChannelMessages);
      }

      const threadMessageKeys = new Set(
        threadMessages.map((message) => `${message.role}:${message.messageTs}`)
      );

      const distinctChannelMessages = channelMessages.filter((message) => {
        return !threadMessageKeys.has(`${message.role}:${message.messageTs}`);
      });

      const finalThreadMessages = sortMessagesAscending(
        threadMessages.slice(0, config.maxThreadMessages)
      );
      const finalChannelMessages = sortMessagesAscending(
        distinctChannelMessages.slice(0, config.maxChannelMessages)
      );
      const contextText = buildContextSections({
        threadMessages: finalThreadMessages,
        channelMessages: finalChannelMessages,
        maxContextChars: config.maxContextChars,
        maxMessageChars: config.maxMessageChars
      });

      const selectedMessages = dedupeMessages([
        ...finalThreadMessages,
        ...finalChannelMessages
      ]);

      logger.log(
        `[memory] context selected - backend=${backend} threadMessages=${finalThreadMessages.length} channelMessages=${finalChannelMessages.length} contextChars=${contextText.length}`
      );

      if (contextText) {
        logger.log(`[memory] context payload\n${contextText}`);
      } else {
        logger.log("[memory] context payload\n(no prior context selected)");
      }

      return {
        selectedMessages,
        threadMessages: finalThreadMessages,
        channelMessages: finalChannelMessages,
        contextText
      };
    }
  };
}
