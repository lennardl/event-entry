import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  venue: text("venue").notNull(),
  status: text("status").notNull(),
  capacity: integer("capacity").notNull(),
  entryWindowStart: text("entry_window_start").notNull(),
  entryWindowEnd: text("entry_window_end").notNull(),
});

export const zones = sqliteTable("zones", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  name: text("name").notNull(),
  colour: text("colour").notNull(),
  capacity: integer("capacity").notNull(),
});

export const gates = sqliteTable("gates", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  name: text("name").notNull(),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  nricHash: text("nric_hash").notNull(),
  maskedNric: text("masked_nric").notNull(),
  mobile: text("mobile").notNull(),
  zoneId: text("zone_id").notNull(),
  format: text("format").notNull(),
  maxEntries: integer("max_entries").notNull(),
  usedEntries: integer("used_entries").notNull().default(0),
  version: integer("version").notNull().default(1),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("active"),
});

export const scans = sqliteTable("scans", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  eventId: text("event_id").notNull(),
  gateId: text("gate_id").notNull(),
  quantity: integer("quantity").notNull(),
  result: text("result").notNull(),
  mode: text("mode").notNull(),
  reason: text("reason"),
  operator: text("operator").notNull(),
  createdAt: text("created_at").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  subjectId: text("subject_id").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
});
