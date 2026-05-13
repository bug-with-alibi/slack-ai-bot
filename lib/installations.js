import fs from "fs/promises";
import path from "path";

function getInstallationKey({ teamId, enterpriseId }) {
  return teamId || enterpriseId || null;
}

function normalizeInstallation(installation) {
  const workspaceKey = getInstallationKey(installation);

  if (!workspaceKey) {
    throw new Error("Installation is missing both teamId and enterpriseId");
  }

  return {
    workspaceKey,
    ...installation,
    installedAt: new Date().toISOString()
  };
}

async function ensureFileStore(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify({}, null, 2));
  }
}

async function readFileInstallations(filePath) {
  await ensureFileStore(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw || "{}");
}

async function writeFileInstallations(filePath, installations) {
  await ensureFileStore(filePath);
  await fs.writeFile(filePath, JSON.stringify(installations, null, 2));
}

function mapSupabaseRowToInstallation(row) {
  if (!row) {
    return null;
  }

  return {
    workspaceKey: row.workspace_key,
    appId: row.app_id,
    teamId: row.team_id,
    teamName: row.team_name,
    enterpriseId: row.enterprise_id,
    enterpriseName: row.enterprise_name,
    botToken: row.bot_token,
    botUserId: row.bot_user_id,
    scope: row.scope,
    authedUserId: row.authed_user_id,
    installedAt: row.installed_at
  };
}

export function createInstallationStore({
  backend,
  filePath,
  callSupabase,
  logger = console
}) {
  if (backend === "supabase" && typeof callSupabase !== "function") {
    throw new Error("Supabase installation store requires callSupabase");
  }

  return {
    backend,
    async ensureReady() {
      if (backend === "file") {
        await ensureFileStore(filePath);
      }
    },
    async save(installation) {
      const normalized = normalizeInstallation(installation);

      if (backend === "supabase") {
        const rows = await callSupabase(
          "/rest/v1/slack_installations?on_conflict=workspace_key&select=*",
          {
            method: "POST",
            headers: {
              Prefer: "resolution=merge-duplicates,return=representation"
            },
            body: JSON.stringify({
              workspace_key: normalized.workspaceKey,
              app_id: normalized.appId,
              team_id: normalized.teamId,
              team_name: normalized.teamName,
              enterprise_id: normalized.enterpriseId,
              enterprise_name: normalized.enterpriseName,
              bot_token: normalized.botToken,
              bot_user_id: normalized.botUserId,
              scope: normalized.scope,
              authed_user_id: normalized.authedUserId,
              installed_at: normalized.installedAt
            })
          }
        );

        const savedInstallation = mapSupabaseRowToInstallation(rows?.[0]);
        logger.log(
          `[installations] saved installation - backend=supabase workspaceKey=${normalized.workspaceKey}`
        );
        return savedInstallation;
      }

      const installations = await readFileInstallations(filePath);
      installations[normalized.workspaceKey] = normalized;
      await writeFileInstallations(filePath, installations);
      logger.log(
        `[installations] saved installation - backend=file workspaceKey=${normalized.workspaceKey}`
      );

      return installations[normalized.workspaceKey];
    },
    async getByTeamId(teamId) {
      if (backend === "supabase") {
        const rows = await callSupabase(
          `/rest/v1/slack_installations?team_id=eq.${encodeURIComponent(teamId)}&select=*&limit=1`
        );

        return mapSupabaseRowToInstallation(rows?.[0]);
      }

      const installations = await readFileInstallations(filePath);
      return installations[teamId] || null;
    },
    async count() {
      if (backend === "supabase") {
        const rows = await callSupabase(
          "/rest/v1/slack_installations?select=workspace_key"
        );

        return rows.length;
      }

      const installations = await readFileInstallations(filePath);
      return Object.keys(installations).length;
    }
  };
}
