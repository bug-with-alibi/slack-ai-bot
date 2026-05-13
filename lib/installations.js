function getInstallationKey({ teamId, enterpriseId }) {
  return teamId || enterpriseId || null;
}

function buildScopedInstallationKey({ appId, workspaceKey }) {
  if (!appId || !workspaceKey) {
    throw new Error("Installation is missing appId or workspaceKey");
  }

  return `${appId}:${workspaceKey}`;
}

function normalizeInstallation(installation) {
  const workspaceKey = getInstallationKey(installation);

  if (!workspaceKey) {
    throw new Error("Installation is missing both teamId and enterpriseId");
  }

  if (!installation.appId) {
    throw new Error("Installation is missing appId");
  }

  return {
    installationKey: buildScopedInstallationKey({
      appId: installation.appId,
      workspaceKey
    }),
    workspaceKey,
    ...installation,
    installedAt: new Date().toISOString()
  };
}

function mapSupabaseRowToInstallation(row) {
  if (!row) {
    return null;
  }

  return {
    installationKey: row.installation_key,
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

function buildSupabaseInstallationLookupPath({ appId, teamId, enterpriseId }) {
  const workspaceFilter = teamId
    ? ["team_id", teamId]
    : enterpriseId
      ? ["enterprise_id", enterpriseId]
      : null;

  if (!workspaceFilter) {
    return null;
  }

  const params = new URLSearchParams({
    app_id: `eq.${appId}`,
    [workspaceFilter[0]]: `eq.${workspaceFilter[1]}`,
    select: "*",
    limit: "1"
  });

  return `/rest/v1/slack_installations?${params.toString()}`;
}

export function createInstallationStore({
  callSupabase,
  logger = console
}) {
  if (typeof callSupabase !== "function") {
    throw new Error("Supabase installation store requires callSupabase");
  }

  return {
    async ensureReady() {
      await callSupabase("/rest/v1/slack_installations?select=installation_key&limit=1");
    },
    async save(installation) {
      const normalized = normalizeInstallation(installation);
      const rows = await callSupabase(
        "/rest/v1/slack_installations?on_conflict=installation_key&select=*",
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify({
            installation_key: normalized.installationKey,
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
    },
    async getBySlackContext({ appId, teamId, enterpriseId }) {
      if (!appId) {
        return null;
      }

      const lookupPath = buildSupabaseInstallationLookupPath({
        appId,
        teamId,
        enterpriseId
      });

      if (!lookupPath) {
        return null;
      }

      const rows = await callSupabase(lookupPath);

      return mapSupabaseRowToInstallation(rows?.[0]);
    },
    async count() {
      const rows = await callSupabase(
        "/rest/v1/slack_installations?select=workspace_key"
      );

      return rows.length;
    }
  };
}
