import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "event_entry_session";
const SESSION_MESSAGE = "event-entry-operations-session-v1";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

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
  const payload = `${Math.floor(Date.now() / 1000)}.${randomBytes(18).toString("base64url")}`;
  const signature = createHmac("sha256", key).update(`${SESSION_MESSAGE}.${payload}`).digest("base64url");
  return `${payload}.${signature}`;
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
  if (!cookie) return null;
  try { return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)); } catch { return null; }
}

export function isAuthenticatedRequest(request: Request) {
  const key = configuredAccessKey();
  const supplied = sessionFromCookieHeader(request.headers.get("cookie"));
  if (!key || !supplied || supplied.length > 256) return false;
  const parts = supplied.split(".");
  if (parts.length !== 3) return false;
  const [issuedAtText, nonce, signature] = parts;
  if (!/^\d{10}$/.test(issuedAtText) || !/^[A-Za-z0-9_-]{24}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const issuedAt = Number(issuedAtText);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + MAX_CLOCK_SKEW_SECONDS || now - issuedAt > SESSION_TTL_SECONDS) return false;
  const payload = `${issuedAtText}.${nonce}`;
  const expected = createHmac("sha256", key).update(`${SESSION_MESSAGE}.${payload}`).digest("base64url");
  return safeEqual(signature, expected);
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
