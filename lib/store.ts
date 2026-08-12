import { createHash, createHmac, randomUUID } from "node:crypto";
import { getSql } from "../db";
import { ATOMIC_SCAN_SQL, EXISTING_SCAN_SQL } from "./scan-sql";
import type { AppState, EventRecord, EventSummary, TicketRecord } from "./types";

const SEEDED_EVENT_ID = "evt-ndp27-preview-1";
const TICKET_SELECT = `SELECT t.id, t.event_id AS "eventId", t.masked_nric AS "maskedNric", t.mobile,
  t.zone_id AS "zoneId", z.name AS "zoneName", z.colour AS "zoneColour", t.format,
  t.max_entries AS "maxEntries", t.used_entries AS "usedEntries",
  (t.max_entries - t.used_entries) AS "remainingEntries", t.version, t.token, t.status
  FROM tickets t JOIN zones z ON z.id = t.zone_id`;
const EVENT_SELECT = `SELECT id, name, venue, status, version, deleted_at::text AS "deletedAt", capacity,
  start_date::text AS "startDate", end_date::text AS "endDate", time_zone AS "timeZone",
  doors_open AS "doorsOpen", event_end AS "eventEnd",
  entry_window_start AS "entryWindowStart", entry_window_end AS "entryWindowEnd",
  json_build_object('brandName', ticket_brand, 'ticketTitle', ticket_title, 'instructions', ticket_instructions,
    'primaryColour', ticket_primary_colour, 'accentColour', ticket_accent_colour, 'logoDataUrl', ticket_logo_data_url,
    'supportContact', ticket_support_contact, 'terms', ticket_terms) AS "ticketTheme",
  json_build_object('allowETickets', allow_e_tickets, 'allowPhysical', allow_physical_tickets, 'allowGroups', allow_group_tickets,
    'maxGroupSize', max_group_size, 'allowRegeneration', allow_ticket_regeneration) AS "ticketPolicy"
  FROM events`;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS events (
    id text PRIMARY KEY,
    name text NOT NULL,
    venue text NOT NULL,
    status text NOT NULL,
    capacity integer NOT NULL CHECK (capacity >= 0),
    entry_window_start text NOT NULL,
    entry_window_end text NOT NULL
  )`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_brand text NOT NULL DEFAULT 'Event Entry'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_title text NOT NULL DEFAULT 'Official admission ticket'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_instructions text NOT NULL DEFAULT 'Present this QR at any entry gate. Turn your screen brightness up if needed.'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_primary_colour text NOT NULL DEFAULT '#17213a'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_accent_colour text NOT NULL DEFAULT '#dc162f'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_logo_data_url text NOT NULL DEFAULT ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_support_contact text NOT NULL DEFAULT ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_terms text NOT NULL DEFAULT ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_e_tickets boolean NOT NULL DEFAULT true`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_physical_tickets boolean NOT NULL DEFAULT true`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_group_tickets boolean NOT NULL DEFAULT true`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS max_group_size integer NOT NULL DEFAULT 6`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_ticket_regeneration boolean NOT NULL DEFAULT true`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT CURRENT_DATE`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS end_date date NOT NULL DEFAULT CURRENT_DATE`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Asia/Singapore'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS doors_open text NOT NULL DEFAULT '15:00'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end text NOT NULL DEFAULT '23:00'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
  `ALTER TABLE gate_access_links ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT 'Gate device'`,
  `ALTER TABLE gate_access_links ADD COLUMN IF NOT EXISTS last_used_at timestamptz`,
  `CREATE TABLE IF NOT EXISTS zones (
    id text PRIMARY KEY,
    event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name text NOT NULL,
    colour text NOT NULL,
    capacity integer NOT NULL CHECK (capacity >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS gates (
    id text PRIMARY KEY,
    event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id text PRIMARY KEY,
    event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    nric_hash text NOT NULL,
    masked_nric text NOT NULL,
    mobile text NOT NULL,
    zone_id text NOT NULL REFERENCES zones(id),
    format text NOT NULL CHECK (format IN ('e-ticket', 'physical')),
    max_entries integer NOT NULL CHECK (max_entries BETWEEN 1 AND 6),
    used_entries integer NOT NULL DEFAULT 0 CHECK (used_entries >= 0 AND used_entries <= max_entries),
    version integer NOT NULL DEFAULT 1,
    token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active'
  )`,
  `CREATE TABLE IF NOT EXISTS scan_requests (
    id text PRIMARY KEY,
    fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS gate_access_links (
    id text PRIMARY KEY,
    gate_id text NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS scans (
    id text PRIMARY KEY REFERENCES scan_requests(id),
    ticket_id text NOT NULL REFERENCES tickets(id),
    event_id text NOT NULL REFERENCES events(id),
    gate_id text NOT NULL REFERENCES gates(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    result text NOT NULL,
    mode text NOT NULL,
    reason text,
    operator text NOT NULL,
    remaining_after integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id text PRIMARY KEY,
    action text NOT NULL,
    actor text NOT NULL,
    subject_id text NOT NULL,
    detail text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS zones_event_id_idx ON zones(event_id)`,
  `CREATE INDEX IF NOT EXISTS gates_event_id_idx ON gates(event_id)`,
  `CREATE INDEX IF NOT EXISTS tickets_event_id_idx ON tickets(event_id)`,
  `CREATE INDEX IF NOT EXISTS tickets_nric_hash_idx ON tickets(nric_hash)`,
  `CREATE INDEX IF NOT EXISTS tickets_event_nric_idx ON tickets(event_id, nric_hash)`,
  `CREATE INDEX IF NOT EXISTS tickets_zone_id_idx ON tickets(zone_id)`,
  `CREATE INDEX IF NOT EXISTS scan_requests_created_idx ON scan_requests(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS gate_access_links_gate_id_idx ON gate_access_links(gate_id)`,
  `CREATE INDEX IF NOT EXISTS scans_event_created_idx ON scans(event_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS scans_ticket_id_idx ON scans(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC)`,
  `UPDATE events SET status = 'live' WHERE status NOT IN ('draft', 'live', 'closed', 'archived')`,
];

