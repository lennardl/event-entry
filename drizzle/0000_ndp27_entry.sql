CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  status TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  entry_window_start TEXT NOT NULL,
  entry_window_end TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  colour TEXT NOT NULL,
  capacity INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  nric_hash TEXT NOT NULL,
  masked_nric TEXT NOT NULL,
  mobile TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  format TEXT NOT NULL,
  max_entries INTEGER NOT NULL,
  used_entries INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  result TEXT NOT NULL,
  mode TEXT NOT NULL,
  reason TEXT,
  operator TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_nric_hash ON tickets(nric_hash);
CREATE INDEX IF NOT EXISTS idx_scans_event_created ON scans(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scans_ticket_id ON scans(ticket_id);
