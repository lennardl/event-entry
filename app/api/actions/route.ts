import { z } from "zod";
import { DatabaseConfigurationError } from "../../../db";
import { isAuthenticatedRequest, isSameOriginRequest } from "../../../lib/auth";
import { consumeTicket, createEvent, createGateAccessLink, findTicketsByNric, importTickets, regenerateTicket, revokeGateAccessLink, updateTicketTheme } from "../../../lib/store";

const eventIdSchema = z.string().trim().min(1).max(80).regex(/^evt-[a-zA-Z0-9-]+$/);

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
  eventId: eventIdSchema,
  nric: z.string().trim().toUpperCase().regex(/^[STFGM]\d{7}[A-Z]$/),
});

const regenerateSchema = z.object({
  action: z.literal("regenerate"),
  ticketId: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().min(1),
});

const importSchema = z.object({
  action: z.literal("import"),
  eventId: eventIdSchema,
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

const createGateAccessSchema = z.object({ action: z.literal("createGateAccess"), eventId: eventIdSchema, gateId: z.string().trim().min(1).max(80) });
const revokeGateAccessSchema = z.object({ action: z.literal("revokeGateAccess"), accessId: z.string().uuid() });
const colourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
function contrastWithWhite(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  return 1.05 / (luminance + .05);
}
const updateTicketThemeSchema = z.object({
  action: z.literal("updateTicketTheme"), eventId: eventIdSchema,
  brandName: z.string().trim().min(2).max(50),
  ticketTitle: z.string().trim().min(3).max(80),
  instructions: z.string().trim().min(10).max(300),
  primaryColour: colourSchema, accentColour: colourSchema,
}).refine((value) => contrastWithWhite(value.primaryColour) >= 4.5, { message: "Primary colour needs stronger contrast with white text", path: ["primaryColour"] });
const createEventSchema = z.object({
  action: z.literal("createEvent"),
  name: z.string().trim().min(3).max(120),
  venue: z.string().trim().min(2).max(120),
  status: z.enum(["draft", "live", "closed"]),
  capacity: z.number().int().min(1).max(250_000),
  entryWindowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  entryWindowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).refine((value) => value.entryWindowEnd > value.entryWindowStart, { message: "Entry end time must be after start time", path: ["entryWindowEnd"] });

const actionSchema = z.discriminatedUnion("action", [scanSchema, lookupSchema, regenerateSchema, importSchema, createGateAccessSchema, revokeGateAccessSchema, createEventSchema, updateTicketThemeSchema]);

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
        return json({ tickets: await findTicketsByNric(body.nric, body.eventId) });
      case "regenerate":
        return json({ result: await regenerateTicket(body.ticketId, body.expectedVersion, operator) });
      case "import":
        return json(await importTickets(body.rows, body.eventId, operator));
      case "createGateAccess":
        return json({ access: await createGateAccessLink(body.gateId, body.eventId, operator) });
      case "revokeGateAccess":
        return json({ revoked: await revokeGateAccessLink(body.accessId, operator) });
      case "createEvent":
        return json({ event: await createEvent(body, operator) }, { status: 201 });
      case "updateTicketTheme":
        return json({ updated: await updateTicketTheme(body.eventId, body, operator) });
    }
  } catch (error) {
    console.error("Action request failed", error);
    const databaseError = error instanceof DatabaseConfigurationError;
    return json({ error: databaseError ? error.message : "Action failed" }, { status: databaseError ? 503 : 500 });
  }
}
