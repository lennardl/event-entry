import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.APP_ACCESS_KEY = "test-access-key-with-sufficient-entropy";
const auth = await import("../lib/auth.ts");
const email = await import("../lib/email.ts");
const authEmail = await import("../lib/auth-email.ts");

test("creates and verifies a signed operations session", () => {
  const token = auth.sessionToken();
  const secondToken = auth.sessionToken();
  assert.ok(token);
  assert.notEqual(token, secondToken, "each login must receive a unique session token");
  const request = new Request("https://event-entry.example/", {
    headers: { cookie: `${auth.SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
  assert.equal(auth.isAuthenticatedRequest(request), true);
  assert.equal(auth.verifyAccessKey("test-access-key-with-sufficient-entropy"), "Super Admin");
  assert.equal(auth.verifyAccessKey("wrong-key"), null);
});

test("passwordless sessions preserve roles and government domain matching is boundary-safe", () => {
  const token = auth.sessionToken("Admin", "person@agency.gov.sg");
  const request = new Request("https://event-entry.example/", { headers: { cookie: `${auth.SESSION_COOKIE}=${token}` } });
  assert.equal(auth.authenticatedRole(request), "Admin");
  assert.equal(authEmail.isAllowedGovernmentEmail(" Person@Open.Gov.Sg "), true);
  assert.equal(authEmail.isAllowedGovernmentEmail("person@gov.sg.attacker.example"), false);
  assert.equal(authEmail.isAllowedGovernmentEmail("person@notgov.sg"), false);
});

test("Postman adapter sends the documented v1 JSON contract without exposing its key", async () => {
  process.env.POSTMAN_EMAIL_API_KEY = "postman-test-secret";
  let request;
  const provider = email.createPostmanEmailProvider(async (url, options) => {
    request = { url, options };
    return Response.json({ id: "email-123" }, { status: 201 });
  });
  assert.deepEqual(await provider.send({ to: "person@agency.gov.sg", subject: "Sign in", text: "Link", html: "<p>Link</p>" }), { messageId: "email-123" });
  assert.equal(request.url, "https://api.postman.gov.sg/v1/transactional/email/send");
  assert.equal(request.options.headers.authorization, "Bearer postman-test-secret");
  assert.deepEqual(JSON.parse(request.options.body), {
    recipient: "person@agency.gov.sg", subject: "Sign in", body: "<p>Link</p>", classification: "FOR_ACTION", tag: "operations-login",
  });
});

test("email authentication uses an eight-digit, attempt-limited one-time code", async () => {
  const [codeSource, routeSource, formSource] = await Promise.all([
    readFile("lib/login-codes.ts", "utf8"), readFile("app/api/session/route.ts", "utf8"), readFile("app/login/LoginForm.tsx", "utf8"),
  ]);
  assert.match(codeSource, /randomInt\(0, 100_000_000\)/);
  assert.match(codeSource, /MAX_CODE_ATTEMPTS = 5/);
  assert.match(codeSource, /createHmac\("sha256"/);
  assert.match(codeSource, /consumed_at = CASE/);
  assert.match(codeSource, /DROP INDEX IF EXISTS auth_magic_links_token_hash_idx/);
  assert.match(routeSource, /consumeLoginCode\(email, body\.code\)/);
  assert.doesNotMatch(routeSource, /verifyUrl|searchParams\.set/);
  assert.match(formSource, /autoComplete="one-time-code"/);
  assert.match(formSource, /pattern="\[0-9\]\{8\}"/);
});

test("event setup batches three and four enforce operational safety", async () => {
  const [storeSource, actionSource, authSource, uiSource, scheduleMigration, safetyMigration] = await Promise.all([
    readFile("lib/store.ts", "utf8"), readFile("app/api/actions/route.ts", "utf8"), readFile("lib/auth.ts", "utf8"),
    readFile("app/ui/EventOperationsApp.tsx", "utf8"), readFile("drizzle/0004_event_schedule.sql", "utf8"), readFile("drizzle/0005_event_safety.sql", "utf8"),
  ]);
  assert.match(storeSource, /pg_advisory_xact_lock/);
  assert.match(storeSource, /capacity_ok/);
  assert.match(scheduleMigration, /time_zone/);
  assert.match(actionSource, /authorizeRequest/);
  assert.match(actionSource, /expectedVersion/);
  assert.match(authSource, /roleSlugs/);
  assert.doesNotMatch(uiSource, /Demo role/);
  assert.match(uiSource, /Search events/);
  assert.match(uiSource, /Audit history/);
  assert.match(uiSource, /audit-list/);
  assert.match(uiSource, /Ticket scanner/);
  assert.doesNotMatch(uiSource, /Gate scanner/);
  assert.match(uiSource, /Move to Recently deleted/);
  assert.match(safetyMigration, /deleted_at/);
});

test("design engineering polish preserves responsive and accessible interactions", async () => {
  const [uiSource, globalStyles, a11yStyles] = await Promise.all([
    readFile("app/ui/EventOperationsApp.tsx", "utf8"), readFile("app/globals.css", "utf8"), readFile("app/ui/a11y.css", "utf8"),
  ]);
  assert.doesNotMatch(uiSource, /window\.confirm/);
  assert.match(uiSource, /UnsavedChangesDialog/);
  assert.match(uiSource, /useModalAccessibility/);
  assert.match(uiSource, /loading-shell/);
  assert.match(globalStyles, /--ease-drawer/);
  assert.match(globalStyles, /scale\(\.97\)/);
  assert.match(a11yStyles, /@starting-style/);
  assert.match(a11yStyles, /hover:hover/);
  assert.match(a11yStyles, /translateX\(100%\)/);
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
  assert.equal(manifest["/login/verify/page"], undefined);
  assert.ok(manifest["/api/actions/route"]);
  assert.ok(manifest["/api/health/route"]);
  assert.ok(manifest["/api/session/route"]);
  assert.ok(manifest["/api/state/route"]);
});

test("sidebar database status is backed by an authenticated five-minute health check", async () => {
  const [uiSource, healthSource] = await Promise.all([
    readFile("app/ui/EventOperationsApp.tsx", "utf8"), readFile("app/api/health/route.ts", "utf8"),
  ]);
  assert.doesNotMatch(uiSource, /Systems operational|Last checked just now/);
  assert.match(uiSource, /HEALTH_CHECK_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(uiSource, /visibilitychange/);
  assert.match(healthSource, /authorizeRequest/);
  assert.match(healthSource, /SELECT now\(\) AS checked_at/);
  assert.match(healthSource, /DATABASE_TIMEOUT_MS = 5_000/);
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

test("mobile tickets confirm admission within two seconds with prominent concise copy", async () => {
  const [ticketSource, polishStyles] = await Promise.all([
    readFile("app/ui/CitizenTicket.tsx", "utf8"),
    readFile("app/ui/citizen-polish.css", "utf8"),
  ]);
  assert.match(ticketSource, /REFRESH_MS = 2_000/);
  assert.match(ticketSource, /refreshingRef/);
  assert.match(ticketSource, /Entry confirmed/);
  assert.match(ticketSource, /All used/);
  assert.match(polishStyles, /\.admission-notice strong \{ font-size: 20px/);
  assert.match(polishStyles, /prefers-reduced-motion/);
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

test("event setup batch one has real scoped mutations and live-only admissions", async () => {
  const [storeSource, actionSource, scanSql, uiSource] = await Promise.all([
    readFile("lib/store.ts", "utf8"), readFile("app/api/actions/route.ts", "utf8"),
    readFile("lib/scan-sql.ts", "utf8"), readFile("app/ui/EventOperationsApp.tsx", "utf8"),
  ]);
  for (const operation of ["updateEvent", "setEventStatus", "createZone", "updateZone", "deleteZone", "createGate", "updateGate", "deleteGate"]) {
    assert.match(storeSource, new RegExp(`export async function ${operation}`));
    assert.match(actionSource, new RegExp(`case \\"${operation}\\"`));
  }
  assert.match(scanSql, /e\.status = 'live'/);
  assert.match(uiSource, /function EventDetailsDialog/);
  assert.match(uiSource, /function ZoneManager/);
  assert.match(uiSource, /function GateManager/);
  assert.match(uiSource, /readiness\.checks/);
});

test("event setup batch two scopes device access, duplication, branding, and ticket policy", async () => {
  const [migration, storeSource, actionSource, scannerSource, uiSource] = await Promise.all([
    readFile("drizzle/0003_event_configuration.sql", "utf8"), readFile("lib/store.ts", "utf8"),
    readFile("app/api/actions/route.ts", "utf8"), readFile("app/api/scanner/scan/route.ts", "utf8"),
    readFile("app/ui/EventOperationsApp.tsx", "utf8"),
  ]);
  assert.match(migration, /allow_group_tickets/);
  assert.match(migration, /last_used_at/);
  for (const operation of ["duplicateEvent", "updateTicketPolicy", "revokeAllGateAccess"]) assert.match(storeSource, new RegExp(`export async function ${operation}`));
  assert.match(storeSource, /allow_ticket_regeneration/);
  assert.match(storeSource, /e\.allow_e_tickets/);
  assert.match(actionSource, /data:image/);
  assert.match(actionSource, /png\|jpeg\|webp/);
  assert.match(actionSource, /max\(350_000\)/);
  assert.match(scannerSource, /markGateAccessUsed/);
  assert.match(uiSource, /function TicketPolicyDialog/);
  assert.match(uiSource, /function DuplicateEventDialog/);
  assert.match(uiSource, /Revoke all active/);
});

test("operations controls refresh visibly, create single tickets, and preserve select spacing", async () => {
  const [uiSource, actionSource, storeSource, styles] = await Promise.all([
    readFile("app/ui/EventOperationsApp.tsx", "utf8"), readFile("app/api/actions/route.ts", "utf8"),
    readFile("lib/store.ts", "utf8"), readFile("app/ui/operations.css", "utf8"),
  ]);
  assert.match(uiSource, /refreshOverview/);
  assert.match(uiSource, /refresh-icon spinning/);
  assert.match(uiSource, /CreateTicketDialog/);
  assert.match(actionSource, /action: z\.literal\("createTicket"\)/);
  assert.match(storeSource, /export async function createTicket/);
  assert.match(styles, /background-position:right 13px center/);
  assert.match(styles, /event-list>\.modal-actions/);
});

test("wallet previews use official artwork without exposing unfinished actions", async () => {
  const [uiSource, ticketSource, googleBadge] = await Promise.all([
    readFile("app/ui/EventOperationsApp.tsx", "utf8"),
    readFile("app/ui/CitizenTicket.tsx", "utf8"),
    readFile("public/wallet/add-to-google-wallet-en-sg.svg", "utf8"),
  ]);
  assert.match(uiSource, /add-to-google-wallet-en-sg\.svg/);
  assert.match(uiSource, /Wallet passes are not working yet/);
  assert.doesNotMatch(uiSource, /wallet-button apple/);
  assert.doesNotMatch(uiSource, /href={`\/api\/wallet\//);
  assert.match(ticketSource, /Wallet passes unavailable/);
  assert.match(googleBadge, /<svg/);
});

test("release controls cover distributed limits, monitoring, Apple Wallet, email delivery, sessions, QA and CI", async () => {
  const [limits, monitor, apple, delivery, users, workflow, qa] = await Promise.all([
    readFile("lib/rate-limit.ts", "utf8"), readFile("lib/operations-monitor.ts", "utf8"), readFile("app/api/wallet/apple/route.ts", "utf8"),
    readFile("app/api/admin/email-delivery/route.ts", "utf8"), readFile("app/api/admin/users/route.ts", "utf8"),
    readFile(".github/workflows/ci.yml", "utf8"), readFile("docs/DEVICE_QA.md", "utf8"),
  ]);
  assert.match(limits, /rate_limit_windows/);
  assert.doesNotMatch(limits, /\$4/);
  assert.match(limits, /\[scope, keyHash\(`\$\{scope\}:\$\{identity\}`\), windowSeconds\]/);
  assert.match(monitor, /OPERATIONS_ALERT_WEBHOOK_URL/);
  assert.match(apple, /application\/vnd\.apple\.pkpass/);
  assert.match(apple, /APPLE_WALLET_SIGNER_URL/);
  assert.match(delivery, /getStatus/);
  assert.match(users, /revokeSessions/);
  assert.match(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /Reject committed credentials/);
  assert.match(qa, /VoiceOver/);
  assert.match(qa, /offline pack/);
});
