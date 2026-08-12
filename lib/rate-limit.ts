import { createHmac } from "node:crypto";
import { getSql } from "../db";

let schemaReady: Promise<void> | null = null;
function keyHash(value: string) {
  const secret = process.env.AUTH_SESSION_SECRET ?? process.env.APP_ACCESS_KEY;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is required for rate limiting");
  return createHmac("sha256", secret).update(value).digest("hex");
}
function ensureSchema() {
  const sql = getSql();
  schemaReady ??= sql.query(`CREATE TABLE IF NOT EXISTS rate_limit_windows (
    scope text NOT NULL, key_hash text NOT NULL, window_start timestamptz NOT NULL,
    count integer NOT NULL DEFAULT 1, PRIMARY KEY (scope, key_hash, window_start)
  )`).then(() => undefined).catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}
export function requestClient(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
export async function distributedRateLimit(scope: string, identity: string, limit: number, windowSeconds: number) {
  await ensureSchema();
  const rows = await getSql().query(`WITH bucket AS (
    SELECT to_timestamp(floor(extract(epoch FROM now()) / $4) * $4) AS starts
  ), hit AS (
    INSERT INTO rate_limit_windows (scope, key_hash, window_start, count)
    SELECT $1, $2, starts, 1 FROM bucket
    ON CONFLICT (scope, key_hash, window_start) DO UPDATE SET count = rate_limit_windows.count + 1
    RETURNING count, window_start
  ) SELECT count, extract(epoch FROM (window_start + ($4 || ' seconds')::interval - now()))::integer AS retry_after FROM hit`,
  [scope, keyHash(`${scope}:${identity}`), limit, windowSeconds]) as Array<{ count: number; retry_after: number }>;
  if (Math.random() < .01) void getSql()`DELETE FROM rate_limit_windows WHERE window_start < now() - interval '1 day'`.catch(() => undefined);
  return rows[0]!.count > limit ? { allowed: false, retryAfter: Math.max(1, rows[0]!.retry_after) } : { allowed: true, retryAfter: 0 };
}