let schemaReadyPromise: Promise<void> | null = null;
let seedReadyPromise: Promise<void> | null = null;

function hashSecret() {
  const secret = process.env.NRIC_HASH_SECRET ?? process.env.APP_ACCESS_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "event-entry-local-development-only";
  throw new Error("NRIC_HASH_SECRET or APP_ACCESS_KEY must be configured");
}

export function normaliseNric(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function nricHash(value: string) {
  return createHmac("sha256", hashSecret()).update(normaliseNric(value)).digest("hex");
}

function maskNric(value: string) {
  const nric = normaliseNric(value);
  return nric.length >= 4 ? `${nric.slice(0, 1)}••••${nric.slice(-4)}` : "••••";
}

function makeToken(ticketId: string) {
  return `EVT.${ticketId}.${randomUUID().replaceAll("-", "")}`;
}

async function initialiseSchema() {
  const sql = getSql();
  await sql.transaction(schemaStatements.map((statement) => sql.query(statement)));
}

async function seedDatabase() {
  schemaReadyPromise ??= initialiseSchema().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });
  await schemaReadyPromise;

  const sql = getSql();
  await sql`
    INSERT INTO events (id, name, venue, status, capacity, entry_window_start, entry_window_end)
    VALUES (${SEEDED_EVENT_ID}, 'NDP 2027 — Preview 1', 'The Padang', 'live', 27000, '16:00', '18:00')
    ON CONFLICT (id) DO NOTHING
  `;

  const zoneRows = [
    ["zone-red", "Red", "#d92d20", 6750],
    ["zone-green", "Green", "#07865f", 6750],
    ["zone-yellow", "Yellow", "#e8ad16", 6750],
    ["zone-blue", "Blue", "#1670b7", 6750],
  ] as const;
  const gateRows = [
    ["gate-a", "Gate A"],
    ["gate-b", "Gate B"],
    ["gate-c", "Gate C"],
    ["gate-d", "Gate D"],
  ] as const;
  const sampleTickets = [
    ["S1234567D", "9123 4567", "zone-red", "e-ticket", 6],
    ["S2345678E", "9234 5678", "zone-green", "e-ticket", 4],
    ["S3456789F", "9345 6789", "zone-yellow", "e-ticket", 2],
    ["S4567890G", "9456 7890", "zone-blue", "e-ticket", 1],
    ["S5678901H", "9567 8901", "zone-red", "physical", 1],
    ["S6789012I", "9678 9012", "zone-green", "physical", 1],
  ] as const;

  await sql.transaction((transaction) => [
    ...zoneRows.map(([id, name, colour, capacity]) => transaction`
      INSERT INTO zones (id, event_id, name, colour, capacity)
      VALUES (${id}, ${SEEDED_EVENT_ID}, ${name}, ${colour}, ${capacity})
      ON CONFLICT (id) DO NOTHING
    `),
    ...gateRows.map(([id, name]) => transaction`
      INSERT INTO gates (id, event_id, name)
      VALUES (${id}, ${SEEDED_EVENT_ID}, ${name})
      ON CONFLICT (id) DO NOTHING
    `),
  ]);

  await sql.transaction((transaction) => sampleTickets.map(([nric, mobile, zoneId, format, maxEntries], index) => {
    const id = `TKT-${String(index + 1).padStart(4, "0")}`;
    return transaction`
      INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, token)
      VALUES (${id}, ${SEEDED_EVENT_ID}, ${nricHash(nric)}, ${maskNric(nric)}, ${mobile}, ${zoneId}, ${format}, ${maxEntries}, ${makeToken(id)})
      ON CONFLICT (id) DO NOTHING
    `;
  }));
}

