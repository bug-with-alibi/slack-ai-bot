import {
  createLlmClient,
  getLlmProviderName,
  getMissingLlmEnvVars
} from "./llm/index.js";
import { getMemoryConfig } from "./memory/index.js";

export const requiredSlackEnvVars = [
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_SIGNING_SECRET",
  "SLACK_REDIRECT_URI"
];

export const requiredSupabaseEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
];

export function createConfig({ baseDir, logger = console }) {
  const port = Number(process.env.PORT || 3000);
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") || null;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  const slackScopes =
    process.env.SLACK_SCOPES || "app_mentions:read,chat:write";
  const llmProvider = getLlmProviderName();
  const llmMissingEnvVars = getMissingLlmEnvVars();
  const llmClient =
    llmMissingEnvVars.length === 0 ? createLlmClient({ logger }) : null;
  const memoryConfig = getMemoryConfig();

  return {
    baseDir,
    port,
    supabaseUrl,
    supabaseServiceRoleKey,
    slackScopes,
    llmProvider,
    llmMissingEnvVars,
    llmClient,
    memoryConfig,
    requiredSlackEnvVars,
    requiredSupabaseEnvVars
  };
}
