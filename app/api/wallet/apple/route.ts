import { authorizeRequest } from "../../../../lib/auth-authorization";
import { findEventById, findTicketById } from "../../../../lib/store";
import { recordOperationalEvent } from "../../../../lib/operations-monitor";

export async function GET(request: Request) {
  if (!await authorizeRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticketId = new URL(request.url).searchParams.get("ticket") ?? "";
  if (!/^[A-Za-z0-9-]{3,120}$/.test(ticketId)) return Response.json({ error: "Invalid ticket" }, { status: 400 });
  const signerUrl = process.env.APPLE_WALLET_SIGNER_URL; const signerKey = process.env.APPLE_WALLET_SIGNER_KEY;
  if (!signerUrl || !signerKey) return Response.json({ error: "Apple Wallet is not configured. Add the Apple Pass Type certificate and signer service credentials." }, { status: 503 });
  const ticket = await findTicketById(ticketId); if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const event = await findEventById(ticket.eventId); if (!event) return Response.json({ error: "Event not found" }, { status: 404 });
  try {
    const response = await fetch(signerUrl, { method: "POST", headers: { authorization: `Bearer ${signerKey}`, "content-type": "application/json" }, body: JSON.stringify({
      serialNumber: `${ticket.id}-v${ticket.version}`, description: event.ticketTheme.ticketTitle, organizationName: event.ticketTheme.brandName,
      logoText: event.ticketTheme.brandName, foregroundColor: "rgb(255,255,255)", backgroundColor: event.ticketTheme.primaryColour,
      barcode: { format: "PKBarcodeFormatQR", message: ticket.token, messageEncoding: "iso-8859-1" },
      eventTicket: { primaryFields: [{ key: "event", label: "EVENT", value: event.name }], secondaryFields: [{ key: "venue", label: "VENUE", value: event.venue }, { key: "zone", label: "ZONE", value: ticket.zoneName }], auxiliaryFields: [{ key: "entry", label: "ENTRY", value: `${event.entryWindowStart}–${event.entryWindowEnd}` }, { key: "remaining", label: "ADMISSIONS", value: ticket.remainingEntries }] },
    }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Signer returned ${response.status}`);
    return new Response(response.body, { headers: { "content-type": "application/vnd.apple.pkpass", "content-disposition": `attachment; filename="${ticket.id}.pkpass"`, "cache-control": "private, no-store" } });
  } catch (error) {
    void recordOperationalEvent("apple-wallet", "warning", "Apple Wallet pass generation failed", { ticketId, reason: error instanceof Error ? error.message : "unknown" }).catch(() => undefined);
    return Response.json({ error: "Apple Wallet pass could not be generated" }, { status: 502 });
  }
}
