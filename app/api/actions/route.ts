import { consumeTicket, findTicketsByNric, importTickets, regenerateTicket } from "../../../lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case "scan":
        return Response.json(await consumeTicket({
          token: String(body.token ?? ""),
          quantity: Number(body.quantity ?? 1),
          gateId: String(body.gateId ?? "gate-a"),
          mode: body.mode === "offline" || body.mode === "manual" ? body.mode : "online",
          operator: String(body.operator ?? "Gate operator"),
          requestId: body.requestId ? String(body.requestId) : undefined,
        }));
      case "lookup":
        return Response.json({ tickets: await findTicketsByNric(String(body.nric ?? "")) });
      case "regenerate":
        return Response.json({ result: await regenerateTicket(String(body.ticketId ?? ""), String(body.actor ?? "Admin")) });
      case "import":
        return Response.json(await importTickets(Array.isArray(body.rows) ? body.rows as Parameters<typeof importTickets>[0] : []));
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Action failed" }, { status: 500 });
  }
}
