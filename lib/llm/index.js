import { createGeminiClient } from "./gemini.js";

const DEFAULT_PROVIDER = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function getLlmProviderName() {
  return process.env.LLM_PROVIDER || DEFAULT_PROVIDER;
}

export function getMissingLlmEnvVars() {
  const provider = getLlmProviderName();

  if (provider === "gemini") {
    return process.env.GEMINI_API_KEY ? [] : ["GEMINI_API_KEY"];
  }

  return [];
}

export function createLlmClient({ logger = console } = {}) {
  const provider = getLlmProviderName();

  if (provider === "gemini") {
    return createGeminiClient({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      logger
    });
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
