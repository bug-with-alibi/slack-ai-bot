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
