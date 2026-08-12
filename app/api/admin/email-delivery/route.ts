import { isSameOriginRequest } from "../../../../lib/auth";
import { authorizeRequest } from "../../../../lib/auth-authorization";
import { createPostmanEmailProvider } from "../../../../lib/email";
import { pendingEmailDeliveries, updateEmailDelivery } from "../../../../lib/login-codes";
import { recordOperationalEvent } from "../../../../lib/operations-monitor";

export async function GET(request: Request) {
  if ((await authorizeRequest(request))?.role !== "Super Admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ deliveries: await pendingEmailDeliveries() }, { headers: { "cache-control": "private, no-store" } });
}
export async function POST(request: Request) {
  if ((await authorizeRequest(request))?.role !== "Super Admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const deliveries = (await pendingEmailDeliveries()) as unknown as Array<{ id: string; messageId: string; status: string | null }>;
  const provider = createPostmanEmailProvider(); let checked = 0;
  for (const delivery of deliveries.filter((item) => !["DELIVERED", "OPENED", "BOUNCED", "COMPLAINT"].includes(item.status ?? "")).slice(0, 20)) {
    try { const result = await provider.getStatus(delivery.messageId); await updateEmailDelivery(delivery.id, result.status, result.errorCode); checked += 1;
      if (["BOUNCED", "COMPLAINT"].includes(result.status)) void recordOperationalEvent("email", "warning", `Login email ${result.status.toLowerCase()}`, { messageId: delivery.messageId, error: result.errorCode }).catch(() => undefined);
    } catch { /* Preserve last provider state and try again later. */ }
  }
  return Response.json({ checked });
}
