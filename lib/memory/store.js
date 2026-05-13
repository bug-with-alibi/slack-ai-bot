import {
  buildContextSections,
  dedupeMessages,
  sortMessagesAscending
} from "./context.js";

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

function buildSupabaseQuery(pathname, filters = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      params.set(key, value);
    }
  }

  return `${pathname}?${params.toString()}`;
}

export function createMemoryStore({
  callSupabase,
  logger = console
}) {
  if (typeof callSupabase !== "function") {
    throw new Error("Supabase memory store requires callSupabase");
  }

  return {
    async ensureReady() {
      await callSupabase("/rest/v1/slack_conversation_messages?select=id&limit=1");
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
    },
    async buildContext({
      workspaceKey,
      channelId,
      threadTs,
      currentMessageTs,
      config
    }) {
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

      const threadMessages = threadRows.map(mapSupabaseRowToMessage).filter(Boolean);
      const channelMessages = channelRows.map(mapSupabaseRowToMessage).filter(Boolean);

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
        `[memory] context selected - backend=supabase threadMessages=${finalThreadMessages.length} channelMessages=${finalChannelMessages.length} contextChars=${contextText.length}`
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
