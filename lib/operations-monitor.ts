import { randomUUID } from "node:crypto";
import { getSql } from "../db";

export type OperationalSeverity = "info" | "warning" | "critical";
let ready: Promise<void> | null = null;
function ensureSchema() {
  ready ??= getSql().query(`CREATE TABLE IF NOT EXISTS operational_events (
    id text PRIMARY KEY, category text NOT NULL, severity text NOT NULL, message text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
  )`).then(() => undefined).catch((error) => { ready = null; throw error; });
  return ready;
}
export async function recordOperationalEvent(category: string, severity: OperationalSeverity, message: string, detail: Record<string, unknown> = {}) {
  await ensureSchema();
  await getSql()`INSERT INTO operational_events (id, category, severity, message, detail) VALUES (${randomUUID()}, ${category}, ${severity}, ${message}, ${JSON.stringify(detail)}::jsonb)`;
  console[severity === "info" ? "info" : "error"](JSON.stringify({ category, severity, message }));
  const webhook = process.env.OPERATIONS_ALERT_WEBHOOK_URL;
  if (webhook && severity !== "info") await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, severity, message, detail }), signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
}
export async function recentOperationalEvents() {
  await ensureSchema();
  return getSql()`SELECT id, category, severity, message, detail, created_at::text AS "createdAt", resolved_at::text AS "resolvedAt" FROM operational_events ORDER BY created_at DESC LIMIT 100`;
}
