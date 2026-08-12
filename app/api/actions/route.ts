import { z } from "zod";
import { DatabaseConfigurationError } from "../../../db";
import { isSameOriginRequest } from "../../../lib/auth";
import { authorizeRequest } from "../../../lib/auth-authorization";
import { distributedRateLimit, requestClient } from "../../../lib/rate-limit";
import { consumeTicket, createEvent, createGate, createGateAccessLink, createTicket, createZone, deleteGate, deleteZone, duplicateEvent, findTicketsByNric, importTickets, regenerateTicket, restoreEvent, revokeAllGateAccess, revokeGateAccessLink, setEventStatus, softDeleteEvent, updateEvent, updateGate, updateTicketPolicy, updateTicketTheme, updateZone } from "../../../lib/store";

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
const createTicketSchema = z.object({
  action: z.literal("createTicket"), eventId: eventIdSchema,
  nric: z.string().trim().toUpperCase().regex(/^[STFGM]\d{7}[A-Z]$/),
  mobile: z.string().trim().regex(/^\+?[\d ]{8,16}$/), quantity: z.number().int().min(1).max(6),
  zoneId: z.string().trim().min(1).max(80), format: z.enum(["e-ticket", "physical"]),
});

const createGateAccessSchema = z.object({ action: z.literal("createGateAccess"), eventId: eventIdSchema, gateId: z.string().trim().min(1).max(80), label: z.string().trim().min(2).max(80) });
const revokeGateAccessSchema = z.object({ action: z.literal("revokeGateAccess"), accessId: z.string().uuid() });
const revokeAllGateAccessSchema = z.object({ action: z.literal("revokeAllGateAccess"), eventId: eventIdSchema });
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
  logoDataUrl: z.union([z.literal(""), z.string().max(350_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)]),
  supportContact: z.string().trim().max(120), terms: z.string().trim().max(500),
}).refine((value) => contrastWithWhite(value.primaryColour) >= 4.5, { message: "Primary colour needs stronger contrast with white text", path: ["primaryColour"] });
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeZoneSchema = z.string().trim().min(3).max(64).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Unknown IANA time zone");
const scheduleFields = { startDate: dateSchema, endDate: dateSchema, timeZone: timeZoneSchema, doorsOpen: timeSchema, entryWindowStart: timeSchema, entryWindowEnd: timeSchema, eventEnd: timeSchema };
const eventDetailsSchema = z.object({ name: z.string().trim().min(3).max(120), venue: z.string().trim().min(2).max(120), capacity: z.number().int().min(1).max(250_000), ...scheduleFields }).refine((value) => value.endDate >= value.startDate, { message: "End date cannot be before start date", path: ["endDate"] });
const updateEventSchema = z.object({ action: z.literal("updateEvent"), eventId: eventIdSchema, expectedVersion: z.number().int().min(1) }).and(eventDetailsSchema);
const setEventStatusSchema = z.object({ action: z.literal("setEventStatus"), eventId: eventIdSchema, status: z.enum(["draft", "live", "closed", "archived"]) });
const zoneFields = { eventId: eventIdSchema, name: z.string().trim().min(1).max(80), colour: colourSchema, capacity: z.number().int().min(0).max(250_000) };
const createZoneSchema = z.object({ action: z.literal("createZone"), ...zoneFields });
const updateZoneSchema = z.object({ action: z.literal("updateZone"), zoneId: z.string().min(1).max(80), ...zoneFields });
const deleteZoneSchema = z.object({ action: z.literal("deleteZone"), eventId: eventIdSchema, zoneId: z.string().min(1).max(80) });
const createGateSchema = z.object({ action: z.literal("createGate"), eventId: eventIdSchema, name: z.string().trim().min(1).max(80) });
const updateGateSchema = z.object({ action: z.literal("updateGate"), eventId: eventIdSchema, gateId: z.string().min(1).max(80), name: z.string().trim().min(1).max(80) });
const deleteGateSchema = z.object({ action: z.literal("deleteGate"), eventId: eventIdSchema, gateId: z.string().min(1).max(80) });
const duplicateEventSchema = z.object({ action: z.literal("duplicateEvent"), eventId: eventIdSchema, name: z.string().trim().min(3).max(120) });
const deleteEventSchema = z.object({ action: z.literal("deleteEvent"), eventId: eventIdSchema, confirmation: z.string().trim().min(3).max(120) });
const restoreEventSchema = z.object({ action: z.literal("restoreEvent"), eventId: eventIdSchema });
const updateTicketPolicySchema = z.object({ action: z.literal("updateTicketPolicy"), eventId: eventIdSchema, allowETickets: z.boolean(), allowPhysical: z.boolean(), allowGroups: z.boolean(), maxGroupSize: z.number().int().min(1).max(6), allowRegeneration: z.boolean() }).refine((value) => value.allowETickets || value.allowPhysical, { message: "At least one ticket format must be enabled" });
const createEventSchema = z.object({
  action: z.literal("createEvent"),
  name: z.string().trim().min(3).max(120),
  venue: z.string().trim().min(2).max(120),
  status: z.literal("draft"),
  capacity: z.number().int().min(1).max(250_000),
  ...scheduleFields,
  zoneCount: z.number().int().min(1).max(20),
  gateCount: z.number().int().min(1).max(20),
}).refine((value) => value.endDate >= value.startDate, { message: "End date cannot be before start date", path: ["endDate"] });

