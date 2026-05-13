import {
  buildAssistantPrompt,
  buildAssistantSystemPrompt,
  formatSlackReply,
  getMentionText
} from "./prompt.js";

function resolveTeamId(body) {
  return (
    body.team_id ||
    body.authorizations?.[0]?.team_id ||
    body.event_context?.team_id
  );
}

export function createSlackEventsHandler({
  logger = console,
  verifySlackRequest,
  installationStore,
  memoryStore,
  memoryConfig,
  llmClient,
  llmProvider,
  llmMissingEnvVars,
  postSlackMessage,
  updateSlackMessage
}) {
  const processedEvents = new Set();

  return async function handleSlackEvents(req, res) {
    if (!verifySlackRequest(req)) {
      logger.warn("[events] rejected request - invalid Slack signature");
      return res.status(401).json({ ok: false, error: "invalid_signature" });
    }

    if (req.body.type === "url_verification") {
      logger.log("[events] responding to Slack URL verification challenge");
      return res.status(200).json({ challenge: req.body.challenge });
    }

    const eventId = req.body.event_id;
    logger.log(
      `[events] received event - type=${req.body.event?.type || "unknown"} eventId=${eventId || "n/a"} teamId=${req.body.team_id || req.body.authorizations?.[0]?.team_id || "n/a"}`
    );

    if (eventId && processedEvents.has(eventId)) {
      logger.log(`[events] duplicate ignored - eventId=${eventId}`);
      return res.sendStatus(200);
    }

    if (eventId) {
      processedEvents.add(eventId);
      logger.log(`[events] tracking event for dedupe - eventId=${eventId}`);
      setTimeout(() => processedEvents.delete(eventId), 5 * 60 * 1000);
    }

    res.sendStatus(200);
    logger.log("[events] acknowledged event to Slack");

    const event = req.body.event;

    if (!event || event.type !== "app_mention") {
      logger.log(`[events] no action for event type=${event?.type || "unknown"}`);
      return;
    }

    const teamId = resolveTeamId(req.body);

    if (!teamId) {
      logger.warn("[events] unable to resolve team for incoming Slack event");
      return;
    }

    let installation = null;
    let placeholder = null;

    try {
      logger.log(`[events] looking up installation for workspace ${teamId}`);
      installation = await installationStore.getByTeamId(teamId);

      if (!installation?.botToken) {
        logger.warn(`[events] no installation found for workspace ${teamId}`);
        return;
      }

      const promptText = getMentionText(event, installation.botUserId);
      const threadTs = event.thread_ts || event.ts;

      if (!promptText) {
        logger.log("[events] mention did not include a prompt");
        await postSlackMessage(
          installation.botToken,
          event.channel,
          "Tell me what you want help with after mentioning me."
        );
        return;
      }

      await memoryStore.saveMessage({
        workspaceKey: installation.workspaceKey,
        channelId: event.channel,
        threadTs,
        messageTs: event.ts,
        role: "user",
        userId: event.user,
        text: promptText
      });

      if (!llmClient) {
        logger.warn(
          `[events] LLM not configured - missing env vars: ${llmMissingEnvVars.join(", ")}`
        );
        await postSlackMessage(
          installation.botToken,
          event.channel,
          "I am not configured with a Gemini API key yet."
        );
        return;
      }

      logger.log(
        `[events] posting placeholder reply - workspace=${installation.teamName || installation.enterpriseName || teamId} channel=${event.channel}`
      );
      placeholder = await postSlackMessage(
        installation.botToken,
        event.channel,
        "Thinking...",
        {
          thread_ts: threadTs
        }
      );

      const memoryContext = await memoryStore.buildContext({
        workspaceKey: installation.workspaceKey,
        channelId: event.channel,
        threadTs,
        currentMessageTs: event.ts,
        config: memoryConfig
      });

      logger.log(
        `[events] generating LLM response - provider=${llmProvider} workspace=${installation.teamName || installation.enterpriseName || teamId} contextMessages=${memoryContext.selectedMessages.length}`
      );
      const completion = await llmClient.generateText({
        systemPrompt: buildAssistantSystemPrompt(),
        prompt: buildAssistantPrompt({
          text: promptText,
          contextText: memoryContext.contextText
        })
      });

      const replyText = formatSlackReply(completion.text);

      await updateSlackMessage(
        installation.botToken,
        event.channel,
        placeholder.ts,
        replyText
      );
      await memoryStore.saveMessage({
        workspaceKey: installation.workspaceKey,
        channelId: event.channel,
        threadTs,
        messageTs: placeholder.ts,
        role: "assistant",
        userId: installation.botUserId,
        text: replyText
      });
      logger.log(
        `[events] LLM reply sent - provider=${llmProvider} finishReason=${completion.finishReason || "unknown"}`
      );
    } catch (error) {
      logger.error("[events] failed to handle Slack event", error);

      if (installation?.botToken && placeholder?.ts) {
        try {
          await updateSlackMessage(
            installation.botToken,
            event.channel,
            placeholder.ts,
            "I hit an error while talking to Gemini. Please try again."
          );
          logger.log("[events] updated placeholder with error message");
        } catch (updateError) {
          logger.error("[events] failed to update Slack error message", updateError);
        }
      }
    }
  };
}
