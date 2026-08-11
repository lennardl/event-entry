import { createHash, randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";
import type { AppState, TicketRecord } from "./types";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, name TEXT NOT NULL, venue TEXT NOT NULL, status TEXT NOT NULL, capacity INTEGER NOT NULL, entry_window_start TEXT NOT NULL, entry_window_end TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS zones (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, colour TEXT NOT NULL, capacity INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gates (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, nric_hash TEXT NOT NULL, masked_nric TEXT NOT NULL, mobile TEXT NOT NULL, zone_id TEXT NOT NULL, format TEXT NOT NULL, max_entries INTEGER NOT NULL, used_entries INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, token TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active')`,
  `CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, event_id TEXT NOT NULL, gate_id TEXT NOT NULL, quantity INTEGER NOT NULL, result TEXT NOT NULL, mode TEXT NOT NULL, reason TEXT, operator TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL, subject_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_nric_hash ON tickets(nric_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_scans_event_created ON scans(event_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scans_ticket_id ON scans(ticket_id)`,
];

let schemaReady = false;

function db() {
  if (!env.DB) throw new Error("D1 database is unavailable");
  return env.DB;
}

export function normaliseNric(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function nricHash(value: string) {
  return createHash("sha256").update(`ndp27-poc:${normaliseNric(value)}`).digest("hex");
}

function maskNric(value: string) {
  const nric = normaliseNric(value);
  return nric.length >= 4 ? `${nric.slice(0, 1)}••••${nric.slice(-4)}` : "••••";
}

function makeToken(ticketId: string, version = 1) {
  const entropy = randomUUID().replaceAll("-", "");
  return `NDP27.${ticketId}.${version}.${entropy}`;
}

export async function ensureSeeded() {
  if (!schemaReady) {
    await db().batch(schemaStatements.map((sql) => db().prepare(sql)));
    schemaReady = true;
  }
  const count = await db().prepare("SELECT COUNT(*) AS count FROM events").first<{ count: number }>();
  if ((count?.count ?? 0) > 0) return;

  const eventId = "evt-ndp27-preview-1";
  const zoneRows = [
    ["zone-red", "Red", "#d92d20", 6750],
    ["zone-green", "Green", "#07865f", 6750],
    ["zone-yellow", "Yellow", "#e8ad16", 6750],
    ["zone-blue", "Blue", "#1670b7", 6750],
  ] as const;
  const gateRows = [["gate-a", "Gate A"], ["gate-b", "Gate B"], ["gate-c", "Gate C"], ["gate-d", "Gate D"]] as const;
  const sampleTickets = [
    ["S1234567D", "9123 4567", "zone-red", "e-ticket", 6],
    ["S2345678E", "9234 5678", "zone-green", "e-ticket", 4],
    ["S3456789F", "9345 6789", "zone-yellow", "e-ticket", 2],
    ["S4567890G", "9456 7890", "zone-blue", "e-ticket", 1],
    ["S5678901H", "9567 8901", "zone-red", "physical", 1],
    ["S6789012I", "9678 9012", "zone-green", "physical", 1],
  ] as const;

  const statements = [
    db().prepare("INSERT INTO events (id, name, venue, status, capacity, entry_window_start, entry_window_end) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(eventId, "NDP 2027 — Preview 1", "The Padang", "Live rehearsal", 27000, "16:00", "18:00"),
    ...zoneRows.map(([id, name, colour, capacity]) => db().prepare("INSERT INTO zones (id, event_id, name, colour, capacity) VALUES (?, ?, ?, ?, ?)").bind(id, eventId, name, colour, capacity)),
    ...gateRows.map(([id, name]) => db().prepare("INSERT INTO gates (id, event_id, name) VALUES (?, ?, ?)").bind(id, eventId, name)),
    ...sampleTickets.map(([nric, mobile, zoneId, format, maxEntries], index) => {
      const id = `TKT-${String(index + 1).padStart(4, "0")}`;
      return db().prepare("INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, used_entries, version, token, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, 'active')")
        .bind(id, eventId, nricHash(nric), maskNric(nric), mobile, zoneId, format, maxEntries, makeToken(id));
    }),
  ];
  await db().batch(statements);
}

export async function getState(): Promise<AppState> {
  await ensureSeeded();
  const [event, zonesResult, gatesResult, ticketsResult, scansResult] = await Promise.all([
    db().prepare("SELECT id, name, venue, status, capacity, entry_window_start AS entryWindowStart, entry_window_end AS entryWindowEnd FROM events LIMIT 1").first<AppState["event"]>(),
    db().prepare("SELECT id, name, colour, capacity FROM zones ORDER BY name").all<AppState["zones"][number]>(),
    db().prepare("SELECT id, name FROM gates ORDER BY name").all<AppState["gates"][number]>(),
    db().prepare(`SELECT t.id, t.masked_nric AS maskedNric, t.mobile, t.zone_id AS zoneId, z.name AS zoneName, z.colour AS zoneColour, t.format, t.max_entries AS maxEntries, t.used_entries AS usedEntries, (t.max_entries - t.used_entries) AS remainingEntries, t.version, t.token, t.status FROM tickets t JOIN zones z ON z.id = t.zone_id ORDER BY t.id`).all<TicketRecord>(),
    db().prepare(`SELECT s.id, s.ticket_id AS ticketId, s.gate_id AS gateId, g.name AS gateName, s.quantity, s.result, s.mode, s.reason, s.operator, s.created_at AS createdAt FROM scans s JOIN gates g ON g.id = s.gate_id ORDER BY s.created_at DESC LIMIT 100`).all<AppState["scans"][number]>(),
  ]);
  if (!event) throw new Error("Event was not initialised");
  const tickets = ticketsResult.results;
  const scans = scansResult.results;
  const allocated = tickets.reduce((sum, ticket) => sum + ticket.maxEntries, 0);
  const admitted = tickets.reduce((sum, ticket) => sum + ticket.usedEntries, 0);
  const recentCutoff = Date.now() - 5 * 60 * 1000;
  const recentAdmissions = scans.reduce((sum, scan) => Date.parse(scan.createdAt) >= recentCutoff && scan.result === "allowed" ? sum + scan.quantity : sum, 0);
  return {
    event,
    zones: zonesResult.results,
    gates: gatesResult.results,
    tickets,
    scans,
    metrics: {
      allocated,
      admitted,
      remaining: allocated - admitted,
      issuedBundles: tickets.length,
      eTicketAdmissions: tickets.filter((ticket) => ticket.format === "e-ticket").reduce((sum, ticket) => sum + ticket.maxEntries, 0),
      physicalAdmissions: tickets.filter((ticket) => ticket.format === "physical").reduce((sum, ticket) => sum + ticket.maxEntries, 0),
      manualAdmissions: scans.filter((scan) => scan.mode === "manual" && scan.result === "allowed").reduce((sum, scan) => sum + scan.quantity, 0),
      offlineAdmissions: scans.filter((scan) => scan.mode === "offline" && scan.result === "allowed").reduce((sum, scan) => sum + scan.quantity, 0),
      deniedAttempts: scans.filter((scan) => scan.result === "denied").length,
      entryRate: Math.round(recentAdmissions / 5),
    },
  };
}

export async function findTicketByToken(token: string) {
  await ensureSeeded();
  return db().prepare(`SELECT t.id, t.masked_nric AS maskedNric, t.mobile, t.zone_id AS zoneId, z.name AS zoneName, z.colour AS zoneColour, t.format, t.max_entries AS maxEntries, t.used_entries AS usedEntries, (t.max_entries - t.used_entries) AS remainingEntries, t.version, t.token, t.status FROM tickets t JOIN zones z ON z.id = t.zone_id WHERE t.token = ?`).bind(token).first<TicketRecord>();
}

export async function findTicketsByNric(nric: string) {
  await ensureSeeded();
  const result = await db().prepare(`SELECT t.id, t.masked_nric AS maskedNric, t.mobile, t.zone_id AS zoneId, z.name AS zoneName, z.colour AS zoneColour, t.format, t.max_entries AS maxEntries, t.used_entries AS usedEntries, (t.max_entries - t.used_entries) AS remainingEntries, t.version, t.token, t.status FROM tickets t JOIN zones z ON z.id = t.zone_id WHERE t.nric_hash = ?`).bind(nricHash(nric)).all<TicketRecord>();
  return result.results;
}

export async function consumeTicket(input: { token: string; quantity: number; gateId: string; mode: "online" | "offline" | "manual"; operator: string; requestId?: string }) {
  await ensureSeeded();
  const ticket = await findTicketByToken(input.token);
  const scanId = input.requestId || randomUUID();
  const createdAt = new Date().toISOString();
  if (!ticket || ticket.status !== "active") {
    return { ok: false, reason: ticket ? "Ticket has been cancelled or regenerated" : "Ticket is invalid" };
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return { ok: false, reason: "Select at least one admission" };
  const update = await db().prepare("UPDATE tickets SET used_entries = used_entries + ? WHERE id = ? AND status = 'active' AND used_entries + ? <= max_entries RETURNING used_entries, max_entries")
    .bind(input.quantity, ticket.id, input.quantity).first<{ used_entries: number; max_entries: number }>();
  if (!update) {
    await db().prepare("INSERT OR IGNORE INTO scans (id, ticket_id, event_id, gate_id, quantity, result, mode, reason, operator, created_at) VALUES (?, ?, ?, ?, ?, 'denied', ?, 'Not enough admissions remaining', ?, ?)")
      .bind(scanId, ticket.id, "evt-ndp27-preview-1", input.gateId, input.quantity, input.mode, input.operator, createdAt).run();
    return { ok: false, reason: `Only ${ticket.remainingEntries} admission${ticket.remainingEntries === 1 ? "" : "s"} remaining`, remaining: ticket.remainingEntries };
  }
  await db().prepare("INSERT OR IGNORE INTO scans (id, ticket_id, event_id, gate_id, quantity, result, mode, reason, operator, created_at) VALUES (?, ?, ?, ?, ?, 'allowed', ?, NULL, ?, ?)")
    .bind(scanId, ticket.id, "evt-ndp27-preview-1", input.gateId, input.quantity, input.mode, input.operator, createdAt).run();
  return { ok: true, ticketId: ticket.id, zoneName: ticket.zoneName, quantity: input.quantity, remaining: update.max_entries - update.used_entries };
}

export async function regenerateTicket(ticketId: string, actor: string) {
  await ensureSeeded();
  const current = await db().prepare("SELECT version FROM tickets WHERE id = ?").bind(ticketId).first<{ version: number }>();
  if (!current) return null;
  const version = current.version + 1;
  const token = makeToken(ticketId, version);
  await db().batch([
    db().prepare("UPDATE tickets SET version = ?, token = ? WHERE id = ?").bind(version, token, ticketId),
    db().prepare("INSERT INTO audit_events (id, action, actor, subject_id, detail, created_at) VALUES (?, 'ticket.regenerated', ?, ?, ?, ?)").bind(randomUUID(), actor, ticketId, `Regenerated as version ${version}`, new Date().toISOString()),
  ]);
  return { token, version };
}

export async function importTickets(rows: Array<{ nric: string; mobile: string; quantity: number; zoneId: string; format: "e-ticket" | "physical" }>) {
  await ensureSeeded();
  const statements = rows.flatMap((row, rowIndex) => {
    if (row.quantity < 1 || row.quantity > 6 || !row.nric || !row.mobile) return [];
    if (row.format === "physical") {
      return Array.from({ length: row.quantity }, (_, index) => {
        const id = `PHY-${Date.now()}-${rowIndex}-${index}`;
        return db().prepare("INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, used_entries, version, token, status) VALUES (?, 'evt-ndp27-preview-1', ?, ?, ?, ?, 'physical', 1, 0, 1, ?, 'active')")
          .bind(id, nricHash(row.nric), maskNric(row.nric), row.mobile, row.zoneId, makeToken(id));
      });
    }
    const id = `ETK-${Date.now()}-${rowIndex}`;
    return [db().prepare("INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, used_entries, version, token, status) VALUES (?, 'evt-ndp27-preview-1', ?, ?, ?, ?, 'e-ticket', ?, 0, 1, ?, 'active')")
      .bind(id, nricHash(row.nric), maskNric(row.nric), row.mobile, row.zoneId, row.quantity, makeToken(id))];
  });
  if (statements.length) await db().batch(statements);
  return { created: statements.length };
}
