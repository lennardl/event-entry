import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.APP_ACCESS_KEY = "test-access-key-with-sufficient-entropy";
const auth = await import("../lib/auth.ts");

test("creates and verifies a signed operations session", () => {
  const token = auth.sessionToken();
  assert.ok(token);
  const request = new Request("https://event-entry.example/", {
    headers: { cookie: `${auth.SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
  assert.equal(auth.isAuthenticatedRequest(request), true);
  assert.equal(auth.verifyAccessKey("test-access-key-with-sufficient-entropy"), true);
  assert.equal(auth.verifyAccessKey("wrong-key"), false);
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
