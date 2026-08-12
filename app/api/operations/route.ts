import { authorizeRequest } from "../../../lib/auth-authorization";
import { recentOperationalEvents } from "../../../lib/operations-monitor";

export async function GET(request: Request) {
  if ((await authorizeRequest(request))?.role !== "Super Admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ events: await recentOperationalEvents() }, { headers: { "cache-control": "private, no-store" } });
}
