import { NextResponse } from "next/server";
import { isAccessControlConfigured, isSameOriginRequest, SESSION_COOKIE, sessionToken, verifyAccessKey } from "../../../lib/auth";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function rateLimit(request: Request) {
  const now = Date.now();
  if (attempts.size > 1000) {
    for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
  }
  const key = clientKey(request);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS ? Math.ceil((current.resetAt - now) / 1000) : null;
}

export async function POST(request: Request) {
  if (!isAccessControlConfigured()) {
    return NextResponse.json({ error: "APP_ACCESS_KEY is not configured" }, { status: 503 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const retryAfter = rateLimit(request);
  if (retryAfter) return NextResponse.json({ error: "Too many sign-in attempts" }, { status: 429, headers: { "retry-after": String(retryAfter) } });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 4096) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  let body: { accessKey?: unknown } | null = null;
  try { body = JSON.parse(rawBody) as { accessKey?: unknown }; } catch { body = null; }
  if (!verifyAccessKey(typeof body?.accessKey === "string" ? body.accessKey : "")) {
    return NextResponse.json({ error: "Invalid access key" }, { status: 401 });
  }
  attempts.delete(clientKey(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken()!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
