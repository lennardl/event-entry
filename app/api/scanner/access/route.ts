import { DatabaseConfigurationError } from "../../../../db";
import { getGateAccess } from "../../../../lib/store";

export async function GET(request: Request) {
  const token = request.headers.get("x-gate-access") ?? "";
  if (!token || token.length > 256) return Response.json({ error: "Scanner access has expired" }, { status: 401 });
  try {
    const access = await getGateAccess(token);
    if (!access) return Response.json({ error: "Scanner access has expired or was revoked" }, { status: 401 });
    return Response.json({ access }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) {
    const databaseError = error instanceof DatabaseConfigurationError;
    return Response.json({ error: databaseError ? error.message : "Scanner access could not be checked" }, { status: databaseError ? 503 : 500 });
  }
}
