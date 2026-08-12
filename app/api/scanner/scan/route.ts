import { z } from "zod";
import { DatabaseConfigurationError } from "../../../../db";
import { consumeTicket, getGateAccess } from "../../../../lib/store";

const schema = z.object({ token: z.string().trim().min(16).max(256), quantity: z.number().int().min(1).max(6), requestId: z.string().uuid() });
const MAX_BODY_BYTES = 2048;

function json(data: unknown, init?: ResponseInit) {
  const response = Response.json(data, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Scanner request is too large" }, { status: 413 });
    const accessToken = request.headers.get("x-gate-access") ?? "";
    if (accessToken.length < 32 || accessToken.length > 256) return json({ error: "Scanner access has expired" }, { status: 401 });
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: "Scanner request is too large" }, { status: 413 });
    let decoded: unknown;
    try { decoded = JSON.parse(rawBody); } catch { return json({ error: "Invalid scanner request" }, { status: 400 }); }
    const body = schema.safeParse(decoded);
    if (!body.success) return json({ error: "Invalid scanner request" }, { status: 400 });
    const access = await getGateAccess(accessToken);
    if (!access) return json({ error: "Scanner access has expired or was revoked" }, { status: 401 });
    const result = await consumeTicket({ token: body.data.token, quantity: body.data.quantity, gateId: access.gateId, mode: "online", requestId: body.data.requestId, operator: `Gate scanner (${access.gateName})` });
    return json(result);
  } catch (error) {
    const databaseError = error instanceof DatabaseConfigurationError;
    return json({ error: databaseError ? error.message : "Scan failed" }, { status: databaseError ? 503 : 500 });
  }
}
