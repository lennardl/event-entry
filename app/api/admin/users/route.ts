import { z } from "zod";
import { isSameOriginRequest } from "../../../../lib/auth";
import { authorizeRequest } from "../../../../lib/auth-authorization";
import { listUsers, loginHistory, updateUser } from "../../../../lib/auth-users";

const schema = z.object({ email: z.string().email(), role: z.enum(["Super Admin", "Admin", "Gate Supervisor", "Command Centre Viewer"]).optional(), enabled: z.boolean().optional(), revokeSessions: z.boolean().optional() });
export async function GET(request: Request) {
  if ((await authorizeRequest(request))?.role !== "Super Admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ users: await listUsers(), loginHistory: await loginHistory() }, { headers: { "cache-control": "private, no-store" } });
}
export async function PATCH(request: Request) {
  const actor = await authorizeRequest(request); if (actor?.role !== "Super Admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const body = schema.safeParse(await request.json().catch(() => null)); if (!body.success) return Response.json({ error: "Invalid user update" }, { status: 400 });
  if (actor.email === body.data.email.toLowerCase() && body.data.enabled === false) return Response.json({ error: "You cannot disable your own account" }, { status: 409 });
  const rows = await updateUser(body.data.email, body.data);
  return Response.json({ user: (rows as unknown as Array<Record<string, unknown>>)[0] });
}
