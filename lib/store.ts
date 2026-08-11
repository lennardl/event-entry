import { createHash, createHmac, randomUUID } from "node:crypto";
import { getSql } from "../db";
import { ATOMIC_SCAN_SQL, EXISTING_SCAN_SQL } from "./scan-sql";
import type { AppState, TicketRecord } from "./types";

const EVENT_ID = "evt-ndp27-preview-1";

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
  `CREATE INDEX IF NOT EXISTS tickets_zone_id_idx ON tickets(zone_id)`,
  `CREATE INDEX IF NOT EXISTS scan_requests_created_idx ON scan_requests(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS gate_access_links_gate_id_idx ON gate_access_links(gate_id)`,
  `CREATE INDEX IF NOT EXISTS scans_event_created_idx ON scans(event_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS scans_ticket_id_idx ON scans(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC)`,
];

let schemaReadyPromise: Promise<void> | null = null;

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

export async function ensureSeeded() {
  schemaReadyPromise ??= initialiseSchema().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });
  await schemaReadyPromise;

  const sql = getSql();
  await sql`
    INSERT INTO events (id, name, venue, status, capacity, entry_window_start, entry_window_end)
    VALUES (${EVENT_ID}, 'NDP 2027 — Preview 1', 'The Padang', 'Live rehearsal', 27000, '16:00', '18:00')
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
      VALUES (${id}, ${EVENT_ID}, ${name}, ${colour}, ${capacity})
      ON CONFLICT (id) DO NOTHING
    `),
    ...gateRows.map(([id, name]) => transaction`
      INSERT INTO gates (id, event_id, name)
      VALUES (${id}, ${EVENT_ID}, ${name})
      ON CONFLICT (id) DO NOTHING
    `),
  ]);

  await sql.transaction((transaction) => sampleTickets.map(([nric, mobile, zoneId, format, maxEntries], index) => {
    const id = `TKT-${String(index + 1).padStart(4, "0")}`;
    return transaction`
      INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, token)
      VALUES (${id}, ${EVENT_ID}, ${nricHash(nric)}, ${maskNric(nric)}, ${mobile}, ${zoneId}, ${format}, ${maxEntries}, ${makeToken(id)})
      ON CONFLICT (id) DO NOTHING
    `;
  }));
}

type EventRow = AppState["event"];
type ZoneRow = AppState["zones"][number];
type GateRow = AppState["gates"][number];
type ScanRow = AppState["scans"][number];