const actionSchema = z.union([scanSchema, lookupSchema, regenerateSchema, importSchema, createTicketSchema, createGateAccessSchema, revokeGateAccessSchema, revokeAllGateAccessSchema, createEventSchema, updateTicketThemeSchema, updateEventSchema, setEventStatusSchema, createZoneSchema, updateZoneSchema, deleteZoneSchema, createGateSchema, updateGateSchema, deleteGateSchema, duplicateEventSchema, updateTicketPolicySchema, deleteEventSchema, restoreEventSchema]);

function json(data: unknown, init?: ResponseInit) {
  const response = Response.json(data, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function POST(request: Request) {
  const role = (await authorizeRequest(request))?.role ?? null;
  if (!role) return json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return json({ error: "Invalid request origin" }, { status: 403 });
  const mutationLimit = await distributedRateLimit("operations-mutation", requestClient(request), 120, 60);
  if (!mutationLimit.allowed) return json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": String(mutationLimit.retryAfter) } });
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
    const allowed = role === "Super Admin" || (role === "Admin" && !["deleteZone", "deleteGate", "deleteEvent", "restoreEvent"].includes(body.action)) || (role === "Gate Supervisor" && ["scan", "lookup"].includes(body.action));
    if (!allowed) return json({ error: "Your role cannot perform this action" }, { status: 403 });
    const operator = role;
    switch (body.action) {
      case "scan":
        return json(await consumeTicket({ ...body, operator }));
      case "lookup":
        return json({ tickets: await findTicketsByNric(body.nric, body.eventId) });
      case "regenerate":
        return json({ result: await regenerateTicket(body.ticketId, body.expectedVersion, operator) });
      case "import":
        return json(await importTickets(body.rows, body.eventId, operator));
      case "createTicket":
        return json(await createTicket(body, body.eventId, operator), { status: 201 });
      case "createGateAccess":
        return json({ access: await createGateAccessLink(body.gateId, body.eventId, body.label, operator) });
      case "revokeGateAccess":
        return json({ revoked: await revokeGateAccessLink(body.accessId, operator) });
      case "revokeAllGateAccess":
        return json({ revoked: await revokeAllGateAccess(body.eventId, operator) });
      case "createEvent":
        return json({ event: await createEvent(body, operator) }, { status: 201 });
      case "updateTicketTheme":
        return json({ updated: await updateTicketTheme(body.eventId, body, operator) });
      case "updateEvent":
        return json({ updated: await updateEvent(body.eventId, body, operator, body.expectedVersion) });
      case "setEventStatus":
        return json({ updated: await setEventStatus(body.eventId, body.status, operator) });
      case "createZone":
        return json({ zone: await createZone(body.eventId, body, operator) }, { status: 201 });
      case "updateZone":
        return json({ updated: await updateZone(body.eventId, body.zoneId, body, operator) });
      case "deleteZone":
        return json({ deleted: await deleteZone(body.eventId, body.zoneId, operator) });
      case "createGate":
        return json({ gate: await createGate(body.eventId, body.name, operator) }, { status: 201 });
      case "updateGate":
        return json({ updated: await updateGate(body.eventId, body.gateId, body.name, operator) });
      case "deleteGate":
        return json({ deleted: await deleteGate(body.eventId, body.gateId, operator) });
      case "duplicateEvent":
        return json({ event: await duplicateEvent(body.eventId, body.name, operator) }, { status: 201 });
      case "updateTicketPolicy":
        return json({ updated: await updateTicketPolicy(body.eventId, body, operator) });
      case "deleteEvent":
        return json({ deleted: await softDeleteEvent(body.eventId, body.confirmation, operator) });
      case "restoreEvent":
        return json({ restored: await restoreEvent(body.eventId, operator) });
    }
  } catch (error) {
    console.error("Action request failed", error);
    const databaseError = error instanceof DatabaseConfigurationError;
    return json({ error: databaseError ? error.message : "Action failed" }, { status: databaseError ? 503 : 500 });
  }
}
