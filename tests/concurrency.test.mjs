import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { ATOMIC_SCAN_SQL, EXISTING_SCAN_SQL } from "../lib/scan-sql.ts";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? test : test.skip;
const pool = connectionString ? new pg.Pool({ connectionString, max: 12 }) : null;

async function scan(requestId, quantity = 1) {
  const fingerprint = createHash("sha256").update(JSON.stringify(["EVT.test.atomic", quantity, "gate-test", "online"])).digest("hex");
  const parameters = ["EVT.test.atomic", requestId, quantity, "online", "Concurrency test", "gate-test", fingerprint];
  const result = await pool.query(ATOMIC_SCAN_SQL, parameters);
  if (result.rows[0]) return result.rows[0];
  return (await pool.query(EXISTING_SCAN_SQL, [requestId, fingerprint])).rows[0];
}

suite.before(async () => {
  const migrationFiles = (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort();
  for (const migrationFile of migrationFiles) {
    const migration = (await readFile(`drizzle/${migrationFile}`, "utf8")).replaceAll("--> statement-breakpoint", "");
    await pool.query(migration);
  }
  await pool.query("INSERT INTO events (id, name, venue, status, capacity, entry_window_start, entry_window_end) VALUES ('evt-test', 'Test', 'Test', 'active', 10, '00:00', '23:59')");
  await pool.query("INSERT INTO zones (id, event_id, name, colour, capacity) VALUES ('zone-test', 'evt-test', 'Test', '#000000', 10)");
  await pool.query("INSERT INTO gates (id, event_id, name) VALUES ('gate-test', 'evt-test', 'Test Gate')");
  await pool.query("INSERT INTO tickets (id, event_id, nric_hash, masked_nric, mobile, zone_id, format, max_entries, token) VALUES ('ticket-test', 'evt-test', 'hash', 'masked', '90000000', 'zone-test', 'e-ticket', 6, 'EVT.test.atomic')");
});

suite.after(async () => {
  await pool?.end();
});

suite.beforeEach(async () => {
  await pool.query("DELETE FROM scans");
  await pool.query("DELETE FROM scan_requests");
  await pool.query("UPDATE tickets SET used_entries = 0, max_entries = 6 WHERE id = 'ticket-test'");
});

suite("retries with one request ID consume admissions once", async () => {
  const requestId = randomUUID();
  const results = await Promise.all(Array.from({ length: 10 }, () => scan(requestId, 1)));
  assert.equal(results.every((result) => result.result === "allowed"), true);
  assert.equal((await pool.query("SELECT used_entries FROM tickets WHERE id = 'ticket-test'")).rows[0].used_entries, 1);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM scans")).rows[0].count, 1);
});

suite("a request ID cannot be reused with altered scan parameters", async () => {
  const requestId = randomUUID();
  const original = await scan(requestId, 1);
  const altered = await scan(requestId, 2);
  assert.equal(original.result, "allowed");
  assert.equal(altered, undefined);
  assert.equal((await pool.query("SELECT used_entries FROM tickets WHERE id = 'ticket-test'")).rows[0].used_entries, 1);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM scans")).rows[0].count, 1);
});

suite("simultaneous scans cannot both consume the final admission", async () => {
  await pool.query("UPDATE tickets SET max_entries = 1 WHERE id = 'ticket-test'");
  const results = await Promise.all(Array.from({ length: 10 }, () => scan(randomUUID(), 1)));
  assert.equal(results.filter((result) => result.result === "allowed").length, 1);
  assert.equal(results.filter((result) => result.result === "denied").length, 9);
  assert.equal((await pool.query("SELECT used_entries FROM tickets WHERE id = 'ticket-test'")).rows[0].used_entries, 1);
});

suite("concurrent partial-group admissions never exceed the bundle", async () => {
  const results = await Promise.all([scan(randomUUID(), 4), scan(randomUUID(), 4)]);
  assert.equal(results.filter((result) => result.result === "allowed").length, 1);
  assert.equal(results.filter((result) => result.result === "denied").length, 1);
  assert.equal((await pool.query("SELECT used_entries FROM tickets WHERE id = 'ticket-test'")).rows[0].used_entries, 4);
});
