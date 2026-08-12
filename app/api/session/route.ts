import { NextResponse } from "next/server";
import { isSameOriginRequest, SESSION_COOKIE, sessionToken } from "../../../lib/auth";
import { createPostmanEmailProvider, escapeHtml } from "../../../lib/email";
import { isAllowedGovernmentEmail, normaliseEmail } from "../../../lib/auth-email";
import { attachProviderMessage, consumeMagicLink, createMagicLink, revokeMagicLink } from "../../../lib/magic-links";

const MAX_BODY_BYTES = 4096;
const GENERIC_MESSAGE = "If that address is eligible, a secure sign-in link is on its way.";

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function jsonBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try { return JSON.parse(raw) as { email?: unknown; token?: unknown }; } catch { return null; }
}

function applicationOrigin(request: Request) {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const url = new URL(configured ?? request.url);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("APP_URL must use HTTPS in production");
  return url.origin;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (typeof body.token === "string") {
    const identity = await consumeMagicLink(body.token);
    if (!identity) return NextResponse.json({ error: "This sign-in link is invalid or has expired." }, { status: 401 });
    const response = NextResponse.json({ ok: true, role: identity.role });
    response.cookies.set(SESSION_COOKIE, sessionToken(identity.role, identity.email)!, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60, priority: "high",
    });
    return response;
  }

  const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
  if (!isAllowedGovernmentEmail(email)) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });

  let link: Awaited<ReturnType<typeof createMagicLink>> = null;
  try {
    link = await createMagicLink(email, clientAddress(request));
    if (!link) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    const verifyUrl = new URL("/login/verify", applicationOrigin(request));
    verifyUrl.searchParams.set("token", link.token);
    const safeUrl = escapeHtml(verifyUrl.toString());
    const result = await createPostmanEmailProvider().send({
      to: email,
      subject: "Sign in to Event Entry",
      text: `Use this secure link to sign in: ${verifyUrl.toString()}\n\nIt expires in ${link.expiresInMinutes} minutes and can only be used once.`,
      html: `<p>Use the secure link below to sign in to Event Entry.</p><p><a href="${safeUrl}">Continue to Event Entry</a></p><p>This link expires in ${link.expiresInMinutes} minutes and can only be used once.</p>`,
    });
    await attachProviderMessage(link.id, result.messageId);
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (error) {
    if (link) await revokeMagicLink(link.id).catch(() => undefined);
    console.error("Unable to send sign-in email", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Sign-in email is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
