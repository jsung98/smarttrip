export function getSupabaseEnv() {
  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !key) return null;
  let url = rawUrl.trim();
  url = url.replace(/\/rest\/v1\/?$/i, "");
  url = url.replace(/\/+$/, "");
  return { url, key };
}

export function getShareTtlDays(): number {
  const raw = process.env.SHARE_TTL_DAYS;
  const parsed = raw ? Number(raw) : 30;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.floor(parsed);
}

export async function supabaseRequest(path: string, init: RequestInit) {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase env is not configured.");

  const res = await fetch(`${env.url}${path}`, {
    ...init,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
      "Accept-Profile": "public",
      "Content-Profile": "public",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }

  return res;
}
