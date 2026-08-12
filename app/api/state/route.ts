import { DatabaseConfigurationError } from "../../../db";
import { isAuthenticatedRequest } from "../../../lib/auth";
import { getState } from "../../../lib/store";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const eventId = new URL(request.url).searchParams.get("eventId") ?? undefined;
    if (eventId && (eventId.length > 80 || !/^evt-[a-zA-Z0-9-]+$/.test(eventId))) return Response.json({ error: "Invalid event" }, { status: 400 });
    const response = Response.json(await getState(eventId));
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    console.error("State request failed", error);
    const databaseError = error instanceof DatabaseConfigurationError;
    return Response.json({ error: databaseError ? error.message : "Unable to load event state" }, { status: databaseError ? 503 : 500, headers: { "cache-control": "private, no-store" } });
  }
}
