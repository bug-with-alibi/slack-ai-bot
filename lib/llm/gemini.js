const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta";

function extractTextFromCandidate(candidate) {
  const parts = candidate?.content?.parts || [];
  return parts
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("");
}

function buildGeminiRequestBody({ prompt, systemPrompt }) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    ...(systemPrompt
      ? {
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          }
        }
      : {})
  };
}

export function createGeminiClient({ apiKey, model, logger = console }) {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  if (!model) {
    throw new Error("Missing Gemini model name");
  }

  return {
    provider: "gemini",
    model,
    async generateText({ prompt, systemPrompt }) {
      const startedAt = Date.now();
      logger.log(
        `[llm] Gemini request started - model=${model} promptChars=${prompt.length}`
      );

      let response;

      try {
        response = await fetch(
          `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify(
              buildGeminiRequestBody({ prompt, systemPrompt })
            )
          }
        );
      } catch (error) {
        logger.error(
          `[llm] Gemini request failed before response - model=${model} durationMs=${Date.now() - startedAt}`,
          error
        );
        throw error;
      }

      const responseText = await response.text();
      let payload;

      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Gemini returned a non-JSON response (${response.status}): ${responseText}`
        );
      }

      if (!response.ok) {
        logger.error(
          `[llm] Gemini request failed - model=${model} status=${response.status} durationMs=${Date.now() - startedAt}`
        );
        throw new Error(
          payload?.error?.message ||
            `Gemini request failed with status ${response.status}`
        );
      }

      const text = (payload?.candidates || [])
        .map(extractTextFromCandidate)
        .filter(Boolean)
        .join("\n\n")
        .trim();

      if (!text) {
        const blockReason = payload?.promptFeedback?.blockReason;
        throw new Error(
          blockReason
            ? `Gemini returned no text (blockReason=${blockReason})`
            : "Gemini returned no text"
        );
      }

      logger.log(
        `[llm] Gemini request completed - model=${model} durationMs=${Date.now() - startedAt} outputChars=${text.length}`
      );

      return {
        text,
        finishReason: payload?.candidates?.[0]?.finishReason || null,
        usageMetadata: payload?.usageMetadata || null
      };
    }
  };
}