export function ensureSeeded() {
  seedReadyPromise ??= seedDatabase().catch((error) => {
    seedReadyPromise = null;
    throw error;
  });
  return seedReadyPromise;
}

type ZoneRow = AppState["zones"][number];
type GateRow = AppState["gates"][number];
type ScanRow = AppState["scans"][number];

export async function getState(requestedEventId?: string): Promise<AppState> {
  await ensureSeeded();
  const sql = getSql();
  const rawEvents = await sql`
    SELECT e.id, e.name, e.venue, e.status, e.version, e.deleted_at::text AS "deletedAt", e.capacity,
      e.start_date::text AS "startDate", e.end_date::text AS "endDate", e.time_zone AS "timeZone", e.doors_open AS "doorsOpen", e.event_end AS "eventEnd",
      e.entry_window_start AS "entryWindowStart", e.entry_window_end AS "entryWindowEnd",
      json_build_object('brandName', e.ticket_brand, 'ticketTitle', e.ticket_title, 'instructions', e.ticket_instructions, 'primaryColour', e.ticket_primary_colour, 'accentColour', e.ticket_accent_colour, 'logoDataUrl', e.ticket_logo_data_url, 'supportContact', e.ticket_support_contact, 'terms', e.ticket_terms) AS "ticketTheme",
      json_build_object('allowETickets', e.allow_e_tickets, 'allowPhysical', e.allow_physical_tickets, 'allowGroups', e.allow_group_tickets, 'maxGroupSize', e.max_group_size, 'allowRegeneration', e.allow_ticket_regeneration) AS "ticketPolicy",
      count(t.id)::integer AS "ticketCount", COALESCE(sum(t.used_entries), 0)::integer AS admitted
    FROM events e LEFT JOIN tickets t ON t.event_id = e.id
    GROUP BY e.id ORDER BY e.name, e.id
  ` as unknown as EventSummary[];
  const eventId = requestedEventId ?? rawEvents.find((item) => !item.deletedAt)?.id;
  if (!eventId || !rawEvents.some((event) => event.id === eventId)) throw new Error("Event not found");
  const [rawZones, rawGates, rawTickets, rawScans, rawGateAccess, rawAudit] = await Promise.all([
    sql`SELECT id, name, colour, capacity FROM zones WHERE event_id = ${eventId} ORDER BY name`,
    sql`SELECT id, name FROM gates WHERE event_id = ${eventId} ORDER BY name`,
    sql.query(`${TICKET_SELECT} WHERE t.event_id = $1 ORDER BY t.id`, [eventId]),
    sql`SELECT s.id, s.ticket_id AS "ticketId", s.gate_id AS "gateId", g.name AS "gateName", s.quantity, s.result, s.mode, s.reason, s.operator, s.created_at::text AS "createdAt" FROM scans s JOIN gates g ON g.id = s.gate_id WHERE s.event_id = ${eventId} ORDER BY s.created_at DESC LIMIT 100`,
    sql`SELECT a.id, a.gate_id AS "gateId", g.name AS "gateName", a.label, a.expires_at::text AS "expiresAt", a.revoked_at::text AS "revokedAt", a.last_used_at::text AS "lastUsedAt", a.created_at::text AS "createdAt" FROM gate_access_links a JOIN gates g ON g.id = a.gate_id WHERE g.event_id = ${eventId} ORDER BY a.created_at DESC`,
    sql`SELECT a.id, a.action, a.actor, a.subject_id AS "subjectId", a.detail, a.created_at::text AS "createdAt" FROM audit_events a
      WHERE a.subject_id = ${eventId} OR a.subject_id IN (SELECT id FROM zones WHERE event_id = ${eventId})
        OR a.subject_id IN (SELECT id FROM gates WHERE event_id = ${eventId}) OR a.subject_id IN (SELECT id FROM tickets WHERE event_id = ${eventId})
      ORDER BY a.created_at DESC LIMIT 50`,
  ]);
  const zones = rawZones as unknown as ZoneRow[];
  const gates = rawGates as unknown as GateRow[];
  const tickets = rawTickets as unknown as TicketRecord[];
  const scans = rawScans as unknown as ScanRow[];
  const event = rawEvents.find((item) => item.id === eventId)!;
  const typedZones = zones;
  const typedGates = gates;
  const typedTickets = tickets;
  const typedScans = scans;
  const allocated = typedTickets.reduce((sum, ticket) => sum + ticket.maxEntries, 0);
  const admitted = typedTickets.reduce((sum, ticket) => sum + ticket.usedEntries, 0);
  const recentCutoff = Date.now() - 5 * 60 * 1000;
  const recentAdmissions = typedScans.reduce((sum, scan) => Date.parse(scan.createdAt) >= recentCutoff && scan.result === "allowed" ? sum + scan.quantity : sum, 0);
  const zoneCapacity = typedZones.reduce((sum, zone) => sum + zone.capacity, 0);
  const readinessChecks: AppState["readiness"]["checks"] = [
    { id: "status", level: "warning", label: "Event is live", ok: event.status === "live", detail: event.status === "live" ? "Admissions are enabled" : `Current status: ${event.status}` },
    { id: "zones", level: "blocker", label: "Entry zones configured", ok: typedZones.length > 0, detail: `${typedZones.length} zone${typedZones.length === 1 ? "" : "s"}` },
    { id: "capacity", level: "blocker", label: "Zone capacity matches venue", ok: zoneCapacity === event.capacity, detail: `${zoneCapacity} of ${event.capacity} allocated` },
    { id: "gates", level: "blocker", label: "Gates configured", ok: typedGates.length > 0, detail: `${typedGates.length} gate${typedGates.length === 1 ? "" : "s"}` },
    { id: "tickets", level: "warning", label: "Tickets issued", ok: typedTickets.length > 0, detail: `${typedTickets.length} ticket record${typedTickets.length === 1 ? "" : "s"}` },
  ];
  const completedChecks = readinessChecks.filter((check) => check.ok).length;
  const nextCheck = readinessChecks.find((check) => !check.ok);
  return {
    event,
    events: rawEvents,
    zones: typedZones,
    gates: typedGates,
    gateAccessLinks: rawGateAccess as unknown as AppState["gateAccessLinks"],
    auditEvents: rawAudit as unknown as AppState["auditEvents"],
    tickets: typedTickets,
    scans: typedScans,
    readiness: { ready: readinessChecks.every((check) => check.ok), progress: Math.round(completedChecks / readinessChecks.length * 100), nextAction: nextCheck ? nextCheck.label : "Monitor live operations", checks: readinessChecks },
    metrics: {
      allocated,
      admitted,
      remaining: allocated - admitted,
      issuedBundles: typedTickets.length,
      eTicketAdmissions: typedTickets.filter((ticket) => ticket.format === "e-ticket").reduce((sum, ticket) => sum + ticket.maxEntries, 0),
      physicalAdmissions: typedTickets.filter((ticket) => ticket.format === "physical").reduce((sum, ticket) => sum + ticket.maxEntries, 0),
      manualAdmissions: typedScans.filter((scan) => scan.mode === "manual" && scan.result === "allowed").reduce((sum, scan) => sum + scan.quantity, 0),
      offlineAdmissions: typedScans.filter((scan) => scan.mode === "offline" && scan.result === "allowed").reduce((sum, scan) => sum + scan.quantity, 0),
      deniedAttempts: typedScans.filter((scan) => scan.result === "denied").length,
      entryRate: Math.round(recentAdmissions / 5),
    },
  };
}

