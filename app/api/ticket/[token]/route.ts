import { findTicketByToken, getState } from "../../../../lib/store";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const [ticket, state] = await Promise.all([findTicketByToken(decodeURIComponent(token)), getState()]);
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json({ ticket, event: state.event });
}
