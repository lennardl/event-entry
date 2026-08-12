import { DatabaseConfigurationError } from "../../../../db";
import { getGateAccess, getState } from "../../../../lib/store";

export async function GET(request: Request) {
  const token = request.headers.get("x-gate-access") ?? "";
  if (!token || token.length > 256) return Response.json({ error: "Scanner access has expired" }, { status: 401 });
  try {
    const access = await getGateAccess(token);
    if (!access) return Response.json({ error: "Scanner access has expired or was revoked" }, { status: 401 });
    const state = await getState(access.eventId);
    return Response.json({
      expiresAt: access.expiresAt,
      tickets: state.tickets.map((ticket) => ({ token: ticket.token, id: ticket.id, zoneName: ticket.zoneName, remainingEntries: ticket.remainingEntries, status: ticket.status })),
    }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) {
    const databaseError = error instanceof DatabaseConfigurationError;
    return Response.json({ error: databaseError ? error.message : "Offline pack could not be downloaded" }, { status: databaseError ? 503 : 500 });
  }
}
