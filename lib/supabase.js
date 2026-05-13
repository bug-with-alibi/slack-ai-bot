export function createSupabaseClient({ url, serviceRoleKey }) {
  return {
    url,
    serviceRoleKey,
    enabled: Boolean(url && serviceRoleKey),
    async call(pathname, options = {}) {
      const response = await fetch(`${url}${pathname}`, {
        ...options,
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase request failed (${response.status}): ${body}`);
      }

      if (response.status === 204) {
        return null;
      }

      return response.json();
    }
  };
}
