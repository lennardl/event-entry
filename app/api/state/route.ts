import { DatabaseConfigurationError } from "../../../db";
import { isAuthenticatedRequest } from "../../../lib/auth";
import { getState } from "../../../lib/store";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const response = Response.json(await getState());
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    console.error("State request failed", error);
    const databaseError = error instanceof DatabaseConfigurationError;
    return Response.json({ error: databaseError ? error.message : "Unable to load event state" }, { status: databaseError ? 503 : 500, headers: { "cache-control": "private, no-store" } });
  }
}
