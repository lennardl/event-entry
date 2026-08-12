import { createHmac, randomInt, randomUUID } from "node:crypto";
import { getSql } from "../db";
import type { Role } from "./types";
import { normaliseEmail, roleForEmail } from "./auth-email";

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const MAX_EMAIL_REQUESTS = 5;
const MAX_IP_REQUESTS = 20;
let schemaReady: Promise<void> | null = null;

function secret() {
  const value = process.env.AUTH_SESSION_SECRET ?? process.env.APP_ACCESS_KEY;
  if (!value || value.length < 32) throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters");
  return value;
}

function protectedHash(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function codeHash(email: string, code: string) {
  return protectedHash(`login-code:${email}:${code}`);
}

function ensureSchema() {
  const statements = [`CREATE TABLE IF NOT EXISTS auth_magic_links (
    id text PRIMARY KEY, email text NOT NULL, role text NOT NULL, token_hash text NOT NULL UNIQUE,
    requester_hash text NOT NULL, provider_message_id text, expires_at timestamptz NOT NULL,
    consumed_at timestamptz, failed_attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_magic_links_role_valid CHECK (role in ('Super Admin', 'Admin', 'Gate Supervisor', 'Command Centre Viewer'))
  )`,
  `ALTER TABLE auth_magic_links ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0`,
  `DROP INDEX IF EXISTS auth_magic_links_token_hash_idx`,
  `CREATE INDEX IF NOT EXISTS auth_login_code_hash_idx ON auth_magic_links(token_hash)`,
  `CREATE INDEX IF NOT EXISTS auth_magic_links_email_created_idx ON auth_magic_links(email, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS auth_magic_links_requester_created_idx ON auth_magic_links(requester_hash, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS auth_magic_links_expiry_idx ON auth_magic_links(expires_at)`];
  const sql = getSql();
  schemaReady ??= sql.transaction(statements.map((statement) => sql.query(statement))).then(() => undefined).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export async function createLoginCode(emailValue: string, requester: string) {
  await ensureSchema();
  const email = normaliseEmail(emailValue);
  const requesterHash = protectedHash(`requester:${requester}`);
  const sql = getSql();
  const [emailCount, requesterCount] = await Promise.all([
    sql`SELECT count(*)::integer AS count FROM auth_magic_links WHERE email = ${email} AND created_at > now() - interval '15 minutes'`,
    sql`SELECT count(*)::integer AS count FROM auth_magic_links WHERE requester_hash = ${requesterHash} AND created_at > now() - interval '15 minutes'`,
  ]);
  const emailRows = emailCount as unknown as Array<{ count: number }>;
  const requesterRows = requesterCount as unknown as Array<{ count: number }>;
  if (Number(emailRows[0]?.count) >= MAX_EMAIL_REQUESTS || Number(requesterRows[0]?.count) >= MAX_IP_REQUESTS) return null;

  const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
  const id = randomUUID();
  await sql.transaction([
    sql`UPDATE auth_magic_links SET consumed_at = now() WHERE email = ${email} AND consumed_at IS NULL`,
    sql`INSERT INTO auth_magic_links (id, email, role, token_hash, requester_hash, expires_at)
      VALUES (${id}, ${email}, ${roleForEmail(email)}, ${codeHash(email, code)}, ${requesterHash}, now() + interval '10 minutes')`,
  ]);
  return { id, code, expiresInMinutes: CODE_TTL_MINUTES };
}

export async function attachProviderMessage(id: string, messageId: string) {
  await getSql()`UPDATE auth_magic_links SET provider_message_id = ${messageId} WHERE id = ${id}`;
}

export async function revokeLoginCode(id: string) {
  await getSql()`UPDATE auth_magic_links SET consumed_at = now() WHERE id = ${id} AND consumed_at IS NULL`;
}

export async function consumeLoginCode(emailValue: string, code: string): Promise<{ email: string; role: Role } | null> {
  const email = normaliseEmail(emailValue);
  if (!/^\d{8}$/.test(code)) return null;
  await ensureSchema();
  const rows = await getSql()`WITH candidate AS (
      SELECT id, email, role, token_hash FROM auth_magic_links
      WHERE email = ${email} AND consumed_at IS NULL AND expires_at > now() AND failed_attempts < ${MAX_CODE_ATTEMPTS}
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE
    ), updated AS (
      UPDATE auth_magic_links AS codes SET
        failed_attempts = codes.failed_attempts + 1,
        consumed_at = CASE WHEN candidate.token_hash = ${codeHash(email, code)} OR codes.failed_attempts + 1 >= ${MAX_CODE_ATTEMPTS} THEN now() ELSE NULL END
      FROM candidate WHERE codes.id = candidate.id
      RETURNING codes.email, codes.role, candidate.token_hash = ${codeHash(email, code)} AS matched
    ) SELECT email, role FROM updated WHERE matched`;
  const row = (rows as unknown as Array<{ email?: unknown; role?: unknown }>)[0];
  const roles: Role[] = ["Super Admin", "Admin", "Gate Supervisor", "Command Centre Viewer"];
  return typeof row?.email === "string" && roles.includes(row.role as Role) ? { email: row.email, role: row.role as Role } : null;
}

export const loginCodePolicy = { CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS, MAX_EMAIL_REQUESTS, MAX_IP_REQUESTS };