export async function findTicketByToken(token: string) {
  await ensureSeeded();
  const rows = await getSql().query(`${TICKET_SELECT} WHERE t.token = $1 LIMIT 1`, [token]);
  return (rows as unknown as TicketRecord[])[0];
}
export async function findTicketById(id: string) {
  await ensureSeeded(); const rows = await getSql().query(`${TICKET_SELECT} WHERE t.id = $1 LIMIT 1`, [id]);
  return (rows as unknown as TicketRecord[])[0] ?? null;
}

export async function findEventById(eventId: string) {
  await ensureSeeded();
  const rows = await getSql().query(`${EVENT_SELECT} WHERE id = $1 LIMIT 1`, [eventId]) as EventRecord[];
  return rows[0] ?? null;
}

export async function findTicketsByNric(nric: string, eventId: string) {
  await ensureSeeded();
  const rows = await getSql().query(`${TICKET_SELECT} WHERE t.nric_hash = $1 AND t.event_id = $2 ORDER BY t.id`, [nricHash(nric), eventId]);
  return rows as unknown as TicketRecord[];
}

type ScanInput = {
  token: string;
  quantity: number;
  gateId: string;
  mode: "online" | "offline" | "manual";
  operator: string;
  requestId?: string;
};

type ScanResultRow = {
  id: string;
  ticketId: string;
  quantity: number;
  result: "allowed" | "denied";
  reason: string | null;
  remaining: number;
  zoneName: string;
};

function scanResponse(row: ScanResultRow) {
  if (row.result === "denied") return { ok: false, reason: row.reason ?? "Admission denied", remaining: row.remaining };
  return { ok: true, ticketId: row.ticketId, zoneName: row.zoneName, quantity: row.quantity, remaining: row.remaining };
}

