import { randomUUID } from "node:crypto";
import { getSql } from "../db";
import type { Role } from "./types";
import { normaliseEmail, roleForEmail } from "./auth-email";

let ready: Promise<void> | null = null;
function ensureSchema() {
  const statements = [`CREATE TABLE IF NOT EXISTS auth_users (
    email text PRIMARY KEY, role text NOT NULL, enabled boolean NOT NULL DEFAULT true,
    session_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
  )`, `CREATE TABLE IF NOT EXISTS auth_login_history (
    id text PRIMARY KEY, email text NOT NULL, success boolean NOT NULL, reason text NOT NULL,
    requester_hash text, created_at timestamptz NOT NULL DEFAULT now()
  )`];
  const sql = getSql();
  ready ??= sql.transaction(statements.map((statement) => sql.query(statement))).then(() => undefined).catch((error) => { ready = null; throw error; });
  return ready;
}
export async function resolveLoginUser(value: string) {
  await ensureSchema(); const email = normaliseEmail(value); const defaultRole = roleForEmail(email);
  const rows = await getSql()`INSERT INTO auth_users (email, role, last_login_at) VALUES (${email}, ${defaultRole}, now())
    ON CONFLICT (email) DO UPDATE SET last_login_at = now(), updated_at = now()
    RETURNING email, role, enabled, session_version AS "sessionVersion"`;
  return (rows as unknown as Array<{ email: string; role: Role; enabled: boolean; sessionVersion: number }>)[0];
}
export async function activeUser(email: string, version: number) {
  await ensureSchema();
  const rows = await getSql()`SELECT email, role, enabled, session_version AS "sessionVersion" FROM auth_users WHERE email = ${normaliseEmail(email)} AND enabled = true AND session_version = ${version}`;
  return (rows as unknown as Array<{ email: string; role: Role; enabled: boolean; sessionVersion: number }>)[0];
}
export async function listUsers() { await ensureSchema(); return getSql()`SELECT email, role, enabled, session_version AS "sessionVersion", created_at::text AS "createdAt", last_login_at::text AS "lastLoginAt" FROM auth_users ORDER BY email`; }
export async function updateUser(email: string, input: { role?: Role; enabled?: boolean; revokeSessions?: boolean }) {
  await ensureSchema();
  return getSql()`UPDATE auth_users SET role = COALESCE(${input.role ?? null}, role), enabled = COALESCE(${input.enabled ?? null}, enabled), session_version = session_version + ${input.revokeSessions ? 1 : 0}, updated_at = now() WHERE email = ${normaliseEmail(email)} RETURNING email, role, enabled, session_version AS "sessionVersion"`;
}
export async function recordLogin(email: string, success: boolean, reason: string) { await ensureSchema(); await getSql()`INSERT INTO auth_login_history (id, email, success, reason) VALUES (${randomUUID()}, ${normaliseEmail(email)}, ${success}, ${reason})`; }
export async function loginHistory() { await ensureSchema(); return getSql()`SELECT id, email, success, reason, created_at::text AS "createdAt" FROM auth_login_history ORDER BY created_at DESC LIMIT 200`; }
