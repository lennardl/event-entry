import { z } from "zod";
import { DatabaseConfigurationError } from "../../../db";
import { isAuthenticatedRequest, isSameOriginRequest } from "../../../lib/auth";
import { consumeTicket, findTicketsByNric, importTickets, regenerateTicket } from "../../../lib/store";

const scanSchema = z.object({
  action: z.literal("scan"),
  token: z.string().trim().min(16).max(256),
  quantity: z.number().int().min(1).max(6),
  gateId: z.string().trim().min(1).max(80),
  mode: z.enum(["online", "offline", "manual"]),
  requestId: z.string().uuid().optional(),
});

const lookupSchema = z.object({
  action: z.literal("lookup"),
  nric: z.string().trim().toUpperCase().regex(/^[STFGM]\d{7}[A-Z]$/),
});

const regenerateSchema = z.object({
  action: z.literal("regenerate"),
  ticketId: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().min(1),
});

const importSchema = z.object({
  action: z.literal("import"),
  rows: z.array(z.object({
    nric: z.string().trim().toUpperCase().regex(/^[STFGM]\d{7}[A-Z]$/),
    mobile: z.string().trim().regex(/^\+?[\d ]{8,16}$/),
    quantity: z.number().int().min(1).max(6),
    zoneId: z.string().trim().min(1).max(80),
    format: z.enum(["e-ticket", "physical"]),
  })).min(1).max(1000),
}).refine((value) => value.rows.reduce((total, row) => total + (row.format === "physical" ? row.quantity : 1), 0) <= 5000, {
  message: "An import can create at most 5,000 ticket records",
});

const actionSchema = z.discriminatedUnion("action", [scanSchema, lookupSchema, regenerateSchema, importSchema]);

function json(data: unknown, init?: ResponseInit) {
  const response = Response.json(data, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return json({ error: "Invalid request origin" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000) return json({ error: "Request is too large" }, { status: 413 });

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) return json({ error: "Request is too large" }, { status: 413 });
    let decoded: unknown;
    try { decoded = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = actionSchema.safeParse(decoded);
    if (!parsed.success) return json({ error: "Invalid action payload", issues: parsed.error.issues }, { status: 400 });
    const body = parsed.data;
    const operator = "Authenticated operations user";
    switch (body.action) {
      case "scan":
        return json(await consumeTicket({ ...body, operator }));
      case "lookup":
        return json({ tickets: await findTicketsByNric(body.nric) });
      case "regenerate":
        return json({ result: await regenerateTicket(body.ticketId, body.expectedVersion, operator) });
      case "import":
        return json(await importTickets(body.rows, operator));
    }
  } catch (error) {
    console.error("Action request failed", error);
    const databaseError = error instanceof DatabaseConfigurationError;
    return json({ error: databaseError ? error.message : "Action failed" }, { status: databaseError ? 503 : 500 });
  }
}