export async function consumeTicket(input: ScanInput) {
  await ensureSeeded();
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 6) {
    return { ok: false, reason: "Select between one and six admissions" };
  }
  const scanId = input.requestId ?? randomUUID();
  const fingerprint = createHash("sha256").update(JSON.stringify([input.token, input.quantity, input.gateId, input.mode])).digest("hex");
  const sql = getSql();
  const rows = await sql.query(ATOMIC_SCAN_SQL, [input.token, scanId, input.quantity, input.mode, input.operator, input.gateId, fingerprint]) as ScanResultRow[];

  if (rows[0]) return scanResponse(rows[0]);

  const existing = await sql.query(EXISTING_SCAN_SQL, [scanId, fingerprint]) as ScanResultRow[];
  if (existing[0]) return scanResponse(existing[0]);
  return { ok: false, reason: "Ticket is invalid, inactive, or not valid for this gate" };
}

function gateAccessTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createGateAccessLink(gateId: string, eventId: string, label: string, actor: string) {
  await ensureSeeded();
  const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const id = randomUUID();
  const rows = await getSql().query(`
    WITH inserted AS (
      INSERT INTO gate_access_links (id, gate_id, token_hash, expires_at, label)
      SELECT $1, g.id, $2, now() + interval '24 hours', $7 FROM gates g
      WHERE g.id = $3 AND g.event_id = $4
      RETURNING expires_at
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT $5, 'gate_access.created', $6, $1, '24-hour scanner access' FROM inserted
    )
    SELECT expires_at::text AS "expiresAt" FROM inserted
  `, [id, gateAccessTokenHash(token), gateId, eventId, randomUUID(), actor, label]) as Array<{ expiresAt: string }>;
  return rows[0] ? { id, token, gateId, expiresAt: rows[0].expiresAt } : null;
}

export async function getGateAccess(token: string) {
  await ensureSeeded();
  const rows = await getSql().query(`
    SELECT a.id, a.gate_id AS "gateId", g.event_id AS "eventId", g.name AS "gateName", a.expires_at::text AS "expiresAt"
    FROM gate_access_links a JOIN gates g ON g.id = a.gate_id
    WHERE a.token_hash = $1 AND a.revoked_at IS NULL AND a.expires_at > now()
    LIMIT 1
  `, [gateAccessTokenHash(token)]) as Array<{ id: string; gateId: string; eventId: string; gateName: string; expiresAt: string }>;
  return rows[0] ?? null;
}

export async function markGateAccessUsed(id: string) {
  await getSql().query(`UPDATE gate_access_links SET last_used_at = now() WHERE id = $1`, [id]);
}