export async function getState(): Promise<AppState> {
  await ensureSeeded();
  const sql = getSql();
  const [rawEventRows, rawZones, rawGates, rawTickets, rawScans] = await Promise.all([
    sql`SELECT id, name, venue, status, capacity, entry_window_start AS "entryWindowStart", entry_window_end AS "entryWindowEnd" FROM events WHERE id = ${EVENT_ID}`,
    sql`SELECT id, name, colour, capacity FROM zones WHERE event_id = ${EVENT_ID} ORDER BY name`,
    sql`SELECT id, name FROM gates WHERE event_id = ${EVENT_ID} ORDER BY name`,
    sql`SELECT t.id, t.masked_nric AS "maskedNric", t.mobile, t.zone_id AS "zoneId", z.name AS "zoneName", z.colour AS "zoneColour", t.format, t.max_entries AS "maxEntries", t.used_entries AS "usedEntries", (t.max_entries - t.used_entries) AS "remainingEntries", t.version, t.token, t.status FROM tickets t JOIN zones z ON z.id = t.zone_id WHERE t.event_id = ${EVENT_ID} ORDER BY t.id`,
    sql`SELECT s.id, s.ticket_id AS "ticketId", s.gate_id AS "gateId", g.name AS "gateName", s.quantity, s.result, s.mode, s.reason, s.operator, s.created_at::text AS "createdAt" FROM scans s JOIN gates g ON g.id = s.gate_id WHERE s.event_id = ${EVENT_ID} ORDER BY s.created_at DESC LIMIT 100`,
  ]);
  const eventRows = rawEventRows as unknown as EventRow[];
  const zones = rawZones as unknown as ZoneRow[];
  const gates = rawGates as unknown as GateRow[];
  const tickets = rawTickets as unknown as TicketRecord[];
  const scans = rawScans as unknown as ScanRow[];
  const event = eventRows[0] as EventRow | undefined;
  if (!event) throw new Error("Event was not initialised");
  const typedZones = zones;
  const typedGates = gates;
  const typedTickets = tickets;
  const typedScans = scans;
  const allocated = typedTickets.reduce((sum, ticket) => sum + ticket.maxEntries, 0);
  const admitted = typedTickets.reduce((sum, ticket) => sum + ticket.usedEntries, 0);
  const recentCutoff = Date.now() - 5 * 60 * 1000;
  const recentAdmissions = typedScans.reduce((sum, scan) => Date.parse(scan.createdAt) >= recentCutoff && scan.result === "allowed" ? sum + scan.quantity : sum, 0);
  return {
    event,
    zones: typedZones,
    gates: typedGates,
    tickets: typedTickets,
    scans: typedScans,
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
  const rows = await getSql()`SELECT t.id, t.masked_nric AS "maskedNric", t.mobile, t.zone_id AS "zoneId", z.name AS "zoneName", z.colour AS "zoneColour", t.format, t.max_entries AS "maxEntries", t.used_entries AS "usedEntries", (t.max_entries - t.used_entries) AS "remainingEntries", t.version, t.token, t.status FROM tickets t JOIN zones z ON z.id = t.zone_id WHERE t.token = ${token} LIMIT 1`;
  return (rows as unknown as TicketRecord[])[0];
}

export async function findTicketsByNric(nric: string) {
  await ensureSeeded();
  const rows = await getSql()`SELECT t.id, t.masked_nric AS "maskedNric", t.mobile, t.zone_id AS "zoneId", z.name AS "zoneName", z.colour AS "zoneColour", t.format, t.max_entries AS "maxEntries", t.used_entries AS "usedEntries", (t.max_entries - t.used_entries) AS "remainingEntries", t.version, t.token, t.status FROM tickets t JOIN zones z ON z.id = t.zone_id WHERE t.nric_hash = ${nricHash(nric)} ORDER BY t.id`;
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

export async function createGateAccessLink(gateId: string, actor: string) {
  await ensureSeeded();
  const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const id = randomUUID();
  const rows = await getSql().query(`
    WITH inserted AS (
      INSERT INTO gate_access_links (id, gate_id, token_hash, expires_at)
      SELECT $1, g.id, $2, now() + interval '24 hours' FROM gates g
      WHERE g.id = $3 AND g.event_id = $4
      RETURNING expires_at
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT $5, 'gate_access.created', $6, $1, '24-hour scanner access' FROM inserted
    )
    SELECT expires_at::text AS "expiresAt" FROM inserted
  `, [id, gateAccessTokenHash(token), gateId, EVENT_ID, randomUUID(), actor]) as Array<{ expiresAt: string }>;
  return rows[0] ? { id, token, gateId, expiresAt: rows[0].expiresAt } : null;
}

export async function getGateAccess(token: string) {
  await ensureSeeded();
  const rows = await getSql().query(`
    SELECT a.id, a.gate_id AS "gateId", g.name AS "gateName", a.expires_at::text AS "expiresAt"
    FROM gate_access_links a JOIN gates g ON g.id = a.gate_id
    WHERE a.token_hash = $1 AND a.revoked_at IS NULL AND a.expires_at > now()
    LIMIT 1
  `, [gateAccessTokenHash(token)]) as Array<{ id: string; gateId: string; gateName: string; expiresAt: string }>;
  return rows[0] ?? null;
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

export async function regenerateTicket(ticketId: string, expectedVersion: number, actor: string) {
  await ensureSeeded();
  const token = makeToken(ticketId);
  const rows = await getSql().query(`
    WITH updated AS (
      UPDATE tickets
      SET version = version + 1, token = $1
      WHERE id = $2 AND version = $5
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

export async function importTickets(rows: ImportRow[], actor: string) {
  await ensureSeeded();
  const records = rows.flatMap((row) => {
    const count = row.format === "physical" ? row.quantity : 1;
    return Array.from({ length: count }, () => {
      const id = `${row.format === "physical" ? "PHY" : "ETK"}-${randomUUID()}`;
      return {
        id,
        eventId: EVENT_ID,
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
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
        id text, "eventId" text, "nricHash" text, "maskedNric" text,
        mobile text, "zoneId" text, format text, "maxEntries" integer, token text
      )
    ), valid AS (
      SELECT i.* FROM incoming i
      JOIN zones z ON z.id = i."zoneId" AND z.event_id = i."eventId"
    ), created AS (
      INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, token)
      SELECT id, "eventId", "nricHash", "maskedNric", mobile, "zoneId", format, "maxEntries", token
      FROM valid
      RETURNING id
    ), audited AS (
      INSERT INTO audit_events (id, action, actor, subject_id, detail)
      SELECT gen_random_uuid()::text, 'ticket.imported', $2, id, 'Imported winner allocation'
      FROM created
    )
    SELECT count(*)::integer AS created FROM created
  `, [JSON.stringify(records), actor]) as Array<{ created: number }>;
  return { created: inserted[0]?.created ?? 0 };
}
