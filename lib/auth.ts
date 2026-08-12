import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Role } from "./types";

export const SESSION_COOKIE = "event_entry_session";
const SESSION_MESSAGE = "event-entry-operations-session-v1";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

function configuredSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET ?? process.env.APP_ACCESS_KEY;
  return secret && secret.length >= 32 ? secret : null;
}

export function isAccessControlConfigured() {
  return Boolean(configuredSessionSecret());
}

const roleSlugs: Record<Role, string> = { "Super Admin": "super", "Admin": "admin", "Gate Supervisor": "gate", "Command Centre Viewer": "viewer" };
const slugRoles = Object.fromEntries(Object.entries(roleSlugs).map(([role, slug]) => [slug, role])) as Record<string, Role>;
function configuredKeys(): Array<[Role, string]> { return [["Super Admin", process.env.APP_ACCESS_KEY], ["Admin", process.env.ADMIN_ACCESS_KEY], ["Gate Supervisor", process.env.GATE_SUPERVISOR_ACCESS_KEY], ["Command Centre Viewer", process.env.VIEWER_ACCESS_KEY]].filter((entry): entry is [Role, string] => Boolean(entry[1] && entry[1]!.length >= 32)); }

export function sessionToken(role: Role = "Super Admin", email?: string, sessionVersion = 1) {
  const key = configuredSessionSecret();
  if (!key) return null;
  const identity = email ? `.${Buffer.from(`${email.toLowerCase()}|${sessionVersion}`).toString("base64url")}` : "";
  const payload = `${Math.floor(Date.now() / 1000)}.${randomBytes(18).toString("base64url")}.${roleSlugs[role]}${identity}`;
  const signature = createHmac("sha256", key).update(`${SESSION_MESSAGE}.${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function verifyAccessKey(candidate: string): Role | null {
  if (!candidate) return null;
  return configuredKeys().find(([, key]) => safeEqual(candidate, key))?.[0] ?? null;
}

export function sessionFromCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return null;
  try { return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)); } catch { return null; }
}

export function authenticatedRole(request: Request): Role | null {
  const key = configuredSessionSecret();
  const supplied = sessionFromCookieHeader(request.headers.get("cookie"));
  if (!key || !supplied || supplied.length > 256) return null;
  const parts = supplied.split(".");
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [issuedAtText, nonce, roleSlug] = parts;
  const identity = parts.length === 5 ? parts[3] : null;
  const signature = parts.at(-1)!;
  if (!/^\d{10}$/.test(issuedAtText) || !/^[A-Za-z0-9_-]{24}$/.test(nonce) || !slugRoles[roleSlug] || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  if (identity && (identity.length > 342 || !/^[A-Za-z0-9_-]+$/.test(identity))) return null;
  const issuedAt = Number(issuedAtText);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + MAX_CLOCK_SKEW_SECONDS || now - issuedAt > SESSION_TTL_SECONDS) return null;
  const payload = `${issuedAtText}.${nonce}.${roleSlug}${identity ? `.${identity}` : ""}`;
  const expected = createHmac("sha256", key).update(`${SESSION_MESSAGE}.${payload}`).digest("base64url");
  return safeEqual(signature, expected) ? slugRoles[roleSlug] : null;
}

export function authenticatedIdentity(request: Request) {
  const role = authenticatedRole(request); const token = sessionFromCookieHeader(request.headers.get("cookie"));
  if (!role || !token) return null; const parts = token.split("."); if (parts.length !== 5) return { role, email: null, sessionVersion: null };
  try { const [email, version] = Buffer.from(parts[3], "base64url").toString().split("|"); return email && /^\d+$/.test(version) ? { role, email, sessionVersion: Number(version) } : null; } catch { return null; }
}

export function isAuthenticatedRequest(request: Request) { return Boolean(authenticatedRole(request)); }

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