export async function revokeGateAccessLink(id: string, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`
    WITH updated AS (
      UPDATE gate_access_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT $2, 'gate_access.revoked', $3, id, 'Scanner access revoked' FROM updated
    ) SELECT id FROM updated
  `, [id, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function revokeAllGateAccess(eventId: string, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`WITH updated AS (
    UPDATE gate_access_links a SET revoked_at = now() FROM gates g
    WHERE a.gate_id = g.id AND g.event_id = $1 AND a.revoked_at IS NULL AND a.expires_at > now() RETURNING a.id
  ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $2, 'gate_access.bulk_revoked', $3, $1, count(*) || ' scanner links revoked' FROM updated HAVING count(*) > 0) SELECT count(*)::integer AS count FROM updated`, [eventId, randomUUID(), actor]) as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

export async function regenerateTicket(ticketId: string, expectedVersion: number, actor: string) {
  await ensureSeeded();
  const token = makeToken(ticketId);
  const rows = await getSql().query(`
    WITH updated AS (
      UPDATE tickets
      SET version = version + 1, token = $1
      WHERE id = $2 AND version = $5 AND EXISTS (SELECT 1 FROM events e WHERE e.id = tickets.event_id AND e.allow_ticket_regeneration)
      RETURNING id, token, version
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT $3, 'ticket.regenerated', $4, id, 'Regenerated as version ' || version
      FROM updated
    )
    SELECT token, version FROM updated
  `, [token, ticketId, randomUUID(), actor, expectedVersion]) as Array<{ token: string; version: number }>;
  return rows[0] ?? null;
}

export type ImportRow = {
  nric: string;
  mobile: string;
  quantity: number;
  zoneId: string;
  format: "e-ticket" | "physical";
};

export async function importTickets(rows: ImportRow[], eventId: string, actor: string) {
  await ensureSeeded();
  const records = rows.flatMap((row) => {
    const count = row.format === "physical" ? row.quantity : 1;
    return Array.from({ length: count }, () => {
      const id = `${row.format === "physical" ? "PHY" : "ETK"}-${randomUUID()}`;
      return {
        id,
        eventId,
        nricHash: nricHash(row.nric),
        maskedNric: maskNric(row.nric),
        mobile: row.mobile,
        zoneId: row.zoneId,
        format: row.format,
        maxEntries: row.format === "physical" ? 1 : row.quantity,
        token: makeToken(id),
      };
    });
  });
  if (!records.length) return { created: 0 };
  const sql = getSql();
  const inserted = await sql.query(`
    WITH event_lock AS MATERIALIZED (
      SELECT e.* FROM events e, LATERAL (SELECT pg_advisory_xact_lock(hashtext(e.id))) lock
      WHERE e.id = $3
    ), incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
        id text, "eventId" text, "nricHash" text, "maskedNric" text,
        mobile text, "zoneId" text, format text, "maxEntries" integer, token text
      )
    ), valid AS (
      SELECT i.* FROM incoming i
      JOIN zones z ON z.id = i."zoneId" AND z.event_id = i."eventId"
      JOIN event_lock e ON e.id = i."eventId"
      WHERE (i.format = 'e-ticket' AND e.allow_e_tickets OR i.format = 'physical' AND e.allow_physical_tickets)
        AND (i."maxEntries" = 1 OR e.allow_group_tickets) AND i."maxEntries" <= e.max_group_size
    ), capacity_ok AS (
      SELECT count(*) = (SELECT count(*) FROM incoming)
        AND COALESCE((SELECT sum(max_entries) FROM tickets WHERE event_id = $3), 0) + COALESCE(sum(v."maxEntries"), 0) <= max(e.capacity)
        AND NOT EXISTS (
          SELECT 1 FROM (SELECT "zoneId", sum("maxEntries") entries FROM valid GROUP BY "zoneId") allocations
          JOIN zones z ON z.id = allocations."zoneId"
          WHERE allocations.entries + COALESCE((SELECT sum(max_entries) FROM tickets WHERE zone_id = z.id), 0) > z.capacity
        ) AS allowed
      FROM valid v CROSS JOIN event_lock e
    ), created AS (
      INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, token)
      SELECT id, "eventId", "nricHash", "maskedNric", mobile, "zoneId", format, "maxEntries", token
      FROM valid WHERE (SELECT allowed FROM capacity_ok)
      RETURNING id
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT gen_random_uuid()::text, 'ticket.imported', $2, id, 'Imported winner allocation'
      FROM created
    )
    SELECT count(*)::integer AS created FROM created
  `, [JSON.stringify(records), actor, eventId]) as Array<{ created: number }>;
  const created = inserted[0]?.created ?? 0;
  return { created, rejected: records.length - created };
}

export async function createTicket(row: ImportRow, eventId: string, actor: string) {
  const result = await importTickets([row], eventId, actor);
  return { created: result.created === 1, rejected: result.rejected };
}

export type CreateEventInput = Pick<EventRecord, "name" | "venue" | "status" | "capacity" | "startDate" | "endDate" | "timeZone" | "doorsOpen" | "entryWindowStart" | "entryWindowEnd" | "eventEnd"> & { zoneCount?: number; gateCount?: number };

export async function createEvent(input: CreateEventInput, actor: string) {
  await ensureSeeded();
  const eventId = `evt-${randomUUID()}`;
  const zoneCount = input.zoneCount ?? 4; const gateCount = input.gateCount ?? 4;
  const zoneCapacity = Math.floor(input.capacity / zoneCount);
  const zoneTemplates = [
    ["Red", "#d92d20"], ["Green", "#07865f"], ["Yellow", "#e8ad16"], ["Blue", "#1670b7"],
  ] as const;
  const zones = Array.from({ length: zoneCount }, (_, index) => zoneTemplates[index] ?? [`Zone ${index + 1}`, "#6750a4"] as const);
  const sql = getSql();
  await sql.transaction((transaction) => [
    transaction`INSERT INTO events (id, name, venue, status, capacity, start_date, end_date, time_zone, doors_open, entry_window_start, entry_window_end, event_end) VALUES (${eventId}, ${input.name}, ${input.venue}, ${input.status}, ${input.capacity}, ${input.startDate}, ${input.endDate}, ${input.timeZone}, ${input.doorsOpen}, ${input.entryWindowStart}, ${input.entryWindowEnd}, ${input.eventEnd})`,
    ...zones.map(([name, colour], index) => transaction`INSERT INTO zones (id, event_id, name, colour, capacity) VALUES (${`zone-${randomUUID()}`}, ${eventId}, ${name}, ${colour}, ${index === zones.length - 1 ? input.capacity - (zoneCapacity * (zoneCount - 1)) : zoneCapacity})`),
    ...Array.from({ length: gateCount }, (_, index) => transaction`INSERT INTO gates (id, event_id, name) VALUES (${`gate-${randomUUID()}`}, ${eventId}, ${`Gate ${String.fromCharCode(65 + index)}`})`),
    transaction`INSERT INTO audit_events (id, action, actor, subject_id, detail) VALUES (${randomUUID()}, 'event.created', ${actor}, ${eventId}, ${`${input.name} at ${input.venue}`})`,
  ]);
  return { id: eventId };
}

export async function updateTicketTheme(eventId: string, theme: EventRecord["ticketTheme"], actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`
    WITH updated AS (
      UPDATE events SET ticket_brand = $1, ticket_title = $2, ticket_instructions = $3,
        ticket_primary_colour = $4, ticket_accent_colour = $5, ticket_logo_data_url = $9,
        ticket_support_contact = $10, ticket_terms = $11
      WHERE id = $6
      RETURNING id
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT $7, 'event.ticket_theme.updated', $8, id, 'Updated event ticket branding' FROM updated
    ) SELECT id FROM updated
  `, [theme.brandName, theme.ticketTitle, theme.instructions, theme.primaryColour, theme.accentColour, eventId, randomUUID(), actor, theme.logoDataUrl, theme.supportContact, theme.terms]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export type UpdateEventInput = Pick<EventRecord, "name" | "venue" | "capacity" | "startDate" | "endDate" | "timeZone" | "doorsOpen" | "entryWindowStart" | "entryWindowEnd" | "eventEnd">;

export async function updateEvent(eventId: string, input: UpdateEventInput, actor: string, expectedVersion: number) {
  await ensureSeeded();
  const rows = await getSql().query(`
    WITH updated AS (
      UPDATE events e SET name = $1, venue = $2, capacity = $3, start_date = $4, end_date = $5, time_zone = $6, doors_open = $7, entry_window_start = $8, entry_window_end = $9, event_end = $10, version = version + 1
      WHERE e.id = $11 AND e.version = $14 AND e.deleted_at IS NULL AND $3 >= COALESCE((SELECT sum(max_entries) FROM tickets WHERE event_id = e.id), 0)
        AND $3 >= COALESCE((SELECT sum(capacity) FROM zones WHERE event_id = e.id), 0)
      RETURNING id
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT $12, 'event.updated', $13, id, 'Updated event details' FROM updated
    ) SELECT id FROM updated
  `, [input.name, input.venue, input.capacity, input.startDate, input.endDate, input.timeZone, input.doorsOpen, input.entryWindowStart, input.entryWindowEnd, input.eventEnd, eventId, randomUUID(), actor, expectedVersion]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function setEventStatus(eventId: string, status: "draft" | "live" | "closed" | "archived", actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`
    WITH updated AS (
      UPDATE events e SET status = $1 WHERE id = $2 AND deleted_at IS NULL AND (
        $1 <> 'live' OR (
          EXISTS (SELECT 1 FROM zones WHERE event_id = e.id) AND EXISTS (SELECT 1 FROM gates WHERE event_id = e.id)
          AND (SELECT COALESCE(sum(capacity), 0) FROM zones WHERE event_id = e.id) = e.capacity
        )
      ) RETURNING id
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT $3, 'event.status.changed', $4, id, 'Changed status to ' || $1 FROM updated
    ) SELECT id FROM updated
  `, [status, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function createZone(eventId: string, input: { name: string; colour: string; capacity: number }, actor: string) {
  await ensureSeeded();
  const id = `zone-${randomUUID()}`;
  const rows = await getSql().query(`
    WITH created AS (
      INSERT INTO zones (id, event_id, name, colour, capacity)
      SELECT $1, e.id, $2, $3, $4 FROM events e WHERE e.id = $5 AND e.status <> 'archived'
        AND $4 + COALESCE((SELECT sum(capacity) FROM zones WHERE event_id = e.id), 0) <= e.capacity
      RETURNING id
    ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $6, 'zone.created', $7, id, $2 FROM created)
    SELECT id FROM created
  `, [id, input.name, input.colour, input.capacity, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return rows[0] ?? null;
}

export async function updateZone(eventId: string, zoneId: string, input: { name: string; colour: string; capacity: number }, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`
    WITH updated AS (
      UPDATE zones z SET name = $1, colour = $2, capacity = $3
      WHERE z.id = $4 AND z.event_id = $5 AND $3 >= COALESCE((SELECT sum(max_entries) FROM tickets WHERE zone_id = z.id), 0)
        AND $3 + COALESCE((SELECT sum(capacity) FROM zones WHERE event_id = $5 AND id <> z.id), 0) <= (SELECT capacity FROM events WHERE id = $5)
      RETURNING id
    ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $6, 'zone.updated', $7, id, $1 FROM updated)
    SELECT id FROM updated
  `, [input.name, input.colour, input.capacity, zoneId, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function deleteZone(eventId: string, zoneId: string, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`
    WITH deleted AS (
      DELETE FROM zones z WHERE z.id = $1 AND z.event_id = $2
        AND NOT EXISTS (SELECT 1 FROM tickets WHERE zone_id = z.id)
      RETURNING id, name
    ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $3, 'zone.deleted', $4, id, name FROM deleted)
    SELECT id FROM deleted
  `, [zoneId, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function createGate(eventId: string, name: string, actor: string) {
  await ensureSeeded();
  const id = `gate-${randomUUID()}`;
  const rows = await getSql().query(`WITH created AS (
    INSERT INTO gates (id, event_id, name) SELECT $1, id, $2 FROM events WHERE id = $3 AND status <> 'archived' RETURNING id
  ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $4, 'gate.created', $5, id, $2 FROM created) SELECT id FROM created`, [id, name, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return rows[0] ?? null;
}

export async function updateGate(eventId: string, gateId: string, name: string, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`WITH updated AS (
    UPDATE gates SET name = $1 WHERE id = $2 AND event_id = $3 RETURNING id
  ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $4, 'gate.updated', $5, id, $1 FROM updated) SELECT id FROM updated`, [name, gateId, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function deleteGate(eventId: string, gateId: string, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`WITH deleted AS (
    DELETE FROM gates g WHERE id = $1 AND event_id = $2
      AND NOT EXISTS (SELECT 1 FROM scans WHERE gate_id = g.id) RETURNING id, name
  ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $3, 'gate.deleted', $4, id, name FROM deleted) SELECT id FROM deleted`, [gateId, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function updateTicketPolicy(eventId: string, policy: EventRecord["ticketPolicy"], actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`WITH updated AS (
    UPDATE events SET allow_e_tickets = $1, allow_physical_tickets = $2, allow_group_tickets = $3,
      max_group_size = $4, allow_ticket_regeneration = $5 WHERE id = $6 RETURNING id
  ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $7, 'event.ticket_policy.updated', $8, id, 'Updated ticket policy' FROM updated) SELECT id FROM updated`, [policy.allowETickets, policy.allowPhysical, policy.allowGroups, policy.maxGroupSize, policy.allowRegeneration, eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function duplicateEvent(sourceEventId: string, name: string, actor: string) {
  await ensureSeeded();
  const id = `evt-${randomUUID()}`;
  const sql = getSql();
  const rows = await sql.transaction((transaction) => [
    transaction.query(`INSERT INTO events (id, name, venue, status, capacity, start_date, end_date, time_zone, doors_open, entry_window_start, entry_window_end, event_end, ticket_brand, ticket_title, ticket_instructions, ticket_primary_colour, ticket_accent_colour, ticket_logo_data_url, ticket_support_contact, ticket_terms, allow_e_tickets, allow_physical_tickets, allow_group_tickets, max_group_size, allow_ticket_regeneration)
      SELECT $1, $2, venue, 'draft', capacity, start_date, end_date, time_zone, doors_open, entry_window_start, entry_window_end, event_end, ticket_brand, ticket_title, ticket_instructions, ticket_primary_colour, ticket_accent_colour, ticket_logo_data_url, ticket_support_contact, ticket_terms, allow_e_tickets, allow_physical_tickets, allow_group_tickets, max_group_size, allow_ticket_regeneration FROM events WHERE id = $3 RETURNING id`, [id, name, sourceEventId]),
    transaction.query(`INSERT INTO zones (id, event_id, name, colour, capacity) SELECT 'zone-' || gen_random_uuid()::text, $1, name, colour, capacity FROM zones WHERE event_id = $2`, [id, sourceEventId]),
    transaction.query(`INSERT INTO gates (id, event_id, name) SELECT 'gate-' || gen_random_uuid()::text, $1, name FROM gates WHERE event_id = $2`, [id, sourceEventId]),
    transaction`INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT ${randomUUID()}, 'event.duplicated', ${actor}, id, ${`Copied from ${sourceEventId}`} FROM events WHERE id = ${id}`,
  ]);
  return (rows[0] as unknown as Array<{ id: string }>)[0] ? { id } : null;
}

export async function softDeleteEvent(eventId: string, confirmation: string, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`WITH updated AS (
    UPDATE events SET deleted_at = now(), version = version + 1 WHERE id = $1 AND status = 'archived' AND deleted_at IS NULL AND name = $2 RETURNING id
  ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $3, 'event.deleted', $4, id, 'Soft deleted archived event' FROM updated) SELECT id FROM updated`, [eventId, confirmation, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function restoreEvent(eventId: string, actor: string) {
  await ensureSeeded();
  const rows = await getSql().query(`WITH updated AS (
    UPDATE events SET deleted_at = NULL, version = version + 1 WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id
  ), audited AS (INSERT INTO audit_events (id, action, actor, subject_id, detail) SELECT $2, 'event.restored', $3, id, 'Restored soft-deleted event' FROM updated) SELECT id FROM updated`, [eventId, randomUUID(), actor]) as Array<{ id: string }>;
  return Boolean(rows[0]);
}
