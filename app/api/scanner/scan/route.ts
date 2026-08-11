import { z } from "zod";
import { DatabaseConfigurationError } from "../../../../db";
import { consumeTicket, getGateAccess } from "../../../../lib/store";

const schema = z.object({ access: z.string().min(32).max(256), token: z.string().trim().min(16).max(256), quantity: z.number().int().min(1).max(6), requestId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const body = schema.safeParse(await request.json());
    if (!body.success) return Response.json({ error: "Invalid scanner request" }, { status: 400 });
    const access = await getGateAccess(body.data.access);
    if (!access) return Response.json({ error: "Scanner access has expired or was revoked" }, { status: 401 });
    const result = await consumeTicket({ token: body.data.token, quantity: body.data.quantity, gateId: access.gateId, mode: "online", requestId: body.data.requestId, operator: `Gate scanner (${access.gateName})` });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const databaseError = error instanceof DatabaseConfigurationError;
    return Response.json({ error: databaseError ? error.message : "Scan failed" }, { status: databaseError ? 503 : 500 });
  }
}
