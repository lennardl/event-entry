import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "event_entry_session";
const SESSION_MESSAGE = "event-entry-operations-session-v1";

function configuredAccessKey() {
  const key = process.env.APP_ACCESS_KEY;
  return key && key.length >= 32 ? key : null;
}

export function isAccessControlConfigured() {
  return Boolean(configuredAccessKey());
}

export function sessionToken() {
  const key = configuredAccessKey();
  if (!key) return null;
  return createHmac("sha256", key).update(SESSION_MESSAGE).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function verifyAccessKey(candidate: string) {
  const key = configuredAccessKey();
  return Boolean(key && candidate && safeEqual(candidate, key));
}

export function sessionFromCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : null;
}

export function isAuthenticatedRequest(request: Request) {
  const expected = sessionToken();
  const supplied = sessionFromCookieHeader(request.headers.get("cookie"));
  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originUrl: URL;
  try { originUrl = new URL(origin); } catch { return false; }
  const requestUrl = new URL(request.url);
  const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? requestUrl.host;
  const expectedProtocol = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
  return originUrl.host === expectedHost && originUrl.protocol === `${expectedProtocol}:`;
}
