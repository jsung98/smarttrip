import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE_NAME = "smarttrip-auth";
const SESSION_VERSION = 1;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export interface AuthUser {
  id: string;
  name: string;
  imageUrl?: string;
}

interface SessionPayload {
  v: number;
  sub: string;
  name: string;
  imageUrl?: string;
  iat: number;
  exp: number;
}

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) return null;
  return secret;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createAuthSession(user: AuthUser): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const now = Date.now();
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    sub: user.id,
    name: user.name,
    imageUrl: user.imageUrl,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue(encoded, secret);
  return `${encoded}.${signature}`;
}

export function parseAuthSession(rawValue: string | undefined): AuthUser | null {
  if (!rawValue) return null;
  const secret = getSessionSecret();
  if (!secret) return null;

  const [encoded, signature] = rawValue.split(".");
  if (!encoded || !signature) return null;

  const expected = signValue(encoded, secret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as Partial<SessionPayload>;
    if (payload.v !== SESSION_VERSION) return null;
    if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
    if (typeof payload.name !== "string" || !payload.name.trim()) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return {
      id: payload.sub,
      name: payload.name,
      imageUrl: typeof payload.imageUrl === "string" && payload.imageUrl.trim() ? payload.imageUrl : undefined,
    };
  } catch {
    return null;
  }
}
