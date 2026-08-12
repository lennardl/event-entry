import { DatabaseConfigurationError } from "../../../../db";
import { findEventById, findTicketByToken } from "../../../../lib/store";
import { distributedRateLimit, requestClient } from "../../../../lib/rate-limit";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const rate = await distributedRateLimit("public-ticket", requestClient(_request), 120, 60);
    if (!rate.allowed) return Response.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": String(rate.retryAfter) } });
    const { token } = await context.params;
    if (token.length > 256) return Response.json({ error: "Ticket not found" }, { status: 404 });
    const ticket = await findTicketByToken(token);
    if (!ticket || ticket.status !== "active") return Response.json({ error: "Ticket not found" }, { status: 404 });
    const event = await findEventById(ticket.eventId);
    if (!event) return Response.json({ error: "Ticket not found" }, { status: 404 });
    const citizenTicket = {
      id: ticket.id,
      zoneName: ticket.zoneName,
      zoneColour: ticket.zoneColour,
      maxEntries: ticket.maxEntries,
      remainingEntries: ticket.remainingEntries,
      version: ticket.version,
      token: ticket.token,
    };
    return Response.json({ ticket: citizenTicket, event }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  } catch (error) {
    console.error("Ticket request failed", error);
    const status = error instanceof DatabaseConfigurationError ? 503 : 500;
    return Response.json({ error: status === 503 ? "Ticket service is not configured" : "Ticket could not be loaded" }, { status, headers: { "cache-control": "private, no-store" } });
  }
}
