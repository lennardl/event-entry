import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { getSql } from "../db";
import type { Role } from "./types";
import { normaliseEmail, roleForEmail } from "./auth-email";

const TOKEN_TTL_MINUTES = 10;
const EMAIL_WINDOW_MINUTES = 15;
const MAX_EMAIL_REQUESTS = 5;
const MAX_IP_REQUESTS = 20;

let schemaReady: Promise<void> | null = null;

function sessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET ?? process.env.APP_ACCESS_KEY;
  if (!secret || secret.length < 32) throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

function hash(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function ensureSchema() {
  const statements = [`CREATE TABLE IF NOT EXISTS auth_magic_links (
    id text PRIMARY KEY,
    email text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    requester_hash text NOT NULL,
    provider_message_id text,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_magic_links_role_valid CHECK (role in ('Super Admin', 'Admin', 'Gate Supervisor', 'Command Centre Viewer'))
  )`,
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

export async function createMagicLink(emailValue: string, requester: string) {
  await ensureSchema();
  const email = normaliseEmail(emailValue);
  const requesterHash = hash(requester);
  const sql = getSql();
  const [emailCount, requesterCount] = await Promise.all([
    sql`SELECT count(*)::integer AS count FROM auth_magic_links WHERE email = ${email} AND created_at > now() - interval '15 minutes'`,
    sql`SELECT count(*)::integer AS count FROM auth_magic_links WHERE requester_hash = ${requesterHash} AND created_at > now() - interval '15 minutes'`,
  ]);
  const emailRows = emailCount as unknown as Array<{ count: number }>;
  const requesterRows = requesterCount as unknown as Array<{ count: number }>;
  if (Number(emailRows[0]?.count) >= MAX_EMAIL_REQUESTS || Number(requesterRows[0]?.count) >= MAX_IP_REQUESTS) return null;
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await sql`INSERT INTO auth_magic_links (id, email, role, token_hash, requester_hash, expires_at)
    VALUES (${id}, ${email}, ${roleForEmail(email)}, ${createHash("sha256").update(token).digest("hex")}, ${requesterHash}, now() + interval '10 minutes')`;
  return { id, token, expiresInMinutes: TOKEN_TTL_MINUTES };
}

export async function attachProviderMessage(id: string, messageId: string) {
  await getSql()`UPDATE auth_magic_links SET provider_message_id = ${messageId} WHERE id = ${id}`;
}

export async function revokeMagicLink(id: string) {
  await getSql()`UPDATE auth_magic_links SET consumed_at = now() WHERE id = ${id} AND consumed_at IS NULL`;
}

export async function consumeMagicLink(token: string): Promise<{ email: string; role: Role } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  await ensureSchema();
  const rows = await getSql()`UPDATE auth_magic_links SET consumed_at = now()
    WHERE token_hash = ${createHash("sha256").update(token).digest("hex")} AND consumed_at IS NULL AND expires_at > now()
    RETURNING email, role`;
  const row = (rows as unknown as Array<{ email?: unknown; role?: unknown }>)[0];
  const roles: Role[] = ["Super Admin", "Admin", "Gate Supervisor", "Command Centre Viewer"];
  return typeof row?.email === "string" && roles.includes(row.role as Role) ? { email: row.email, role: row.role as Role } : null;
}

export const magicLinkLimits = { EMAIL_WINDOW_MINUTES, MAX_EMAIL_REQUESTS, MAX_IP_REQUESTS };
