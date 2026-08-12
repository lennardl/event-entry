import { NextResponse } from "next/server";
import { isSameOriginRequest, SESSION_COOKIE, sessionToken } from "../../../lib/auth";
import { createPostmanEmailProvider } from "../../../lib/email";
import { isAllowedGovernmentEmail, normaliseEmail } from "../../../lib/auth-email";
import { attachProviderMessage, consumeLoginCode, createLoginCode, revokeLoginCode } from "../../../lib/login-codes";
import { recordLogin, resolveLoginUser } from "../../../lib/auth-users";

const MAX_BODY_BYTES = 4096;
const GENERIC_MESSAGE = "If that address is eligible, an 8-digit sign-in code is on its way.";

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function jsonBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try { return JSON.parse(raw) as { email?: unknown; code?: unknown }; } catch { return null; }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (typeof body.code === "string") {
    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    const identity = await consumeLoginCode(email, body.code);
    if (!identity) { void recordLogin(email, false, "invalid_code").catch(() => undefined); return NextResponse.json({ error: "The code is incorrect or has expired." }, { status: 401 }); }
    const user = await resolveLoginUser(identity.email);
    if (!user.enabled) { void recordLogin(email, false, "disabled").catch(() => undefined); return NextResponse.json({ error: "This account is disabled." }, { status: 403 }); }
    void recordLogin(email, true, "code_verified").catch(() => undefined);
    const response = NextResponse.json({ ok: true, role: user.role });
    response.cookies.set(SESSION_COOKIE, sessionToken(user.role, user.email, user.sessionVersion)!, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60, priority: "high",
    });
    return response;
  }

  const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
  if (!isAllowedGovernmentEmail(email)) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });

  let loginCode: Awaited<ReturnType<typeof createLoginCode>> = null;
  try {
    loginCode = await createLoginCode(email, clientAddress(request));
    if (!loginCode) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    const result = await createPostmanEmailProvider().send({
      to: email,
      subject: `${loginCode.code} is your Event Entry sign-in code`,
      text: `Your Event Entry sign-in code is ${loginCode.code}. It expires in ${loginCode.expiresInMinutes} minutes and can only be used once.`,
      html: `<p>Your Event Entry sign-in code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${loginCode.code}</p><p>This code expires in ${loginCode.expiresInMinutes} minutes and can only be used once.</p>`,
    });
    await attachProviderMessage(loginCode.id, result.messageId);
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (error) {
    if (loginCode) await revokeLoginCode(loginCode.id).catch(() => undefined);
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
