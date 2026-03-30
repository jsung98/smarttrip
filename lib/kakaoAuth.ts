import type { AuthUser } from "@/lib/auth/session";

const KAKAO_AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize";
const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const KAKAO_ME_URL = "https://kapi.kakao.com/v2/user/me";

export function getKakaoAuthEnv() {
  const clientId = process.env.KAKAO_REST_API_KEY?.trim();
  const redirectUri = process.env.KAKAO_REDIRECT_URI?.trim();
  const clientSecret = process.env.KAKAO_CLIENT_SECRET?.trim();
  if (!clientId || !redirectUri) return null;
  return { clientId, redirectUri, clientSecret };
}

export function getKakaoAuthorizeUrl(state?: string) {
  const env = getKakaoAuthEnv();
  if (!env) return null;
  const url = new URL(KAKAO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeKakaoCode(code: string) {
  const env = getKakaoAuthEnv();
  if (!env) throw new Error("Kakao auth env is not configured.");

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", env.clientId);
  body.set("redirect_uri", env.redirectUri);
  body.set("code", code);
  if (env.clientSecret) {
    body.set("client_secret", env.clientSecret);
  }

  const res = await fetch(KAKAO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kakao token exchange failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Kakao token exchange did not return an access token.");
  }

  return json.access_token;
}

export async function fetchKakaoUser(accessToken: string): Promise<AuthUser> {
  const res = await fetch(KAKAO_ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kakao user fetch failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    id?: number | string;
    properties?: { nickname?: string; profile_image?: string };
    kakao_account?: { profile?: { nickname?: string; profile_image_url?: string } };
  };

  const id = typeof json.id === "number" || typeof json.id === "string" ? String(json.id) : "";
  const name =
    json.kakao_account?.profile?.nickname?.trim() ||
    json.properties?.nickname?.trim() ||
    "";
  const imageUrl =
    json.kakao_account?.profile?.profile_image_url?.trim() ||
    json.properties?.profile_image?.trim() ||
    undefined;

  if (!id || !name) {
    throw new Error("Kakao user profile is missing required fields.");
  }

  return { id, name, imageUrl };
}
