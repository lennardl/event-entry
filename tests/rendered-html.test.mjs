import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.APP_ACCESS_KEY = "test-access-key-with-sufficient-entropy";
const auth = await import("../lib/auth.ts");

test("creates and verifies a signed operations session", () => {
  const token = auth.sessionToken();
  const secondToken = auth.sessionToken();
  assert.ok(token);
  assert.notEqual(token, secondToken, "each login must receive a unique session token");
  const request = new Request("https://event-entry.example/", {
    headers: { cookie: `${auth.SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
  assert.equal(auth.isAuthenticatedRequest(request), true);
  assert.equal(auth.verifyAccessKey("test-access-key-with-sufficient-entropy"), true);
  assert.equal(auth.verifyAccessKey("wrong-key"), false);
});

test("rejects expired, tampered, and malformed operations sessions", () => {
  const realNow = Date.now;
  try {
    Date.now = () => 1_800_000_000_000;
    const expired = auth.sessionToken();
    Date.now = () => 1_800_000_000_000 + (9 * 60 * 60 * 1000);
    const expiredRequest = new Request("https://event-entry.example/", { headers: { cookie: `${auth.SESSION_COOKIE}=${expired}` } });
    assert.equal(auth.isAuthenticatedRequest(expiredRequest), false);
  } finally {
    Date.now = realNow;
  }
  const token = auth.sessionToken();
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(auth.isAuthenticatedRequest(new Request("https://event-entry.example/", { headers: { cookie: `${auth.SESSION_COOKIE}=${tampered}` } })), false);
  assert.equal(auth.isAuthenticatedRequest(new Request("https://event-entry.example/", { headers: { cookie: `${auth.SESSION_COOKIE}=%E0%A4%A` } })), false);
});

test("rejects cross-origin mutation requests", () => {
  const valid = new Request("https://event-entry.example/api/actions", {
    method: "POST",
    headers: { origin: "https://event-entry.example" },
  });
  const invalid = new Request("https://event-entry.example/api/actions", {
    method: "POST",
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(auth.isSameOriginRequest(valid), true);
  assert.equal(auth.isSameOriginRequest(invalid), false);
});

test("standard Next.js build contains the Vercel application routes", async () => {
  const manifest = JSON.parse(await readFile(".next/server/app-paths-manifest.json", "utf8"));
  assert.ok(manifest["/page"]);
  assert.ok(manifest["/login/page"]);
  assert.ok(manifest["/api/actions/route"]);
  assert.ok(manifest["/api/session/route"]);
  assert.ok(manifest["/api/state/route"]);
});

test("service worker cannot cache operational or ticket APIs", async () => {
  const source = await readFile("public/sw.js", "utf8");
  assert.doesNotMatch(source, /const SHELL = \[[^\]]*"\/"/);
  assert.match(source, /SHELL\.includes\(url\.pathname\)/);
});

test("scanner capabilities stay out of query strings and oversized bodies are rejected", async () => {
  const [accessSource, packSource, scanSource, pageSource] = await Promise.all([
    readFile("app/api/scanner/access/route.ts", "utf8"),
    readFile("app/api/scanner/pack/route.ts", "utf8"),
    readFile("app/api/scanner/scan/route.ts", "utf8"),
    readFile("app/scanner/[access]/page.tsx", "utf8"),
  ]);
  assert.doesNotMatch(accessSource, /searchParams\.get\("access"\)/);
  assert.doesNotMatch(packSource, /searchParams\.get\("access"\)/);
  assert.doesNotMatch(pageSource, /\?access=/);
  assert.match(scanSource, /MAX_BODY_BYTES/);
  assert.match(scanSource, /content-length/);
  assert.match(scanSource, /TextEncoder/);
});

test("operations state and mutations are scoped to an explicit event", async () => {
  const [storeSource, actionSource, stateSource, ticketSource, packSource] = await Promise.all([
    readFile("lib/store.ts", "utf8"),
    readFile("app/api/actions/route.ts", "utf8"),
    readFile("app/api/state/route.ts", "utf8"),
    readFile("app/api/ticket/[token]/route.ts", "utf8"),
    readFile("app/api/scanner/pack/route.ts", "utf8"),
  ]);
  assert.doesNotMatch(storeSource, /const EVENT_ID\s*=/);
  assert.match(storeSource, /export async function createEvent/);
  assert.match(actionSource, /action: z\.literal\("createEvent"\)/);
  assert.match(actionSource, /findTicketsByNric\(body\.nric, body\.eventId\)/);
  assert.match(actionSource, /importTickets\(body\.rows, body\.eventId/);
  assert.match(stateSource, /getState\(eventId\)/);
  assert.match(ticketSource, /findEventById\(ticket\.eventId\)/);
  assert.match(packSource, /getState\(access\.eventId\)/);
});

test("ticket themes are persisted, validated, and rendered on public tickets", async () => {
  const [migration, storeSource, actionSource, citizenSource] = await Promise.all([
    readFile("drizzle/0002_event_ticket_theme.sql", "utf8"),
    readFile("lib/store.ts", "utf8"),
    readFile("app/api/actions/route.ts", "utf8"),
    readFile("app/ui/CitizenTicket.tsx", "utf8"),
  ]);
  assert.match(migration, /ticket_primary_colour/);
  assert.match(storeSource, /export async function updateTicketTheme/);
  assert.match(storeSource, /event\.ticket_theme\.updated/);
  assert.match(actionSource, /contrastWithWhite/);
  assert.match(actionSource, /action: z\.literal\("updateTicketTheme"\)/);
  assert.match(citizenSource, /event\.ticketTheme/);
  assert.match(citizenSource, /theme\.instructions/);
});

test("database initialization and public ticket refresh avoid repeated full-state work", async () => {
  const [storeSource, ticketSource] = await Promise.all([
    readFile("lib/store.ts", "utf8"),
    readFile("app/api/ticket/[token]/route.ts", "utf8"),
  ]);
  assert.match(storeSource, /seedReadyPromise \?\?=/);
  assert.match(storeSource, /TICKET_SELECT/);
  assert.match(storeSource, /tickets_event_nric_idx/);
  assert.doesNotMatch(ticketSource, /getState/);
  assert.match(ticketSource, /findEventById/);
});
